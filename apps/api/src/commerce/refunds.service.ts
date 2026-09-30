import { Injectable } from '@nestjs/common';
import { Prisma, RefundStatus } from '@ielts/db';
import type { RefundCreateInput, RefundProcessInput, RefundRejectInput } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, notFound } from '../common/app-error';
import { Actor } from '../courses/courses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { money } from './commerce.helpers';

const notAllowed = (msg: string) => new AppError('REFUND_NOT_ALLOWED', 409, msg);

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  /** Amount of a payment that is still refundable (captured minus non-rejected refunds). */
  private async refundable(tx: Prisma.TransactionClient | PrismaService, paymentId: string) {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw notFound('Payment');
    const used = await tx.refund.aggregate({ where: { paymentId, status: { not: 'REJECTED' } }, _sum: { amount: true } });
    return { payment: p, remaining: money(p.amount).sub(money(used._sum.amount ?? 0)) };
  }

  // ───────── student ─────────
  /** A student asks for a refund of a paid order, within the academy's refund window. Staff still decide. */
  async request(user: { studentId: string; userId: string }, orderId: string, reason: string) {
    const windowDays = await this.settings.get<number>('commerce.refund_window_days');
    const order = await this.prisma.order.findFirst({ where: { id: orderId, studentId: user.studentId }, include: { payments: true } });
    if (!order) throw notFound('Order');
    const payment = order.payments.find((p) => p.status === 'PAID');
    if (order.status !== 'PAID' || !payment || !payment.paidAt) throw notAllowed('Only paid orders can be refunded.');
    if (Date.now() > payment.paidAt.getTime() + windowDays * 86_400_000) throw notAllowed(`Refund requests are accepted within ${windowDays} day(s) of payment. Contact support for exceptions.`);

    const refund = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const open = await tx.refund.count({ where: { paymentId: payment.id, status: { in: ['REQUESTED', 'APPROVED'] } } });
      if (open) throw notAllowed('A refund request for this order is already being reviewed.');
      const { remaining } = await this.refundable(tx, payment.id);
      if (remaining.lte(0)) throw notAllowed('This payment has already been fully refunded.');
      const r = await tx.refund.create({ data: { paymentId: payment.id, amount: remaining, reason, requestedBy: user.userId } });
      await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'REFUND_REQUESTED', actorId: user.userId, payload: { refundId: r.id, reason } } });
      return r;
    });
    await this.notify.notifyPermission('payment.refund', 'REFUND_REQUESTED', 'Refund request', `Order ${order.reference}: ${reason.slice(0, 120)}`);
    return { id: refund.id, status: refund.status, amount: refund.amount };
  }

  // ───────── finance ─────────
  list(status?: RefundStatus) {
    return this.prisma.refund.findMany({
      where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200,
      include: { payment: { select: { amount: true, currency: true, order: { select: { reference: true, student: { select: { firstName: true, lastName: true, user: { select: { email: true } } } } } } } } },
    });
  }

  /** Staff-initiated refund (or partial refund) of a payment. */
  async create(paymentId: string, input: RefundCreateInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
      const { payment, remaining } = await this.refundable(tx, paymentId);
      if (!['PAID', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw notAllowed('Only captured payments can be refunded.');
      if (money(input.amount).gt(remaining)) throw notAllowed(`At most ${remaining.toString()} can still be refunded on this payment.`);
      const r = await tx.refund.create({ data: { paymentId, amount: input.amount, reason: input.reason, requestedBy: actor.userId } });
      await this.audit.record({ ...actor, action: 'ADMIN_REQUESTED_REFUND', entityType: 'Refund', entityId: r.id, after: { paymentId, amount: input.amount } }, tx);
      return r;
    });
  }

  /**
   * Marks a refund as paid out (bank transfers are made outside the system, so the finance user records the
   * reference). A full refund also ends the student's enrollment and frees the seat.
   */
  async process(refundId: string, input: RefundProcessInput, actor: Actor) {
    const info = await this.prisma.$transaction(async (tx) => {
      const r = await tx.refund.findUnique({ where: { id: refundId }, include: { payment: { include: { order: { include: { items: true, student: { select: { userId: true } } } } } } } });
      if (!r) throw notFound('Refund');
      const order = r.payment.order;
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${r.paymentId}::uuid FOR UPDATE`;

      const claimed = await tx.refund.updateMany({ where: { id: refundId, status: { in: ['REQUESTED', 'APPROVED'] } }, data: { status: 'PROCESSED', approvedBy: actor.userId, processedAt: new Date(), providerReference: input.providerReference, decisionNote: input.note } });
      if (claimed.count === 0) throw new AppError('REFUND_NOT_ALLOWED', 409, 'This refund has already been processed.');

      const done = await tx.refund.aggregate({ where: { paymentId: r.paymentId, status: 'PROCESSED' }, _sum: { amount: true } });
      const full = money(done._sum.amount ?? 0).gte(money(r.payment.amount));
      await tx.payment.update({ where: { id: r.paymentId }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      await tx.paymentEvent.create({ data: { paymentId: r.paymentId, type: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED', actorId: actor.userId, payload: { refundId, amount: r.amount.toString(), providerReference: input.providerReference } } });

      if (full) {
        await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
        const enrollments = await tx.enrollment.updateMany({ where: { orderItemId: { in: order.items.map((i) => i.id) }, status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] } }, data: { status: 'REFUNDED' } });
        await tx.studentTimelineEvent.create({ data: { studentId: order.studentId, type: 'REFUNDED', summary: `Order ${order.reference} refunded${enrollments.count ? ' — enrollment ended' : ''}`, meta: { refundId } } });
      }
      await this.audit.record({ ...actor, action: 'ADMIN_ISSUED_REFUND', entityType: 'Refund', entityId: refundId, before: { status: r.status }, after: { status: 'PROCESSED', amount: r.amount.toString(), full, providerReference: input.providerReference } }, tx);
      return { userId: order.student.userId, reference: order.reference, amount: r.amount.toString(), full };
    });
    await this.notify.notifyUser(info.userId, 'REFUND_PROCESSED', 'Your refund has been sent', `Order ${info.reference}: ${info.amount} has been refunded to your bank account.${info.full ? ' Your course access has ended.' : ''}`, { email: true });
    return { ok: true };
  }

  async reject(refundId: string, input: RefundRejectInput, actor: Actor) {
    const info = await this.prisma.$transaction(async (tx) => {
      const r = await tx.refund.findUnique({ where: { id: refundId }, include: { payment: { include: { order: { include: { student: { select: { userId: true } } } } } } } });
      if (!r) throw notFound('Refund');
      const claimed = await tx.refund.updateMany({ where: { id: refundId, status: { in: ['REQUESTED', 'APPROVED'] } }, data: { status: 'REJECTED', approvedBy: actor.userId, processedAt: new Date(), decisionNote: input.note } });
      if (claimed.count === 0) throw new AppError('REFUND_NOT_ALLOWED', 409, 'This refund has already been processed.');
      await this.audit.record({ ...actor, action: 'ADMIN_REJECTED_REFUND', entityType: 'Refund', entityId: refundId, after: { note: input.note } }, tx);
      return { userId: r.payment.order.student.userId, reference: r.payment.order.reference };
    });
    await this.notify.notifyUser(info.userId, 'REFUND_REJECTED', 'Your refund request was declined', `Order ${info.reference}: ${input.note}`, { email: true });
    return { ok: true };
  }
}

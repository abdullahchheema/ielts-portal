import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EnrollmentStatus, Prisma } from '@ielts/db';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicantInput, ApplicationPaymentInput, ApproveProofInput, RejectProofInput, applicantSchema, applicationPaymentSchema } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AuthService, Meta, Session } from '../auth/auth.service';
import { AppError, notFound } from '../common/app-error';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { Actor } from '../courses/courses.service';
import { findMainCourse, getMainCourse } from '../courses/main-course';
import { StorageService, sniffFileType } from '../integrations/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentMethodSetting, SettingsService } from '../settings/settings.service';
import { CouponsService } from './coupons.service';
import { money, newOrderReference, releaseCouponForOrder } from './commerce.helpers';

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const ENROLLMENT_ACTIVATED = 'enrollment.activated';
export interface EnrollmentActivatedEvent { enrollmentId: string; studentId: string; userId: string; orderId?: string; source: string }

/** What a student sees for an enrollment's state. The database enum is reused; only the wording is academic. */
export const DISPLAY_STATUS: Partial<Record<EnrollmentStatus, string>> = {
  PENDING_PAYMENT: 'PENDING_PAYMENT_VERIFICATION',
  ACTIVE: 'ENROLLED',
  PAUSED: 'ENROLLED',
  COMPLETED: 'ENROLLED',
  EXPIRED: 'ENROLLED',
  REJECTED: 'REJECTED',
};

const INCLUDES = [
  'Full IELTS preparation course',
  'Teacher-led daily classes',
  'Complete coverage of Listening, Reading, Writing and Speaking',
  'Daily mock tests',
  'Mock tests based on IELTS past papers',
  'Expected / question-pattern based practice',
  'AI-powered practice tools',
];

function parseOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const details: Record<string, string> = {};
  for (const i of r.error.issues) details[i.path.join('.') || '_'] ??= i.message;
  throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', details);
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly coupons: CouponsService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    private readonly events: EventEmitter2,
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ───────── public catalogue ─────────
  async publicCourse() {
    const { course, version } = await getMainCourse(this.prisma);
    const sections = version
      ? await this.prisma.courseSection.findMany({ where: { courseVersionId: version.id, parentSectionId: null, status: 'PUBLISHED' }, orderBy: { sequence: 'asc' }, select: { title: true } })
      : [];
    return {
      title: course.title, description: course.description, price: course.price, currency: course.currency,
      durationWeeks: course.durationWeeks, accessDays: course.defaultAccessDays,
      includes: INCLUDES, modules: sections.map((s) => s.title),
    };
  }

  /** Batches a student can apply to. A batch with no teacher yet is listed like any other. */
  async publicBatches() {
    const found = await findMainCourse(this.prisma);
    if (!found?.version) return [];
    const now = new Date();
    const batches = await this.prisma.batch.findMany({
      where: {
        courseId: found.course.id, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] },
        AND: [
          { OR: [{ enrollmentOpenAt: null }, { enrollmentOpenAt: { lte: now } }] },
          { OR: [{ enrollmentCloseAt: null }, { enrollmentCloseAt: { gt: now } }] },
          { OR: [{ endAt: null }, { endAt: { gt: now } }] },
        ],
      },
      orderBy: { startAt: 'asc' },
      include: { mentors: { include: { mentor: { select: { displayName: true } } } } },
    });
    return batches.map((b) => ({
      id: b.id, name: b.name, description: b.description, startAt: b.startAt, endAt: b.endAt, timezone: b.timezone,
      days: b.days, classTime: b.classTime, deliveryMode: b.deliveryMode, status: b.status,
      mentorAssigned: b.mentors.length > 0,
      mentors: b.mentors.map((m) => ({ name: m.mentor.displayName, role: m.mentorRole })),
    }));
  }

  /** Payment methods the academy currently accepts, with the account details to pay into. */
  async paymentMethods() {
    const all = await this.settings.get<PaymentMethodSetting[]>('payment.methods');
    return all.filter((m) => m.enabled);
  }

  // ───────── apply ─────────
  private async checkProofFile(file: { buffer: Buffer; size: number } | undefined) {
    if (!file) throw new AppError('PROOF_REQUIRED', 422, 'Please attach a screenshot or PDF of your payment receipt.', { file: 'Attach your payment receipt.' });
    if (file.size > MAX_PROOF_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The file is larger than 5 MB.');
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed || !ALLOWED_MIME.has(sniffed.mime)) throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only JPG, PNG, WebP or PDF files are accepted.');
    return sniffed;
  }

  private async assertMethodEnabled(method: string) {
    const enabled = await this.paymentMethods();
    if (!enabled.some((m) => m.method === method)) {
      throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { paymentMethod: enabled.length ? 'This payment method is not available.' : 'Payments are not set up yet. Please contact the academy.' });
    }
  }

  /**
   * One request from the enrollment form: creates the student account if needed, records the payment proof and
   * leaves the enrollment in PENDING_PAYMENT until an admin verifies the payment. A missing teacher never blocks this.
   */
  async submit(
    current: { userId: string; studentId: string } | null,
    raw: Record<string, unknown>,
    file: { buffer: Buffer; size: number } | undefined,
    meta: Meta,
  ): Promise<{ enrollmentId: string; status: string; session?: Session }> {
    const pay = parseOrThrow(applicationPaymentSchema, raw);
    const applicant: ApplicantInput | null = current ? null : parseOrThrow(applicantSchema, raw);
    const sniffed = await this.checkProofFile(file);
    await this.assertMethodEnabled(pay.paymentMethod);

    // Batch must exist, be open for applications, and belong to the live course.
    const main = await getMainCourse(this.prisma);
    const batch = await this.prisma.batch.findFirst({ where: { id: pay.batchId, deletedAt: null }, include: { version: true } });
    const now = new Date();
    if (!batch || batch.courseId !== main.course.id) throw new AppError('BATCH_NOT_OPEN', 404, 'This batch is not available.');
    if (!['OPEN', 'IN_PROGRESS'].includes(batch.status)) throw new AppError('BATCH_NOT_OPEN', 409, 'This batch is not open for enrollment.');
    if (batch.enrollmentOpenAt && batch.enrollmentOpenAt > now) throw new AppError('BATCH_NOT_OPEN', 409, 'Enrollment for this batch has not opened yet.');
    if (batch.enrollmentCloseAt && batch.enrollmentCloseAt <= now) throw new AppError('BATCH_NOT_OPEN', 409, 'Enrollment for this batch has closed.');
    if (batch.endAt && batch.endAt <= now) throw new AppError('BATCH_NOT_OPEN', 409, 'This batch has already ended.');
    if (main.course.status !== 'PUBLISHED' || batch.version.status === 'DRAFT') throw new AppError('COURSE_UNPUBLISHED', 409, 'The course is not open for enrollment yet.');

    const passwordHash = applicant ? await argon2.hash(applicant.password, { type: argon2.argon2id }) : null;
    const fileKey = `proofs/applications/${randomUUID()}.${sniffed.ext}`;
    await this.storage.put(fileKey, file!.buffer, sniffed.mime);

    let created: { enrollmentId: string; userId: string; studentId: string; email: string; reference: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        let userId: string; let studentId: string; let email: string;
        if (current) {
          ({ userId, studentId } = current);
          email = (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })).email;
          const live = await tx.enrollment.findFirst({ where: { studentId, deletedAt: null, status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'PAUSED'] } } });
          if (live) {
            throw new AppError('ENROLLMENT_ALREADY_EXISTS', 409, live.status === 'PENDING_PAYMENT'
              ? 'You already have an application waiting for payment verification.' : 'You are already enrolled in the course.');
          }
        } else {
          const a = applicant!;
          if (await tx.user.findUnique({ where: { email: a.email } })) {
            throw new AppError('EMAIL_ALREADY_REGISTERED', 409, 'An account with this email already exists. Log in to continue your enrollment.');
          }
          const role = await tx.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
          const user = await tx.user.create({
            data: {
              email: a.email, phone: a.phone, passwordHash: passwordHash!, status: 'ACTIVE', // can log in at once; email is verified later
              roles: { create: { roleId: role.id } },
              student: { create: {
                firstName: a.firstName, lastName: a.lastName, city: a.city, country: a.country, currentBand: a.currentBand, targetBand: a.targetBand,
                academicOrGeneral: a.testType, ieltsExamDate: a.examDate ? new Date(a.examDate) : undefined,
              } },
            },
            include: { student: true },
          });
          userId = user.id; studentId = user.student!.id; email = user.email;
        }

        // Price comes from the database, never from the browser.
        const price = money(main.course.price);
        const order = await tx.order.create({ data: { reference: newOrderReference(), studentId, subtotal: price, discount: 0, tax: 0, total: price, currency: main.course.currency, status: 'PENDING_REVIEW' } });
        let discount = money(0);
        if (pay.couponCode) {
          ({ discount } = await this.coupons.reserveForCheckout(tx, { code: pay.couponCode, studentId, userId, courseId: main.course.id, batchId: batch.id, price, orderId: order.id }));
        }
        const total = price.sub(discount);
        if (!discount.isZero()) await tx.order.update({ where: { id: order.id }, data: { discount, total } });
        const item = await tx.orderItem.create({ data: { orderId: order.id, courseId: main.course.id, batchId: batch.id, originalPrice: price, discount, finalPrice: total } });

        const payment = await tx.payment.create({ data: { orderId: order.id, provider: 'BANK_TRANSFER', amount: total, currency: main.course.currency, reference: order.reference, status: 'PENDING' } });
        const flags: string[] = [];
        if (!money(pay.claimedAmount).equals(total)) flags.push('AMOUNT_MISMATCH');
        const dup = await tx.paymentProof.count({ where: { bankTxnReference: { equals: pay.transactionReference, mode: 'insensitive' }, status: { in: ['SUBMITTED', 'APPROVED'] } } });
        if (dup > 0) flags.push('DUPLICATE_TXN_REFERENCE');
        const proof = await tx.paymentProof.create({
          data: {
            paymentId: payment.id, paymentMethod: pay.paymentMethod, senderName: pay.senderName ?? '', bankTxnReference: pay.transactionReference,
            claimedAmount: pay.claimedAmount, transferDate: new Date(pay.transferDate), fileKey, fileMime: sniffed.mime, flags,
          },
        });
        const enrollment = await tx.enrollment.create({
          data: { studentId, courseId: main.course.id, courseVersionId: batch.courseVersionId, batchId: batch.id, orderItemId: item.id, status: 'PENDING_PAYMENT', source: 'ONLINE_PURCHASE' },
        });
        await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'APPLICATION_SUBMITTED', actorId: userId, payload: { proofId: proof.id, method: pay.paymentMethod, flags } } });
        await tx.studentTimelineEvent.create({ data: { studentId, type: 'APPLICATION_SUBMITTED', summary: `Applied to ${batch.name} — payment awaiting verification`, meta: { enrollmentId: enrollment.id } } });
        await this.audit.record({ userId, action: 'APPLICATION_SUBMITTED', entityType: 'Enrollment', entityId: enrollment.id, after: { batchId: batch.id, orderReference: order.reference }, ip: meta.ip, userAgent: meta.userAgent }, tx);
        return { enrollmentId: enrollment.id, userId, studentId, email, reference: order.reference };
      }, { maxWait: 10_000, timeout: 20_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError('ENROLLMENT_ALREADY_EXISTS', 409, 'You already have an application for this batch.');
      }
      throw e;
    }

    if (applicant) await this.auth.sendVerification(created.userId, created.email).catch((e) => this.logger.warn(`verification email failed: ${e.message}`));
    await this.notify.notifyPermission('payment.verify', 'APPLICATION_SUBMITTED', 'New enrollment application', `Order ${created.reference} is waiting for payment verification.`);
    const session = applicant ? await this.auth.startSession(created.userId, meta) : undefined;
    return { enrollmentId: created.enrollmentId, status: 'PENDING_PAYMENT_VERIFICATION', session };
  }

  // ───────── student ─────────
  async mine(studentId: string) {
    const rows = await this.prisma.enrollment.findMany({
      where: { studentId, deletedAt: null }, orderBy: { createdAt: 'desc' },
      include: {
        batch: { include: { mentors: { include: { mentor: { select: { displayName: true } } } } } },
        orderItem: { include: { order: { include: { payments: { include: { proofs: { orderBy: { createdAt: 'desc' } } } } } } } },
      },
    });
    return rows.map((e) => {
      const order = e.orderItem?.order;
      const proofs = order?.payments.flatMap((p) => p.proofs).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) ?? [];
      const latest = proofs[0];
      return {
        id: e.id, status: e.status, displayStatus: DISPLAY_STATUS[e.status] ?? e.status, createdAt: e.createdAt, enrolledAt: e.enrolledAt, accessEndsAt: e.accessEndsAt,
        batch: { id: e.batch.id, name: e.batch.name, startAt: e.batch.startAt, days: e.batch.days, classTime: e.batch.classTime, timezone: e.batch.timezone, deliveryMode: e.batch.deliveryMode,
          mentors: e.batch.mentors.map((m) => ({ name: m.mentor.displayName, role: m.mentorRole })) },
        order: order ? { id: order.id, reference: order.reference, total: order.total, currency: order.currency, status: order.status } : null,
        payment: latest ? { proofId: latest.id, method: latest.paymentMethod, reference: latest.bankTxnReference, claimedAmount: latest.claimedAmount, status: latest.status, rejectionReason: latest.rejectionReason, submittedAt: latest.createdAt } : null,
        canResubmit: e.status === 'PENDING_PAYMENT' && latest?.status === 'REJECTED' && latest.allowResubmit,
      };
    });
  }

  /** After a rejection that allowed it, the student sends a corrected proof for the same application. */
  async resubmit(studentId: string, userId: string, enrollmentId: string, raw: Record<string, unknown>, file: { buffer: Buffer; size: number } | undefined) {
    const pay = parseOrThrow(applicationPaymentSchema.omit({ batchId: true, couponCode: true }), raw);
    const sniffed = await this.checkProofFile(file);
    await this.assertMethodEnabled(pay.paymentMethod);
    const e = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, studentId, deletedAt: null },
      include: { orderItem: { include: { order: { include: { payments: { include: { proofs: { orderBy: { createdAt: 'desc' }, take: 1 } } } } } } } },
    });
    if (!e?.orderItem) throw notFound('Application');
    const order = e.orderItem.order;
    const payment = order.payments[0];
    const last = payment?.proofs[0];
    if (e.status !== 'PENDING_PAYMENT') throw new AppError('CONFLICT', 409, 'This application is no longer waiting for payment.');
    if (!payment || last?.status !== 'REJECTED' || !last.allowResubmit) throw new AppError('PAYMENT_PENDING', 409, 'Your payment proof is already awaiting verification.');

    const fileKey = `proofs/applications/${randomUUID()}.${sniffed.ext}`;
    await this.storage.put(fileKey, file!.buffer, sniffed.mime);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({ where: { id: payment.id, status: 'CREATED' }, data: { status: 'PENDING' } });
      if (moved.count === 0) throw new AppError('PAYMENT_PENDING', 409, 'Your payment proof is already awaiting verification.');
      await tx.order.update({ where: { id: order.id }, data: { status: 'PENDING_REVIEW' } });
      const flags: string[] = [];
      if (!money(pay.claimedAmount).equals(money(order.total))) flags.push('AMOUNT_MISMATCH');
      const dup = await tx.paymentProof.count({ where: { bankTxnReference: { equals: pay.transactionReference, mode: 'insensitive' }, status: { in: ['SUBMITTED', 'APPROVED'] } } });
      if (dup > 0) flags.push('DUPLICATE_TXN_REFERENCE');
      const proof = await tx.paymentProof.create({
        data: { paymentId: payment.id, paymentMethod: pay.paymentMethod, senderName: pay.senderName ?? '', bankTxnReference: pay.transactionReference, claimedAmount: pay.claimedAmount, transferDate: new Date(pay.transferDate), fileKey, fileMime: sniffed.mime, flags },
      });
      await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'PROOF_RESUBMITTED', actorId: userId, payload: { proofId: proof.id, flags } } });
    });
    await this.notify.notifyPermission('payment.verify', 'APPLICATION_SUBMITTED', 'Payment proof resubmitted', `Order ${order.reference} has a new payment proof to verify.`);
    return { ok: true };
  }

  // ───────── admin ─────────
  async adminList(q: { status: 'PENDING' | 'ENROLLED' | 'REJECTED' | 'ALL'; skip: number; take: number }) {
    const sets: Record<string, EnrollmentStatus[]> = {
      PENDING: ['PENDING_PAYMENT'], ENROLLED: ['ACTIVE', 'PAUSED', 'COMPLETED', 'EXPIRED'], REJECTED: ['REJECTED'],
    };
    const base: Prisma.EnrollmentWhereInput = { deletedAt: null };
    const where: Prisma.EnrollmentWhereInput = q.status === 'ALL' ? base : { ...base, status: { in: sets[q.status] } };
    const [rows, total, pending, enrolled, rejected] = await Promise.all([
      this.prisma.enrollment.findMany({
        where, orderBy: { createdAt: q.status === 'PENDING' ? 'asc' : 'desc' }, skip: q.skip, take: q.take, // oldest pending first
        include: {
          student: { select: { id: true, firstName: true, lastName: true, city: true, country: true, user: { select: { id: true, email: true, phone: true, emailVerifiedAt: true } } } },
          batch: { select: { id: true, name: true } },
          orderItem: { include: { order: { include: { payments: { include: { proofs: { orderBy: { createdAt: 'desc' }, take: 1 } } } } } } },
        },
      }),
      this.prisma.enrollment.count({ where }),
      this.prisma.enrollment.count({ where: { ...base, status: { in: sets.PENDING } } }),
      this.prisma.enrollment.count({ where: { ...base, status: { in: sets.ENROLLED } } }),
      this.prisma.enrollment.count({ where: { ...base, status: { in: sets.REJECTED } } }),
    ]);
    const items = await Promise.all(rows.map(async (e) => {
      const order = e.orderItem?.order;
      const proof = order?.payments[0]?.proofs[0];
      return {
        id: e.id, status: e.status, displayStatus: DISPLAY_STATUS[e.status] ?? e.status, submittedAt: e.createdAt, enrolledAt: e.enrolledAt, source: e.source,
        student: { id: e.student.id, name: `${e.student.firstName} ${e.student.lastName}`, email: e.student.user.email, phone: e.student.user.phone, city: e.student.city, country: e.student.country, emailVerified: !!e.student.user.emailVerifiedAt },
        batch: e.batch,
        order: order ? { reference: order.reference, total: order.total, discount: order.discount, currency: order.currency } : null,
        proof: proof ? {
          id: proof.id, status: proof.status, method: proof.paymentMethod, reference: proof.bankTxnReference, senderName: proof.senderName, claimedAmount: proof.claimedAmount,
          transferDate: proof.transferDate, flags: proof.flags, rejectionReason: proof.rejectionReason, allowResubmit: proof.allowResubmit, fileMime: proof.fileMime,
          fileUrl: await this.storage.signedUrl(proof.fileKey, 300),
        } : null,
      };
    }));
    return { total, counts: { pending, enrolled, rejected }, items };
  }

  /** Verify = payment confirmed AND the student is enrolled, in one atomic step. Safe to double-click. */
  async verify(proofId: string, input: ApproveProofInput, actor: Actor) {
    let ev: EnrollmentActivatedEvent;
    try {
      ev = await this.prisma.$transaction(async (tx) => {
        const proof = await tx.paymentProof.findUnique({
          where: { id: proofId },
          include: { payment: { include: { order: { include: { items: { include: { batch: { include: { course: true } } } }, student: true } } } } },
        });
        if (!proof) throw notFound('Payment proof');
        const { payment } = proof;
        const order = payment.order;
        const item = order.items[0];
        if (!item) throw new AppError('CONFLICT', 409, 'This order has no items.');
        if (!money(proof.claimedAmount).equals(money(order.total)) && !input.confirmAmountMismatch) {
          throw new AppError('PAYMENT_AMOUNT_MISMATCH', 409, `The amount entered (${proof.claimedAmount}) differs from the order total (${order.total}). Confirm to verify anyway.`);
        }

        const paid = await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'PAID', paidAt: new Date(), verifiedBy: actor.userId, verifiedAt: new Date() } });
        if (paid.count === 0) throw new AppError('ORDER_ALREADY_PAID', 409, 'This payment has already been processed.');
        const claimed = await tx.paymentProof.updateMany({ where: { id: proof.id, status: 'SUBMITTED' }, data: { status: 'APPROVED', reviewedBy: actor.userId, reviewedAt: new Date() } });
        if (claimed.count === 0) throw new AppError('ORDER_ALREADY_PAID', 409, 'This proof has already been reviewed.');
        await tx.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
        await tx.couponRedemption.updateMany({ where: { orderId: order.id, status: 'RESERVED' }, data: { status: 'USED' } });

        const now = new Date();
        const base = item.batch.startAt > now ? item.batch.startAt : now;
        const activated = await tx.enrollment.updateMany({
          where: { orderItemId: item.id, status: 'PENDING_PAYMENT' },
          data: { status: 'ACTIVE', enrolledAt: now, accessStartsAt: now, accessEndsAt: new Date(base.getTime() + item.batch.course.defaultAccessDays * 86_400_000) },
        });
        if (activated.count === 0) throw new AppError('CONFLICT', 409, 'This application is no longer waiting for verification.');
        const enrollment = await tx.enrollment.findFirstOrThrow({ where: { orderItemId: item.id } });

        await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'PAYMENT_VERIFIED', actorId: actor.userId, payload: { proofId: proof.id, note: input.note ?? null, amountMismatchConfirmed: input.confirmAmountMismatch } } });
        await tx.studentTimelineEvent.create({ data: { studentId: order.studentId, type: 'ENROLLED', summary: `Payment verified — enrolled in ${item.batch.name}`, meta: { enrollmentId: enrollment.id } } });
        await this.audit.record({ ...actor, action: 'ADMIN_VERIFIED_PAYMENT', entityType: 'Payment', entityId: payment.id, before: { status: 'PENDING' }, after: { status: 'PAID', orderId: order.id, enrollmentId: enrollment.id, proofId: proof.id } }, tx);
        return { enrollmentId: enrollment.id, studentId: order.studentId, userId: order.student.userId, orderId: order.id, source: 'ONLINE_PURCHASE' };
      }, { maxWait: 10_000, timeout: 20_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const dupTxn = /payment_?proof|approved_txn/i.test(JSON.stringify(e.meta ?? {}));
        throw dupTxn
          ? new AppError('DUPLICATE_PAYMENT_PROOF', 409, 'Another verified payment already uses this transaction reference.')
          : new AppError('ENROLLMENT_ALREADY_EXISTS', 409, 'This student is already enrolled in this batch.');
      }
      throw e;
    }
    this.events.emit(ENROLLMENT_ACTIVATED, ev);
    return { ok: true, enrollmentId: ev.enrollmentId };
  }

  /** Reject: either ask for a corrected proof (application stays open) or close the application. */
  async reject(proofId: string, input: RejectProofInput, actor: Actor) {
    const info = await this.prisma.$transaction(async (tx) => {
      const proof = await tx.paymentProof.findUnique({ where: { id: proofId }, include: { payment: { include: { order: { include: { items: true, student: true } } } } } });
      if (!proof) throw notFound('Payment proof');
      const { payment } = proof;
      const order = payment.order;
      const claimed = await tx.paymentProof.updateMany({
        where: { id: proof.id, status: 'SUBMITTED' },
        data: { status: 'REJECTED', rejectionReason: input.reason, allowResubmit: input.allowResubmit, reviewedBy: actor.userId, reviewedAt: new Date() },
      });
      if (claimed.count === 0) throw new AppError('ORDER_ALREADY_PAID', 409, 'This proof has already been reviewed.');

      if (input.allowResubmit) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'CREATED' } });
        await tx.order.update({ where: { id: order.id }, data: { status: 'AWAITING_PAYMENT' } });
      } else {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
        await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
        await tx.enrollment.updateMany({ where: { orderItemId: { in: order.items.map((i) => i.id) }, status: 'PENDING_PAYMENT' }, data: { status: 'REJECTED' } });
        await releaseCouponForOrder(tx, order.id);
        await tx.studentTimelineEvent.create({ data: { studentId: order.studentId, type: 'APPLICATION_REJECTED', summary: `Application rejected: ${input.reason}`, meta: { orderId: order.id } } });
      }
      await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'PAYMENT_REJECTED', actorId: actor.userId, payload: { proofId: proof.id, reason: input.reason, allowResubmit: input.allowResubmit } } });
      await this.audit.record({ ...actor, action: 'ADMIN_REJECTED_PAYMENT', entityType: 'Payment', entityId: payment.id, after: { proofId: proof.id, reason: input.reason, allowResubmit: input.allowResubmit } }, tx);
      return { userId: order.student.userId, reference: order.reference };
    });
    await this.notify.notifyUser(
      info.userId, 'PAYMENT_REJECTED', 'Your payment could not be verified',
      `Order ${info.reference}: ${input.reason}.${input.allowResubmit ? ' Please upload a corrected payment proof from your student portal.' : ' Your application has been closed.'}`,
      { email: true },
    );
    return { ok: true };
  }
}

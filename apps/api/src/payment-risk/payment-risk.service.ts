import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { conflict, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateRisk, RiskFacts, RiskLevel, worstLevel } from './risk-rules';

const uuid = new ParseUUIDPipe();
const DAY = 86_400_000;

/**
 * Scans a submitted receipt against other submissions and records any flags. Flags are for people to review: this
 * service never changes a payment's status.
 */
@Injectable()
export class PaymentRiskService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async scanProof(proofId: string, now = new Date()) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id: proofId },
      select: {
        id: true, bankTxnReference: true, claimedAmount: true, transferDate: true, paymentMethod: true, fileSha256: true, status: true,
        payment: { select: { id: true, amount: true, order: { select: { studentId: true } } } },
      },
    });
    if (!proof) return [];
    const studentId = proof.payment.order.studentId;
    const [sameRefRows, sameFile, amountDate] = await Promise.all([
      this.prisma.paymentProof.findMany({
        where: { id: { not: proof.id }, bankTxnReference: { equals: proof.bankTxnReference, mode: 'insensitive' } },
        select: { status: true, payment: { select: { order: { select: { studentId: true } } } } },
        take: 50,
      }),
      proof.fileSha256
        ? this.prisma.paymentProof.count({ where: { fileSha256: proof.fileSha256, id: { not: proof.id }, payment: { id: { not: proof.payment.id } } } })
        : Promise.resolve(0),
      this.prisma.paymentProof.count({
        where: {
          id: { not: proof.id }, claimedAmount: proof.claimedAmount, transferDate: proof.transferDate, paymentMethod: proof.paymentMethod,
          payment: { order: { studentId: { not: studentId } } }, createdAt: { gte: new Date(now.getTime() - 7 * DAY) },
        },
      }),
    ]);
    const facts: RiskFacts = {
      ref: proof.bankTxnReference,
      claimedAmount: Number(proof.claimedAmount),
      expectedAmount: Number(proof.payment.amount),
      transferDate: proof.transferDate,
      now,
      sameRef: sameRefRows.map((r) => ({ approved: r.status === 'APPROVED', sameStudent: r.payment.order.studentId === studentId })),
      sameFileOtherPayment: sameFile > 0,
      sameAmountDateOthers: amountDate,
    };
    const flags = evaluateRisk(facts);
    for (const f of flags) {
      await this.prisma.paymentRiskFlag.upsert({
        where: { proofId_rule: { proofId: proof.id, rule: f.rule } },
        create: { paymentId: proof.payment.id, proofId: proof.id, rule: f.rule, level: f.level, reason: f.reason },
        // A flag that a person already reviewed keeps its decision; only open ones are refreshed.
        update: { level: f.level, reason: f.reason },
      });
    }
    return flags;
  }

  async list(level?: string, take = 100) {
    const rows = await this.prisma.paymentRiskFlag.findMany({
      where: { status: 'OPEN', ...(level ? { level } : {}) },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }], take,
      select: {
        id: true, rule: true, level: true, reason: true, createdAt: true,
        proof: { select: { id: true, bankTxnReference: true, status: true, claimedAmount: true, payment: { select: { order: { select: { reference: true, student: { select: { firstName: true, lastName: true } } } } } } } },
      },
    });
    const byProof = new Map<string, typeof rows>();
    for (const r of rows) byProof.set(r.proof.id, [...(byProof.get(r.proof.id) ?? []), r]);
    return [...byProof.values()].map((flags) => ({
      proofId: flags[0].proof.id,
      reference: flags[0].proof.bankTxnReference,
      proofStatus: flags[0].proof.status,
      orderReference: flags[0].proof.payment.order.reference,
      student: `${flags[0].proof.payment.order.student.firstName} ${flags[0].proof.payment.order.student.lastName}`.trim(),
      overall: worstLevel(flags.map((f) => ({ level: f.level as RiskLevel }))),
      flags: flags.map((f) => ({ id: f.id, rule: f.rule, level: f.level, reason: f.reason })),
    }));
  }

  /** A person dismisses or confirms a flag. Confirming marks it as a real concern; neither decision moves the payment. */
  async review(id: string, decision: 'DISMISS' | 'CONFIRM', note: string | undefined, actorId: string, meta: { ip?: string; userAgent?: string }) {
    const f = await this.prisma.paymentRiskFlag.findUnique({ where: { id }, select: { id: true, status: true, rule: true, level: true } });
    if (!f) throw notFound('Flag');
    if (f.status !== 'OPEN') throw conflict('CONFLICT', 'This flag has already been reviewed.');
    const status = decision === 'DISMISS' ? 'DISMISSED' : 'CONFIRMED';
    const r = await this.prisma.paymentRiskFlag.updateMany({ where: { id, status: 'OPEN' }, data: { status, reviewedById: actorId, reviewedAt: new Date(), reviewNote: note ?? null } });
    if (r.count === 0) throw conflict('CONFLICT', 'This flag has already been reviewed.');
    await this.audit.record({ userId: actorId, ...meta, action: 'ADMIN_REVIEWED_PAYMENT_FLAG', entityType: 'PaymentRiskFlag', entityId: id, before: { status: 'OPEN' }, after: { status, rule: f.rule, level: f.level, note: note ?? null } });
    return { id, status };
  }
}

const listQuery = z.object({ level: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional() });
const reviewSchema = z.object({ decision: z.enum(['DISMISS', 'CONFIRM']), note: z.string().trim().max(500).optional() });

@Controller('admin/payment-risk')
export class PaymentRiskController {
  constructor(private readonly risk: PaymentRiskService) {}

  @RequirePermission('payment.view') @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.risk.list(q.level); }

  @RequirePermission('payment.verify') @HttpCode(200) @Post(':id/review')
  review(@Param('id', uuid) id: string, @Body(new ZodPipe(reviewSchema)) body: z.infer<typeof reviewSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.risk.review(id, body.decision, body.note, u.id, clientMeta(req));
  }
}

@Module({ controllers: [PaymentRiskController], providers: [PaymentRiskService], exports: [PaymentRiskService] })
export class PaymentRiskModule {}

import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@ielts/db';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { conflict, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const uuid = new ParseUUIDPipe();
const DAY = 86_400_000;
const METHODS = ['BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'OTHER'] as const;

/** Pure matching outcome for one proof, given the statement lines that carry its reference. */
export function matchOutcome(expected: number, claimedDate: Date, lines: { amount: number; txnDate: Date }[]) {
  if (lines.length === 0) return { status: 'UNMATCHED' as const, reasons: ['No statement line carries this reference.'], index: null };
  if (lines.length > 1) return { status: 'DUPLICATE' as const, reasons: [`${lines.length} statement lines carry this reference.`], index: null };
  const [line] = lines;
  if (Math.abs(line.amount - expected) > 0.01) {
    return { status: 'MISMATCHED' as const, reasons: [`Statement shows ${line.amount}; the amount due is ${expected}.`], index: 0 };
  }
  const days = Math.round(Math.abs(line.txnDate.getTime() - claimedDate.getTime()) / DAY);
  if (days > 7) return { status: 'PENDING_REVIEW' as const, reasons: [`The statement date is ${days} days from the transfer date.`], index: 0 };
  return { status: 'MATCHED' as const, reasons: [], index: 0 };
}

/**
 * Matches manual payments against bank, JazzCash and Easypaisa statement exports. Imports are CSV files that finance
 * uploads. The service never claims a live bank or wallet connection: it works only with what was imported.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async importLines(userId: string, method: (typeof METHODS)[number], lines: { reference: string; amount: number; date: string }[], meta: { ip?: string; userAgent?: string }) {
    const imp = await this.prisma.statementImport.create({ data: { method, rowCount: lines.length, uploadedById: userId }, select: { id: true } });
    await this.prisma.statementLine.createMany({
      data: lines.map((l) => ({ importId: imp.id, method, reference: l.reference.trim(), amount: new Prisma.Decimal(l.amount), txnDate: new Date(`${l.date}T00:00:00Z`) })),
    });
    const refs = [...new Set(lines.map((l) => l.reference.trim().toLowerCase()))];
    const proofs = await this.prisma.paymentProof.findMany({
      where: { paymentMethod: method, status: { in: ['SUBMITTED', 'APPROVED'] }, bankTxnReference: { in: refs, mode: 'insensitive' } },
      select: { id: true },
      take: 2000,
    });
    let matched = 0;
    for (const p of proofs) {
      const out = await this.match(p.id);
      if (out.status === 'MATCHED') matched++;
    }
    await this.audit.record({ userId, ...meta, action: 'FINANCE_IMPORTED_STATEMENT', entityType: 'StatementImport', entityId: imp.id, after: { method, rows: lines.length, matched } });
    return { importId: imp.id, rows: lines.length, checked: proofs.length, matched };
  }

  /** Re-runs matching for one proof and records the outcome. The record is updated, never deleted. */
  async match(proofId: string) {
    const p = await this.prisma.paymentProof.findUnique({
      where: { id: proofId },
      select: { id: true, bankTxnReference: true, paymentMethod: true, transferDate: true, payment: { select: { amount: true } } },
    });
    if (!p) throw notFound('Proof');
    const lines = await this.prisma.statementLine.findMany({
      where: { method: p.paymentMethod, reference: { equals: p.bankTxnReference, mode: 'insensitive' } },
      select: { id: true, amount: true, txnDate: true }, take: 10,
    });
    const out = matchOutcome(Number(p.payment.amount), p.transferDate, lines.map((l) => ({ amount: Number(l.amount), txnDate: l.txnDate })));
    await this.prisma.paymentReconciliation.upsert({
      where: { proofId },
      create: { proofId, status: out.status, reasons: out.reasons, statementLineId: out.index === null ? null : lines[out.index].id },
      update: { status: out.status, reasons: out.reasons, statementLineId: out.index === null ? null : lines[out.index].id },
    });
    return out;
  }

  async summary() {
    const [recon, proofs] = await Promise.all([
      this.prisma.paymentReconciliation.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.paymentProof.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const count = (rows: { status: string; _count: { _all: number } }[], s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
    return {
      matched: count(recon, 'MATCHED'),
      mismatched: count(recon, 'MISMATCHED'),
      duplicate: count(recon, 'DUPLICATE'),
      pendingReview: count(recon, 'PENDING_REVIEW'),
      unmatched: count(recon, 'UNMATCHED'),
      submitted: count(proofs, 'SUBMITTED'),
      approved: count(proofs, 'APPROVED'),
      rejected: count(proofs, 'REJECTED'),
      note: 'Matched against statements you imported. This is not a live bank or wallet connection.',
    };
  }

  exceptions(status?: string) {
    return this.prisma.paymentReconciliation.findMany({
      where: { resolution: null, status: status ? status : { in: ['MISMATCHED', 'DUPLICATE', 'PENDING_REVIEW', 'UNMATCHED'] } },
      orderBy: { updatedAt: 'desc' }, take: 200,
      select: { id: true, status: true, reasons: true, updatedAt: true, proof: { select: { id: true, bankTxnReference: true, paymentMethod: true, claimedAmount: true, payment: { select: { order: { select: { reference: true } } } } } } },
    });
  }

  /** Finance records a decision on an exception. The payment itself is not changed here. */
  async resolve(id: string, resolution: 'ACCEPTED' | 'REJECTED_EXCEPTION', note: string | undefined, actorId: string, meta: { ip?: string; userAgent?: string }) {
    const r = await this.prisma.paymentReconciliation.findUnique({ where: { id }, select: { id: true, status: true, resolution: true } });
    if (!r) throw notFound('Reconciliation');
    if (r.resolution) throw conflict('CONFLICT', 'This exception has already been resolved.');
    const claimed = await this.prisma.paymentReconciliation.updateMany({
      where: { id, resolution: null },
      data: { resolution, resolutionNote: note ?? null, resolvedById: actorId, resolvedAt: new Date() },
    });
    if (claimed.count === 0) throw conflict('CONFLICT', 'This exception has already been resolved.');
    await this.audit.record({ userId: actorId, ...meta, action: 'FINANCE_RESOLVED_RECONCILIATION', entityType: 'PaymentReconciliation', entityId: id, before: { status: r.status }, after: { resolution, note: note ?? null } });
    return { id, resolution };
  }
}

const importSchema = z.object({
  method: z.enum(METHODS),
  lines: z.array(z.object({
    reference: z.string().trim().min(3).max(120),
    amount: z.number().positive().max(100_000_000),
    date: z.string().date(),
  })).min(1).max(2000),
});
const resolveSchema = z.object({ resolution: z.enum(['ACCEPTED', 'REJECTED_EXCEPTION']), note: z.string().trim().max(500).optional() });
const exceptionsQuery = z.object({ status: z.enum(['MISMATCHED', 'DUPLICATE', 'PENDING_REVIEW', 'UNMATCHED']).optional() });

@Controller('admin/reconciliation')
export class ReconciliationController {
  constructor(private readonly recon: ReconciliationService) {}

  @RequirePermission('payment.reconcile') @HttpCode(201) @Post('imports')
  import(@Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recon.importLines(u.id, body.method, body.lines, clientMeta(req));
  }

  @RequirePermission('payment.reconcile') @Get('summary')
  summary() { return this.recon.summary(); }

  @RequirePermission('payment.reconcile') @Get('exceptions')
  exceptions(@Query(new ZodPipe(exceptionsQuery)) q: z.infer<typeof exceptionsQuery>) { return this.recon.exceptions(q.status); }

  @RequirePermission('payment.reconcile') @HttpCode(200) @Post('exceptions/:id/resolve')
  resolve(@Param('id', uuid) id: string, @Body(new ZodPipe(resolveSchema)) body: z.infer<typeof resolveSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recon.resolve(id, body.resolution, body.note, u.id, clientMeta(req));
  }
}

@Module({ controllers: [ReconciliationController], providers: [ReconciliationService], exports: [ReconciliationService] })
export class ReconciliationModule {}

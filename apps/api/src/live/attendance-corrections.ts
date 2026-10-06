import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { conflict, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

const uuid = new ParseUUIDPipe();
const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
const requestSchema = z.object({
  studentId: z.string().uuid(),
  toStatus: z.enum(STATUSES),
  reason: z.string().trim().min(5).max(500),
});
const decideSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() });
type Meta = { ip?: string; userAgent?: string };

/**
 * Corrections to attendance that is past the edit window. A teacher asks; an administrator with attendance.correct
 * decides. Approval writes the change in one transaction, records the event, and keeps the old value in history.
 */
@Injectable()
export class AttendanceCorrectionService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotificationsService) {}

  async request(sessionId: string, input: z.infer<typeof requestSchema>, mentorId: string | undefined, canOverseeAll: boolean, actorId: string, meta: Meta) {
    const s = await this.prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true, batchId: true } });
    if (!s) throw notFound('Session');
    if (!canOverseeAll) {
      const ok = mentorId ? await this.prisma.batchMentor.count({ where: { batchId: s.batchId, mentorId } }) : 0;
      if (!ok) throw forbidden('You are not assigned to this batch.');
    }
    const enrolled = await this.prisma.enrollment.count({ where: { batchId: s.batchId, studentId: input.studentId, status: { in: ['ACTIVE', 'COMPLETED'] }, deletedAt: null } });
    if (!enrolled) throw notFound('Student');
    const current = await this.prisma.attendance.findUnique({ where: { sessionId_studentId: { sessionId, studentId: input.studentId } }, select: { status: true } });
    try {
      const row = await this.prisma.attendanceCorrection.create({
        data: { sessionId, studentId: input.studentId, requestedById: actorId, fromStatus: current?.status ?? null, toStatus: input.toStatus, reason: input.reason },
        select: { id: true, status: true },
      });
      await this.audit.record({ userId: actorId, ...meta, action: 'ATTENDANCE_CORRECTION_REQUESTED', entityType: 'AttendanceCorrection', entityId: row.id, after: { sessionId, toStatus: input.toStatus } });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw conflict('CONFLICT', 'A correction for this student is already waiting for a decision.');
      throw e;
    }
  }

  list(status?: string) {
    return this.prisma.attendanceCorrection.findMany({
      where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 100,
      select: {
        id: true, status: true, fromStatus: true, toStatus: true, reason: true, createdAt: true, decisionNote: true,
        session: { select: { id: true, topic: true, startsAt: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /** Approving applies the correction. Rejecting only records the decision. Both are audited. */
  async decide(id: string, approve: boolean, note: string | undefined, actorId: string, meta: Meta) {
    const c = await this.prisma.attendanceCorrection.findUnique({ where: { id }, select: { id: true, status: true, sessionId: true, studentId: true, toStatus: true, requestedById: true } });
    if (!c) throw notFound('Correction');
    if (c.status !== 'PENDING') throw conflict('CONFLICT', 'This correction has already been decided.');
    const out = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.attendanceCorrection.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: actorId, decidedAt: new Date(), decisionNote: note ?? null },
      });
      if (claimed.count === 0) throw conflict('CONFLICT', 'This correction has already been decided.');
      if (approve) {
        const before = await tx.attendance.findUnique({ where: { sessionId_studentId: { sessionId: c.sessionId, studentId: c.studentId } } });
        const after = await tx.attendance.upsert({
          where: { sessionId_studentId: { sessionId: c.sessionId, studentId: c.studentId } },
          create: { sessionId: c.sessionId, studentId: c.studentId, status: c.toStatus as 'PRESENT', markedBy: actorId, markedAt: new Date() },
          update: { status: c.toStatus as 'PRESENT', markedBy: actorId, markedAt: new Date() },
        });
        await tx.attendanceEvent.create({
          data: { sessionId: c.sessionId, studentId: c.studentId, action: 'CORRECTION_APPLIED', beforeStatus: before?.status ?? null, afterStatus: after.status, actorId, reason: note ?? null },
        });
      }
      await this.audit.record({
        userId: actorId, ...meta, action: approve ? 'ADMIN_APPROVED_ATTENDANCE_CORRECTION' : 'ADMIN_REJECTED_ATTENDANCE_CORRECTION',
        entityType: 'AttendanceCorrection', entityId: id, after: { toStatus: c.toStatus, decisionNote: note ?? null },
      }, tx);
      return { id, status: approve ? 'APPROVED' : 'REJECTED' };
    });
    await this.notify.notifyUser(
      c.requestedById,
      'ATTENDANCE_CORRECTION_DECIDED',
      approve ? 'Your attendance correction was approved' : 'Your attendance correction was not approved',
      note ?? undefined,
      { entityType: 'AttendanceCorrection', entityId: id },
    );
    return out;
  }
}

@Controller()
export class AttendanceCorrectionController {
  constructor(private readonly corrections: AttendanceCorrectionService, private readonly ctx: UserContextService) {}

  @RequirePermission('teaching.view') @HttpCode(201) @Post('mentor/sessions/:id/attendance-corrections')
  async request(@Param('id', uuid) id: string, @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    const c = (await this.ctx.get(u.id))!;
    return this.corrections.request(id, body, u.mentorId, c.permissions.has('batch.create'), u.id, clientMeta(req));
  }

  @RequirePermission('attendance.correct') @Get('admin/attendance-corrections')
  list(@Query('status') status?: string) {
    return this.corrections.list(status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED' ? status : undefined);
  }

  @RequirePermission('attendance.correct') @HttpCode(200) @Post('admin/attendance-corrections/:id/decide')
  decide(@Param('id', uuid) id: string, @Body(new ZodPipe(decideSchema)) body: z.infer<typeof decideSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.corrections.decide(id, body.approve, body.note, u.id, clientMeta(req));
  }
}

@Module({ controllers: [AttendanceCorrectionController], providers: [AttendanceCorrectionService], exports: [AttendanceCorrectionService] })
export class AttendanceCorrectionsModule {}

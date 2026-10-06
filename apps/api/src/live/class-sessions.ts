import { Body, Controller, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

const uuid = new ParseUUIDPipe();
const cancelSchema = z.object({ reason: z.string().trim().min(3).max(300) });
const statusSchema = z.object({ action: z.enum(['START', 'END']) });

/** Live class lifecycle: scheduled → live → completed, or cancelled. Cancelling notifies the batch and stops reminders. */
@Injectable()
export class ClassSessionService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotificationsService) {}

  /** Teachers manage only their own batches; administrators with batch oversight manage any. */
  private async assertManager(sessionId: string, mentorId: string | undefined, canOverseeAll: boolean) {
    const s = await this.prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true, batchId: true, status: true, topic: true, title: true, startsAt: true } });
    if (!s) throw notFound('Session');
    if (canOverseeAll) return s;
    const ok = mentorId ? await this.prisma.batchMentor.count({ where: { batchId: s.batchId, mentorId } }) : 0;
    if (!ok) throw forbidden('You are not assigned to this batch.');
    return s;
  }

  async cancel(sessionId: string, reason: string, mentorId: string | undefined, canOverseeAll: boolean, actorId: string, meta: { ip?: string; userAgent?: string }) {
    const s = await this.assertManager(sessionId, mentorId, canOverseeAll);
    if (s.status !== 'SCHEDULED') throw conflict('CONFLICT', 'Only a scheduled class can be cancelled.');
    const claimed = await this.prisma.liveSession.updateMany({ where: { id: sessionId, status: 'SCHEDULED' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
    if (claimed.count === 0) throw conflict('CONFLICT', 'This class has already changed. Reload and try again.');
    await this.audit.record({ userId: actorId, ...meta, action: 'ADMIN_CANCELLED_SESSION', entityType: 'LiveSession', entityId: sessionId, before: { status: 'SCHEDULED' }, after: { status: 'CANCELLED', reason } });
    const students = await this.prisma.enrollment.findMany({
      where: { batchId: s.batchId, status: 'ACTIVE', deletedAt: null }, select: { student: { select: { userId: true } } },
    });
    const title = s.title ?? s.topic;
    for (const e of students) {
      await this.notify.notifyUser(e.student.userId, 'CLASS_CANCELLED', `Class cancelled: ${title}`, reason, {
        email: true, dedupeKey: `cancel:${sessionId}`, entityType: 'SESSION', entityId: sessionId, link: '/student/schedule',
      });
    }
    return { id: sessionId, status: 'CANCELLED', notified: students.length };
  }

  async transition(sessionId: string, action: 'START' | 'END', mentorId: string | undefined, canOverseeAll: boolean) {
    const s = await this.assertManager(sessionId, mentorId, canOverseeAll);
    if (action === 'START') {
      if (s.status !== 'SCHEDULED') throw new AppError('CONFLICT', 409, 'Only a scheduled class can be started.');
      const r = await this.prisma.liveSession.updateMany({ where: { id: sessionId, status: 'SCHEDULED' }, data: { status: 'LIVE', startedAt: new Date() } });
      if (r.count === 0) throw conflict('CONFLICT', 'This class has already started.');
      return { id: sessionId, status: 'LIVE' };
    }
    if (s.status !== 'LIVE' && s.status !== 'SCHEDULED') throw conflict('CONFLICT', 'This class is not running.');
    const r = await this.prisma.liveSession.updateMany({ where: { id: sessionId, status: { in: ['LIVE', 'SCHEDULED'] } }, data: { status: 'COMPLETED', endedAt: new Date() } });
    if (r.count === 0) throw conflict('CONFLICT', 'This class has already ended.');
    return { id: sessionId, status: 'COMPLETED' };
  }
}

@Controller()
export class ClassSessionController {
  constructor(private readonly sessions: ClassSessionService, private readonly ctx: UserContextService) {}

  @RequirePermission('class.manage') @HttpCode(200) @Post('admin/sessions/:id/cancel')
  async cancel(@Param('id', uuid) id: string, @Body(new ZodPipe(cancelSchema)) body: { reason: string }, @CurrentUser() u: AuthUser, @Req() req: Request) {
    const c = (await this.ctx.get(u.id))!;
    return this.sessions.cancel(id, body.reason, u.mentorId, c.permissions.has('batch.create'), u.id, clientMeta(req));
  }

  @RequirePermission('teaching.view') @HttpCode(200) @Post('mentor/sessions/:id/status')
  async status(@Param('id', uuid) id: string, @Body(new ZodPipe(statusSchema)) body: { action: 'START' | 'END' }, @CurrentUser() u: AuthUser) {
    const c = (await this.ctx.get(u.id))!;
    return this.sessions.transition(id, body.action, u.mentorId, c.permissions.has('batch.create'));
  }
}

@Module({ controllers: [ClassSessionController], providers: [ClassSessionService], exports: [ClassSessionService] })
export class ClassSessionsModule {}

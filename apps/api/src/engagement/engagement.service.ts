import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, OnModuleInit, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { conflict, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { alertLevel, attendancePercent, DEFAULT_ENGAGEMENT, EngagementStatus, engagementStatus, MarkedSession } from './engagement-rules';
import { dueReminders, REMINDER_OFFSETS_MINUTES } from './reminders';
import { APP_CONFIG, AppConfig } from '../config/config.module';

const DAY = 86_400_000;
const uuid = new ParseUUIDPipe();
const RECOMPUTE_BATCH = 500;

/**
 * Engagement status per student, recomputed on a schedule. A status is written only when it changes, so each
 * transition is recorded once and staff are alerted once per change, not on every run.
 */
@Injectable()
export class EngagementService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.scheduler.register('engagement.recompute', 6 * 60 * 60_000, () => this.recomputeAll());
  }

  /** Scheduled. A bounded batch per run; a student with no academic history is judged on enrolment age. */
  async recomputeAll(now = new Date()) {
    const students = await this.prisma.studentProfile.findMany({
      where: { user: { deletedAt: null }, enrollments: { some: { status: 'ACTIVE', deletedAt: null } } },
      select: { id: true }, take: RECOMPUTE_BATCH,
    });
    let changed = 0;
    for (const s of students) {
      try {
        if (await this.recompute(s.id, now)) changed++;
      } catch {
        // A single broken record must not stop the run for everyone else.
      }
    }
    return { checked: students.length, changed };
  }

  /** Recomputes one student. Returns true when the status changed. */
  async recompute(studentId: string, now = new Date()): Promise<boolean> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
      select: { id: true, firstName: true, lastName: true, userId: true, user: { select: { lastLoginAt: true } }, enrollments: { where: { status: 'ACTIVE', deletedAt: null }, select: { createdAt: true, enrolledAt: true }, take: 1 } },
    });
    if (!profile) return false;
    const [progress, attempt, submission, attendanceRows, due, submitted, existing] = await Promise.all([
      this.prisma.contentProgress.findFirst({ where: { studentId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true, contentItem: { select: { title: true } } } }),
      this.prisma.assessmentAttempt.findFirst({ where: { studentId, submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, select: { submittedAt: true, assessment: { select: { title: true } } } }),
      this.prisma.submission.findFirst({ where: { studentId }, orderBy: { submittedAt: 'desc' }, select: { submittedAt: true, assignment: { select: { contentItem: { select: { title: true } } } } } }),
      this.prisma.attendance.findMany({ where: { studentId }, select: { status: true, session: { select: { startsAt: true } } }, take: 200 }),
      this.prisma.assignment.count({ where: { dueAt: { lt: now }, contentItem: { section: { version: { enrollments: { some: { studentId, status: 'ACTIVE' } } } } } } }),
      this.prisma.submission.count({ where: { studentId, status: { in: ['SUBMITTED', 'GRADED'] } } }),
      this.prisma.studentEngagement.findUnique({ where: { studentId }, select: { status: true } }),
    ]);

    // Academic activity only. A login alone does not count, matching the risk rules.
    const candidates = [
      progress ? { at: progress.updatedAt, label: progress.contentItem.title } : null,
      attempt?.submittedAt ? { at: attempt.submittedAt, label: attempt.assessment.title } : null,
      submission?.submittedAt ? { at: submission.submittedAt, label: `${submission.assignment.contentItem.title} (submission)` } : null,
    ].filter((c): c is { at: Date; label: string } => !!c).sort((a, b) => b.at.getTime() - a.at.getTime());
    const last = candidates[0] ?? null;
    const enrolledAt = profile.enrollments[0]?.enrolledAt ?? profile.enrollments[0]?.createdAt ?? null;
    const daysSinceActivity = last ? Math.floor((now.getTime() - last.at.getTime()) / DAY) : enrolledAt ? Math.floor((now.getTime() - enrolledAt.getTime()) / DAY) : null;
    const marked: MarkedSession[] = attendanceRows.map((r) => ({ startsAt: r.session.startsAt, status: r.status as MarkedSession['status'] }));
    const att = attendancePercent(marked);
    const overdue = Math.max(0, due - submitted);

    const prev = (existing?.status ?? null) as EngagementStatus | null;
    const { status, reasons } = engagementStatus({
      daysSinceActivity, daysSinceLogin: profile.user.lastLoginAt ? Math.floor((now.getTime() - profile.user.lastLoginAt.getTime()) / DAY) : null,
      activityLabel: last?.label ?? null, attendancePercent: att, overdueAssignments: overdue, previous: prev,
    }, DEFAULT_ENGAGEMENT);

    const changed = prev !== status;
    await this.prisma.$transaction(async (tx) => {
      await tx.studentEngagement.upsert({
        where: { studentId },
        create: { studentId, status, lastActivityAt: last?.at ?? null, lastActivityLabel: last?.label ?? null, reasons, computedAt: now },
        update: { status, lastActivityAt: last?.at ?? null, lastActivityLabel: last?.label ?? null, reasons, computedAt: now },
      });
      if (changed) await tx.engagementStatusHistory.create({ data: { studentId, fromStatus: prev, toStatus: status, reasons } });
    });

    // Staff are alerted on transitions into a concerning state, and only then.
    if (changed && (status === 'AT_RISK' || status === 'INACTIVE')) {
      const level = alertLevel(status, att);
      const name = `${profile.firstName} ${profile.lastName}`.trim();
      await this.notifyStaff(studentId, `${level} · ${name}`, reasons.join(' '), `inactivity:${studentId}:${status}:${now.toISOString().slice(0, 10)}`);
    }
    return changed;
  }

  private async notifyStaff(studentId: string, title: string, body: string, dedupeKey: string) {
    const staff = await this.prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: 'engagement.followup' } } } } } } },
      select: { id: true }, take: 50,
    });
    for (const u of staff) {
      await this.notify.notifyUser(u.id, 'INACTIVITY_ALERT', title, body, { dedupeKey, entityType: 'STUDENT', entityId: studentId, link: `/admin/students/${studentId}` });
    }
  }

  /** Staff view: students in a given state, most at risk first. */
  async list(status: string | undefined, take: number) {
    return this.prisma.studentEngagement.findMany({
      where: status ? { status } : { status: { in: ['AT_RISK', 'INACTIVE', 'REACTIVATED'] } },
      orderBy: [{ status: 'asc' }, { lastActivityAt: 'asc' }], take,
      select: { studentId: true, status: true, lastActivityAt: true, lastActivityLabel: true, reasons: true, computedAt: true, student: { select: { firstName: true, lastName: true } } },
    });
  }

  async followUp(studentId: string, assigneeId: string, note: string, dueAt: Date | null, actorId: string, meta: { ip?: string; userAgent?: string }) {
    const student = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) throw notFound('Student');
    const assignee = await this.prisma.user.findFirst({ where: { id: assigneeId, deletedAt: null, status: 'ACTIVE' }, select: { id: true } });
    if (!assignee) throw notFound('Staff member');
    const task = await this.prisma.followUpTask.create({ data: { studentId, assigneeId, note, dueAt, source: 'MANUAL', createdById: actorId }, select: { id: true } });
    await this.audit.record({ userId: actorId, ...meta, action: 'ADMIN_ASSIGNED_FOLLOW_UP', entityType: 'FollowUpTask', entityId: task.id, after: { studentId, assigneeId } });
    await this.notify.notifyUser(assigneeId, 'INACTIVITY_ALERT', 'A follow-up was assigned to you', note, { entityType: 'STUDENT', entityId: studentId, link: `/admin/students/${studentId}` });
    return task;
  }

  async myFollowUps(userId: string) {
    return this.prisma.followUpTask.findMany({
      where: { assigneeId: userId, status: 'OPEN' }, orderBy: { dueAt: 'asc' }, take: 100,
      select: { id: true, note: true, dueAt: true, createdAt: true, student: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async completeFollowUp(id: string, userId: string) {
    const r = await this.prisma.followUpTask.updateMany({ where: { id, assigneeId: userId, status: 'OPEN' }, data: { status: 'DONE' } });
    if (r.count === 0) {
      const exists = await this.prisma.followUpTask.findFirst({ where: { id, assigneeId: userId }, select: { id: true } });
      if (!exists) throw notFound('Follow-up');
      throw conflict('CONFLICT', 'This follow-up is already closed.');
    }
    return { ok: true };
  }

  // ───────── class reminders ─────────
  /** Sends each reminder once per recipient. Cancelled sessions are never reminded. */
  async sendReminders(now = new Date()) {
    if (this.config.CLASS_REMINDER_ENABLED !== 'true') return { sent: 0, disabled: true };
    const sessions = await this.prisma.liveSession.findMany({
      where: { startsAt: { gt: now, lte: new Date(now.getTime() + 25 * 60 * 60_000) }, status: { in: ['SCHEDULED'] } },
      select: { id: true, topic: true, title: true, startsAt: true, status: true, batchId: true, batch: { select: { timezone: true } } },
      take: 300,
    });
    let sent = 0;
    for (const s of sessions) {
      const due = dueReminders([{ id: s.id, topic: s.topic, title: s.title, startsAt: s.startsAt, status: s.status, timezone: s.batch.timezone }], REMINDER_OFFSETS_MINUTES, now);
      if (due.length === 0) continue;
      const students = await this.prisma.enrollment.findMany({ where: { batchId: s.batchId, status: 'ACTIVE', deletedAt: null }, select: { student: { select: { userId: true } } }, take: 1000 });
      for (const r of due) {
        for (const e of students) {
          if (await this.notify.notifyUser(e.student.userId, 'CLASS_REMINDER', r.title, r.body, {
            email: true, optional: true, dedupeKey: r.key, entityType: 'SESSION', entityId: s.id, link: '/student/schedule',
          })) sent++;
        }
      }
    }
    return { sent };
  }
}

// ───────── HTTP ─────────
const followUpSchema = z.object({
  assigneeId: z.string().uuid(),
  note: z.string().trim().min(3).max(500),
  dueAt: z.string().datetime().nullable().optional(),
});
const listQuery = z.object({ status: z.enum(['AT_RISK', 'INACTIVE', 'REACTIVATED', 'ACTIVE']).optional(), take: z.coerce.number().int().min(1).max(100).default(50) });
const actorMeta = (req: Request) => clientMeta(req);

@Controller()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @RequirePermission('engagement.followup') @Get('admin/engagement')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.engagement.list(q.status, q.take); }

  @RequirePermission('engagement.followup') @HttpCode(201) @Post('admin/students/:id/follow-ups')
  follow(@Param('id', uuid) id: string, @Body(new ZodPipe(followUpSchema)) body: z.infer<typeof followUpSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.engagement.followUp(id, body.assigneeId, body.note, body.dueAt ? new Date(body.dueAt) : null, u.id, actorMeta(req));
  }

  @RequirePermission('engagement.followup') @Get('me/follow-ups')
  mine(@CurrentUser() u: AuthUser) { return this.engagement.myFollowUps(u.id); }

  @RequirePermission('engagement.followup') @HttpCode(200) @Post('me/follow-ups/:id/done')
  done(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.engagement.completeFollowUp(id, u.id); }
}

@Module({ controllers: [EngagementController], providers: [EngagementService], exports: [EngagementService] })
export class EngagementModule {}


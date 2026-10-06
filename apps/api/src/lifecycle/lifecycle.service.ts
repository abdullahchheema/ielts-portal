import { Body, Controller, HttpCode, Inject, Injectable, Logger, Module, OnModuleInit, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EnrollmentActionInput, TransferInput, enrollmentActionSchema, transferSchema } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { Actor } from '../courses/courses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { EngagementModule, EngagementService } from '../engagement/engagement.service';

const DAY = 86_400_000;
const SWEEP_EVERY_MS = 5 * 60_000;

@Injectable()
export class LifecycleService implements OnModuleInit {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly scheduler: SchedulerService,
    private readonly engagement: EngagementService,
  ) {}

  /** Runs on the shared scheduler. The sweep is idempotent, so a missed or duplicated tick is harmless. */
  onModuleInit() {
    this.scheduler.register('lifecycle.sweep', SWEEP_EVERY_MS, () => this.sweep());
  }

  /** Safe to run on any number of instances: every state change is conditional and every reminder is de-duplicated. */
  async sweep(now = new Date()) {
    const expired = await this.expireEnrollments(now);
    // Class reminders come from the engagement module; its deduplication keys make repeated sweeps safe.
    const classSent = (await this.engagement.sendReminders(now)).sent;
    const reminders = (await this.expiryReminders(now)) + classSent + (await this.deadlineReminders(now));
    if (expired || reminders) this.logger.log(`Expired ${expired} enrollment(s); sent ${reminders} reminder(s).`);
    return { expired, reminders };
  }

  // ───────── expiry ─────────
  async expireEnrollments(now: Date): Promise<number> {
    const due = await this.prisma.enrollment.findMany({
      where: { status: 'ACTIVE', deletedAt: null, accessEndsAt: { lt: now } },
      select: { id: true, studentId: true, course: { select: { title: true } }, student: { select: { userId: true } } }, take: 200,
    });
    let n = 0;
    for (const e of due) {
      const claimed = await this.prisma.enrollment.updateMany({ where: { id: e.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
      if (claimed.count === 0) continue;
      n++;
      await this.prisma.studentTimelineEvent.create({ data: { studentId: e.studentId, type: 'ACCESS_EXPIRED', summary: `Access to ${e.course.title} ended`, meta: { enrollmentId: e.id } } });
      await this.notify.notifyUser(e.student.userId, 'ENROLLMENT_EXPIRED', 'Your course access has ended', `Your access to ${e.course.title} has expired. Contact us if you would like to extend it.`, {
        email: true, entityType: 'ENROLLMENT', entityId: e.id, link: `/student/application?open=${e.id}`,
      });
    }
    return n;
  }

  // ───────── reminders (each one is de-duplicated per user by key) ─────────
  private async expiryReminders(now: Date): Promise<number> {
    const soon = await this.prisma.enrollment.findMany({
      where: { status: 'ACTIVE', deletedAt: null, accessEndsAt: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } },
      select: { id: true, accessEndsAt: true, course: { select: { title: true } }, student: { select: { userId: true } } }, take: 500,
    });
    let n = 0;
    for (const e of soon) {
      const days = (e.accessEndsAt!.getTime() - now.getTime()) / DAY;
      for (const [threshold, key] of [[7, 'expiry7'], [1, 'expiry1']] as const) {
        if (days > threshold) continue;
        const sent = await this.notify.notifyUser(e.student.userId, 'EXPIRY_REMINDER', `${e.course.title}: access ends ${threshold === 1 ? 'tomorrow' : 'in about a week'}`, `Your access ends on ${e.accessEndsAt!.toDateString()}. Finish your remaining lessons and tests before then.`, {
          email: true, optional: true, dedupeKey: `${key}:${e.id}`, entityType: 'ENROLLMENT', entityId: e.id, link: `/student/application?open=${e.id}`,
        });
        if (sent) n++;
      }
    }
    return n;
  }

  private async deadlineReminders(now: Date): Promise<number> {
    const due = await this.prisma.assignment.findMany({
      where: { dueAt: { gt: now, lte: new Date(now.getTime() + DAY) } },
      select: { id: true, contentItem: { select: { title: true, section: { select: { courseVersionId: true } } } } }, take: 200,
    });
    let n = 0;
    for (const a of due) {
      const students = await this.prisma.enrollment.findMany({
        where: { courseVersionId: a.contentItem.section.courseVersionId, status: 'ACTIVE', deletedAt: null, student: { submissions: { none: { assignmentId: a.id, status: { in: ['SUBMITTED', 'GRADED'] } } } } },
        select: { student: { select: { userId: true } } },
      });
      for (const e of students) {
        if (await this.notify.notifyUser(e.student.userId, 'DEADLINE_REMINDER', `Due tomorrow: ${a.contentItem.title}`, 'Submit your work before the deadline.', {
          email: true, optional: true, dedupeKey: `due:${a.id}`, entityType: 'ENROLLMENT', entityId: a.id, link: '/student/application',
        })) n++;
      }
    }
    return n;
  }

  // ───────── staff actions ─────────
  /** Pause / resume / extend access. Extending an expired enrollment reactivates it. */
  async act(enrollmentId: string, input: EnrollmentActionInput, actor: Actor) {
    const info = await this.prisma.$transaction(async (tx) => {
      const e = await tx.enrollment.findFirst({ where: { id: enrollmentId, deletedAt: null }, include: { course: { select: { title: true } }, student: { select: { userId: true } } } });
      if (!e) throw notFound('Enrollment');
      const now = new Date();
      let data: { status?: 'ACTIVE' | 'PAUSED'; accessEndsAt?: Date } = {};

      if (input.action === 'PAUSE') {
        if (e.status !== 'ACTIVE') throw new AppError('CONFLICT', 409, 'Only an active enrollment can be paused.');
        data = { status: 'PAUSED' };
      } else if (input.action === 'RESUME') {
        if (e.status !== 'PAUSED') throw new AppError('CONFLICT', 409, 'Only a paused enrollment can be resumed.');
        if (e.accessEndsAt && e.accessEndsAt <= now) throw new AppError('CONFLICT', 409, 'Access has already ended — extend it instead.');
        data = { status: 'ACTIVE' };
      } else {
        if (!['ACTIVE', 'PAUSED', 'EXPIRED', 'COMPLETED'].includes(e.status)) throw new AppError('CONFLICT', 409, `A ${e.status.toLowerCase()} enrollment cannot be extended.`);
        const base = e.accessEndsAt && e.accessEndsAt > now ? e.accessEndsAt : now;
        data = { accessEndsAt: new Date(base.getTime() + input.days * DAY), ...(e.status === 'EXPIRED' ? { status: 'ACTIVE' as const } : {}) };
      }
      const after = await tx.enrollment.update({ where: { id: enrollmentId }, data });
      await tx.studentTimelineEvent.create({ data: { studentId: e.studentId, type: 'ENROLLMENT_' + input.action, summary: `${e.course.title}: ${input.action.toLowerCase()}${input.action === 'EXTEND' ? ` by ${input.days} days` : ''}`, meta: { enrollmentId } } });
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_ENROLLMENT', entityType: 'Enrollment', entityId: enrollmentId, before: { status: e.status, accessEndsAt: e.accessEndsAt }, after: { status: after.status, accessEndsAt: after.accessEndsAt, action: input.action, note: input.note } }, tx);
      return { userId: e.student.userId, title: e.course.title, after };
    });
    if (input.action === 'EXTEND') await this.notify.notifyUser(info.userId, 'ENROLLMENT_EXTENDED', 'Your access was extended', `${info.title} is available until ${info.after.accessEndsAt!.toDateString()}.`, {
      email: true, entityType: 'ENROLLMENT', entityId: enrollmentId, link: `/student/application?open=${enrollmentId}`,
    });
    return info.after;
  }

  /**
   * Moves a student to another batch of the same course version. History is kept in enrollment_transfers;
   * progress carries over because the content tree is identical. Both batches are locked in a fixed order.
   */
  async transfer(enrollmentId: string, input: TransferInput, actor: Actor) {
    const info = await this.prisma.$transaction(async (tx) => {
      const e = await tx.enrollment.findFirst({ where: { id: enrollmentId, deletedAt: null }, include: { student: { select: { userId: true } }, batch: { select: { name: true } } } });
      if (!e) throw notFound('Enrollment');
      if (!['ACTIVE', 'PAUSED'].includes(e.status)) throw new AppError('CONFLICT', 409, 'Only an active or paused enrollment can be transferred.');
      if (e.batchId === input.toBatchId) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { toBatchId: 'The student is already in this batch.' });

      const to = await tx.batch.findFirst({ where: { id: input.toBatchId, deletedAt: null } });
      if (!to) throw notFound('Batch');
      if (to.courseId !== e.courseId || to.courseVersionId !== e.courseVersionId) throw new AppError('CONFLICT', 409, 'Transfers are only possible between batches running the same course version.');
      if (!['OPEN', 'IN_PROGRESS'].includes(to.status)) throw new AppError('BATCH_NOT_OPEN', 409, `The target batch is ${to.status.toLowerCase()}.`);
      if (await tx.enrollment.findFirst({ where: { studentId: e.studentId, batchId: to.id, deletedAt: null, status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'PAUSED'] } } })) throw new AppError('ENROLLMENT_ALREADY_EXISTS', 409, 'The student is already enrolled in the target batch.');

      await tx.enrollment.update({ where: { id: enrollmentId }, data: { batchId: to.id } });
      await tx.enrollmentTransfer.create({ data: { enrollmentId, fromBatchId: e.batchId, toBatchId: to.id, reason: input.reason, approvedBy: actor.userId } });
      await tx.studentTimelineEvent.create({ data: { studentId: e.studentId, type: 'BATCH_TRANSFER', summary: `Moved from ${e.batch.name} to ${to.name}`, meta: { enrollmentId } } });
      await this.audit.record({ ...actor, action: 'ADMIN_TRANSFERRED_ENROLLMENT', entityType: 'Enrollment', entityId: enrollmentId, before: { batchId: e.batchId }, after: { batchId: to.id, reason: input.reason } }, tx);
      return { userId: e.student.userId, from: e.batch.name, to: to.name };
    });
    await this.notify.notifyUser(info.userId, 'BATCH_TRANSFERRED', 'You have been moved to another batch', `From ${info.from} to ${info.to}. Check your Live classes page for the new schedule.`, {
      email: true, entityType: 'ENROLLMENT', entityId: enrollmentId, link: `/student/application?open=${enrollmentId}`,
    });
    return { ok: true };
  }
}

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller('admin/enrollments')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @RequirePermission('enrollment.create') @HttpCode(200) @Post(':id/action')
  act(@Param('id', uuid) id: string, @Body(new ZodPipe(enrollmentActionSchema)) body: EnrollmentActionInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.lifecycle.act(id, body, actor(u, req)); }

  @RequirePermission('enrollment.create') @HttpCode(200) @Post(':id/transfer')
  transfer(@Param('id', uuid) id: string, @Body(new ZodPipe(transferSchema)) body: TransferInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.lifecycle.transfer(id, body, actor(u, req)); }
}

@Module({ imports: [EngagementModule], controllers: [LifecycleController], providers: [LifecycleService], exports: [LifecycleService] })
export class LifecycleModule {}

import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AttendanceInput, SessionInput, UpdateSessionInput, attendanceSchema, sessionSchema, updateSessionSchema } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

const JOIN_EARLY_MS = 15 * 60_000;
export interface Reviewer { userId: string; mentorId?: string; canOverseeAll: boolean }
const bad = (field: string, msg: string) => new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { [field]: msg });

@Injectable()
export class LiveService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotificationsService) {}

  /** Mentors act only on batches they are assigned to; academic admins on any. */
  private async assertBatch(r: Reviewer, batchId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) throw notFound('Batch');
    if (r.canOverseeAll) return batch;
    const ok = r.mentorId ? await this.prisma.batchMentor.count({ where: { batchId, mentorId: r.mentorId } }) : 0;
    if (!ok) throw forbidden('You are not assigned to this batch.');
    return batch;
  }

  private checkTimes(startsAt: string | Date, endsAt: string | Date) {
    if (new Date(endsAt) <= new Date(startsAt)) throw bad('endsAt', 'The session must end after it starts.');
  }

  // ───────── mentor / admin ─────────
  async create(r: Reviewer, batchId: string, input: SessionInput, actor: Actor) {
    const batch = await this.assertBatch(r, batchId);
    this.checkTimes(input.startsAt, input.endsAt);
    const session = await this.prisma.$transaction(async (tx) => {
      const s = await tx.liveSession.create({
        data: { batchId, mentorId: r.mentorId ?? null, topic: input.topic, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), provider: input.provider, meetingUrl: input.meetingUrl },
      });
      await this.audit.record({ ...actor, action: 'LIVE_SESSION_CREATED', entityType: 'LiveSession', entityId: s.id, after: { batchId, topic: s.topic, startsAt: s.startsAt } }, tx);
      return s;
    });
    // Tell enrolled students (in-app; best effort).
    const students = await this.prisma.enrollment.findMany({ where: { batchId, status: 'ACTIVE', deletedAt: null }, select: { student: { select: { userId: true } } } });
    for (const e of students) await this.notify.notifyUser(e.student.userId, 'SESSION_SCHEDULED', 'New live class', `${input.topic} — ${new Date(input.startsAt).toUTCString()} (${batch.name})`);
    return session;
  }

  async update(r: Reviewer, id: string, input: UpdateSessionInput, actor: Actor) {
    const before = await this.prisma.liveSession.findUnique({ where: { id } });
    if (!before) throw notFound('Session');
    await this.assertBatch(r, before.batchId);
    this.checkTimes(input.startsAt ?? before.startsAt, input.endsAt ?? before.endsAt);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.liveSession.update({
        where: { id },
        data: { topic: input.topic, provider: input.provider, meetingUrl: input.meetingUrl, recordingUrl: input.recordingUrl, startsAt: input.startsAt ? new Date(input.startsAt) : undefined, endsAt: input.endsAt ? new Date(input.endsAt) : undefined },
      });
      await this.audit.record({ ...actor, action: 'LIVE_SESSION_UPDATED', entityType: 'LiveSession', entityId: id, before, after }, tx);
      return after;
    });
  }

  async remove(r: Reviewer, id: string, actor: Actor) {
    const s = await this.prisma.liveSession.findUnique({ where: { id }, include: { _count: { select: { attendance: true } } } });
    if (!s) throw notFound('Session');
    await this.assertBatch(r, s.batchId);
    if (s._count.attendance > 0) throw new AppError('CONFLICT', 409, 'Attendance has been recorded for this session, so it cannot be deleted.');
    await this.prisma.$transaction(async (tx) => {
      await tx.liveSession.delete({ where: { id } });
      await this.audit.record({ ...actor, action: 'LIVE_SESSION_DELETED', entityType: 'LiveSession', entityId: id, before: s }, tx);
    });
  }

  async forBatch(r: Reviewer, batchId: string) {
    await this.assertBatch(r, batchId);
    return this.prisma.liveSession.findMany({ where: { batchId }, orderBy: { startsAt: 'asc' }, include: { _count: { select: { attendance: true } } } });
  }

  async attendanceSheet(r: Reviewer, sessionId: string) {
    const s = await this.prisma.liveSession.findUnique({ where: { id: sessionId } });
    if (!s) throw notFound('Session');
    await this.assertBatch(r, s.batchId);
    const [enrollments, records] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { batchId: s.batchId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { student: { select: { id: true, firstName: true, lastName: true } } } }),
      this.prisma.attendance.findMany({ where: { sessionId } }),
    ]);
    const byStudent = new Map(records.map((x) => [x.studentId, x]));
    return {
      session: { id: s.id, topic: s.topic, startsAt: s.startsAt, endsAt: s.endsAt },
      roster: enrollments.map((e) => ({ studentId: e.student.id, name: `${e.student.firstName} ${e.student.lastName}`, status: byStudent.get(e.student.id)?.status ?? null, minutesAttended: byStudent.get(e.student.id)?.minutesAttended ?? null })),
    };
  }

  async markAttendance(r: Reviewer, sessionId: string, input: AttendanceInput, actor: Actor) {
    const s = await this.prisma.liveSession.findUnique({ where: { id: sessionId } });
    if (!s) throw notFound('Session');
    await this.assertBatch(r, s.batchId);
    const enrolled = new Set((await this.prisma.enrollment.findMany({ where: { batchId: s.batchId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { studentId: true } })).map((e) => e.studentId));
    const stranger = input.records.find((x) => !enrolled.has(x.studentId));
    if (stranger) throw bad('records', 'One of the students is not enrolled in this batch.');
    await this.prisma.$transaction(async (tx) => {
      for (const x of input.records) {
        await tx.attendance.upsert({
          where: { sessionId_studentId: { sessionId, studentId: x.studentId } },
          create: { sessionId, studentId: x.studentId, status: x.status, minutesAttended: x.minutesAttended, markedBy: actor.userId },
          update: { status: x.status, minutesAttended: x.minutesAttended ?? null, markedBy: actor.userId },
        });
      }
      await this.audit.record({ ...actor, action: 'ATTENDANCE_MARKED', entityType: 'LiveSession', entityId: sessionId, after: { count: input.records.length } }, tx);
    });
    return { ok: true };
  }

  // ───────── student ─────────
  /** Upcoming classes for the student's active batches. The join link only appears shortly before/during the class. */
  async mine(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { batchId: true, accessEndsAt: true } });
    const batchIds = enrollments.filter((e) => !e.accessEndsAt || e.accessEndsAt > new Date()).map((e) => e.batchId);
    if (!batchIds.length) return { upcoming: [], past: [] };
    const now = Date.now();
    const rows = await this.prisma.liveSession.findMany({
      where: { batchId: { in: batchIds }, OR: [{ endsAt: { gte: new Date(now) } }, { endsAt: { gte: new Date(now - 30 * 86_400_000) } }] },
      orderBy: { startsAt: 'asc' }, include: { batch: { select: { name: true, course: { select: { title: true } } } }, attendance: { where: { studentId }, select: { status: true } } },
    });
    const shape = (s: (typeof rows)[number]) => ({
      id: s.id, topic: s.topic, startsAt: s.startsAt, endsAt: s.endsAt, provider: s.provider, batch: s.batch.name, course: s.batch.course.title,
      joinUrl: s.meetingUrl && now >= s.startsAt.getTime() - JOIN_EARLY_MS && now <= s.endsAt.getTime() ? s.meetingUrl : null,
      recordingUrl: s.endsAt.getTime() < now ? s.recordingUrl : null, attendance: s.attendance[0]?.status ?? null,
    });
    return { upcoming: rows.filter((s) => s.endsAt.getTime() >= now).map(shape), past: rows.filter((s) => s.endsAt.getTime() < now).reverse().map(shape) };
  }

  async attendanceSummary(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null }, select: { id: true, batchId: true, course: { select: { title: true } } } });
    return Promise.all(enrollments.map(async (e) => {
      const held = await this.prisma.liveSession.count({ where: { batchId: e.batchId, endsAt: { lt: new Date() } } });
      const rows = await this.prisma.attendance.groupBy({ by: ['status'], where: { studentId, session: { batchId: e.batchId } }, _count: true });
      const n = (st: string) => rows.find((r) => r.status === st)?._count ?? 0;
      const attended = n('PRESENT') + n('LATE');
      return { enrollmentId: e.id, course: e.course.title, sessionsHeld: held, present: n('PRESENT'), late: n('LATE'), absent: n('ABSENT'), excused: n('EXCUSED'), attendancePercent: held ? Math.round((attended / held) * 100) : null };
    }));
  }
}

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller()
export class LiveController {
  constructor(private readonly live: LiveService, private readonly ctx: UserContextService) {}

  private async rev(u: AuthUser): Promise<Reviewer> {
    const c = (await this.ctx.get(u.id))!;
    return { userId: u.id, mentorId: u.mentorId, canOverseeAll: c.permissions.has('batch.create') };
  }

  @RequirePermission('teaching.view') @Get('mentor/batches/:id/sessions')
  async forBatch(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.live.forBatch(await this.rev(u), id); }

  @RequirePermission('teaching.view') @Post('mentor/batches/:id/sessions')
  async create(@Param('id', uuid) id: string, @Body(new ZodPipe(sessionSchema)) body: SessionInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.live.create(await this.rev(u), id, body, actor(u, req)); }

  @RequirePermission('teaching.view') @Patch('mentor/sessions/:id')
  async update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateSessionSchema)) body: UpdateSessionInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.live.update(await this.rev(u), id, body, actor(u, req)); }

  @RequirePermission('teaching.view') @HttpCode(204) @Delete('mentor/sessions/:id')
  async remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { await this.live.remove(await this.rev(u), id, actor(u, req)); }

  @RequirePermission('teaching.view') @Get('mentor/sessions/:id/attendance')
  async sheet(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.live.attendanceSheet(await this.rev(u), id); }

  @RequirePermission('teaching.view') @Put('mentor/sessions/:id/attendance')
  async mark(@Param('id', uuid) id: string, @Body(new ZodPipe(attendanceSchema)) body: AttendanceInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.live.markAttendance(await this.rev(u), id, body, actor(u, req)); }

  @Get('me/sessions')
  mine(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts can do this.');
    return this.live.mine(u.studentId);
  }

  @Get('me/attendance')
  attendance(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts can do this.');
    return this.live.attendanceSummary(u.studentId);
  }
}

@Module({ controllers: [LiveController], providers: [LiveService], exports: [LiveService] })
export class LiveModule {}

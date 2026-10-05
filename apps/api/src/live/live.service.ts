import { overseesAllBatches } from '../common/scope';
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
    for (const e of students) {
      await this.notify.notifyUser(e.student.userId, 'SESSION_SCHEDULED', 'New live class', `${input.topic} — ${new Date(input.startsAt).toUTCString()} (${batch.name})`, {
        entityType: 'SESSION', entityId: session.id, link: '/student/schedule',
      });
    }
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

  /** Every audited correction to a mark in this session, newest first, with who made it and what changed. */
  async attendanceHistory(r: Reviewer, sessionId: string) {
    const s = await this.prisma.liveSession.findUnique({ where: { id: sessionId } });
    if (!s) throw notFound('Session');
    await this.assertBatch(r, s.batchId);
    const marks = await this.prisma.attendance.findMany({ where: { sessionId }, select: { id: true, studentId: true, student: { select: { firstName: true, lastName: true } } } });
    if (marks.length === 0) return [];
    const byId = new Map(marks.map((m) => [m.id, m]));
    const logs = await this.prisma.auditLog.findMany({
      where: { action: 'ATTENDANCE_CORRECTED', entityType: 'Attendance', entityId: { in: [...byId.keys()] } },
      orderBy: { createdAt: 'desc' }, take: 200,
      select: { createdAt: true, userId: true, beforeJson: true, afterJson: true, entityId: true },
    });
    return logs.map((l) => {
      const mark = byId.get(l.entityId ?? '');
      return {
        at: l.createdAt, actorId: l.userId,
        student: mark ? `${mark.student.firstName} ${mark.student.lastName}` : null,
        studentId: mark?.studentId ?? null,
        before: l.beforeJson, after: l.afterJson,
      };
    });
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
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const before = new Map((await tx.attendance.findMany({
        where: { sessionId, studentId: { in: input.records.map((x) => x.studentId) } },
      })).map((a) => [a.studentId, a]));
      const corrections: { attendanceId: string; studentId: string; before: AttendanceSnapshot; after: AttendanceSnapshot }[] = [];
      for (const x of input.records) {
        const prev = before.get(x.studentId);
        const noteProvided = x.note !== undefined;
        const note = noteProvided ? (x.note || null) : (prev?.note ?? null);
        const row = await tx.attendance.upsert({
          where: { sessionId_studentId: { sessionId, studentId: x.studentId } },
          create: { sessionId, studentId: x.studentId, status: x.status, minutesAttended: x.minutesAttended, note, markedBy: actor.userId, markedAt: now },
          update: { status: x.status, minutesAttended: x.minutesAttended ?? null, ...(noteProvided ? { note } : {}), markedBy: actor.userId, markedAt: now },
        });
        // A correction is a change to a status or note that already existed. An unchanged re-save writes no diff.
        const changed = prev && (prev.status !== x.status || (prev.note ?? null) !== note);
        if (prev && changed) corrections.push({ attendanceId: row.id, studentId: x.studentId, before: snapshot(prev), after: snapshot(row) });
      }
      await this.audit.record({ ...actor, action: 'ATTENDANCE_MARKED', entityType: 'LiveSession', entityId: sessionId, after: { count: input.records.length, corrected: corrections.length } }, tx);
      // Per-record before and after for corrections, so a change to a historical record is never anonymous.
      if (corrections.length > 0 && corrections.length <= 50) {
        for (const c of corrections) {
          await this.audit.record({ ...actor, action: 'ATTENDANCE_CORRECTED', entityType: 'Attendance', entityId: c.attendanceId, before: c.before, after: c.after }, tx);
        }
      } else if (corrections.length > 50) {
        await this.audit.record({ ...actor, action: 'ATTENDANCE_CORRECTED_BULK', entityType: 'LiveSession', entityId: sessionId, after: { corrections } }, tx);
      }
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

  /** Attendance per enrolment. Counts only sessions held after the student joined, and runs a fixed number of queries. */
  async attendanceSummary(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId, deletedAt: null }, select: { id: true, batchId: true, enrolledAt: true, accessStartsAt: true, createdAt: true, course: { select: { title: true } } },
    });
    if (enrollments.length === 0) return [];
    const batchIds = [...new Set(enrollments.map((e) => e.batchId))];
    const [sessions, rows] = await Promise.all([
      this.prisma.liveSession.findMany({ where: { batchId: { in: batchIds }, endsAt: { lt: new Date() } }, select: { id: true, batchId: true, startsAt: true } }),
      this.prisma.attendance.findMany({ where: { studentId, session: { batchId: { in: batchIds } } }, select: { sessionId: true, status: true } }),
    ]);
    const statusBySession = new Map(rows.map((r) => [r.sessionId, r.status]));
    return enrollments.map((e) => {
      const from = (e.accessStartsAt ?? e.enrolledAt ?? e.createdAt).getTime();
      const held = sessions.filter((s) => s.batchId === e.batchId && s.startsAt.getTime() >= from);
      const count = (st: string) => held.filter((s) => statusBySession.get(s.id) === st).length;
      const present = count('PRESENT'), late = count('LATE'), absent = count('ABSENT'), excused = count('EXCUSED');
      const denom = held.length - excused; // an excused absence is neither attended nor a risk signal
      return {
        enrollmentId: e.id, course: e.course.title, sessionsHeld: held.length, present, late, absent, excused,
        attendancePercent: denom > 0 ? Math.round(((present + late) / denom) * 100) : null,
      };
    });
  }
}

type AttendanceSnapshot = { status: string; note: string | null; markedBy: string | null; markedAt: Date | null };
const snapshot = (a: { status: string; note: string | null; markedBy: string | null; markedAt: Date | null }): AttendanceSnapshot =>
  ({ status: a.status, note: a.note ?? null, markedBy: a.markedBy ?? null, markedAt: a.markedAt ?? null });

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller()
export class LiveController {
  constructor(private readonly live: LiveService, private readonly ctx: UserContextService) {}

  private async rev(u: AuthUser): Promise<Reviewer> {
    const c = (await this.ctx.get(u.id))!;
    return { userId: u.id, mentorId: u.mentorId, canOverseeAll: overseesAllBatches(c.permissions) };
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

  @RequirePermission('teaching.view') @Get('mentor/sessions/:id/attendance/history')
  async history(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.live.attendanceHistory(await this.rev(u), id); }

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

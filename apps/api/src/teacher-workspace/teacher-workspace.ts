import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { toCsv } from '../analytics/csv';
import { SettingsService } from '../settings/settings.service';
import { conflict, forbidden, notFound, AppError } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';
import { attendancePercent, MarkedSession } from '../engagement/engagement-rules';
import { batchHealth, BatchMetrics, isSuppressed } from './batch-health';

const uuid = new ParseUUIDPipe();
const HEALTH_CACHE_MS = 60 * 60_000;
const DAY = 86_400_000;

type Reviewer = { userId: string; mentorId?: string; canOverseeAll: boolean };

/** A reviewer may act on a batch they are assigned to. Administrators with batch oversight may act on any. */
async function batchScope(prisma: PrismaService, r: Reviewer): Promise<string[] | 'ALL'> {
  if (r.canOverseeAll) return 'ALL';
  if (!r.mentorId) return [];
  const rows = await prisma.batchMentor.findMany({ where: { mentorId: r.mentorId }, select: { batchId: true } });
  return rows.map((x) => x.batchId);
}

@Injectable()
export class TeacherWorkspaceService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService, private readonly audit: AuditService) {}

  /** The teacher's own dashboard counts. Only assigned batches contribute. */
  async summary(r: Reviewer) {
    const scope = await batchScope(this.prisma, r);
    const batchWhere = scope === 'ALL' ? {} : { batchId: { in: scope } };
    const targetHours = await this.settings.get<number>('analytics.grading.target_hours').catch(() => 48);
    const overdueBefore = new Date(Date.now() - targetHours * 3_600_000);
    const startToday = new Date(); startToday.setUTCHours(0, 0, 0, 0);
    const [writing, speaking, overdue, classes, atRisk, open] = await Promise.all([
      this.prisma.submission.count({ where: { status: 'SUBMITTED', assignment: { skill: 'WRITING' }, enrollment: batchWhere.batchId ? { batchId: batchWhere.batchId } : {} } }),
      this.prisma.submission.count({ where: { status: 'SUBMITTED', assignment: { skill: 'SPEAKING' }, enrollment: batchWhere.batchId ? { batchId: batchWhere.batchId } : {} } }),
      this.prisma.submission.count({ where: { status: 'SUBMITTED', submittedAt: { lt: overdueBefore }, enrollment: batchWhere.batchId ? { batchId: batchWhere.batchId } : {} } }),
      this.prisma.liveSession.count({ where: { ...batchWhere, startsAt: { gte: startToday, lt: new Date(startToday.getTime() + DAY) }, status: { not: 'CANCELLED' } } }),
      this.prisma.studentEngagement.count({ where: { status: { in: ['AT_RISK', 'INACTIVE'] }, student: { enrollments: { some: { status: 'ACTIVE', ...(batchWhere.batchId ? { batchId: batchWhere.batchId } : {}) } } } } }),
      this.prisma.followUpTask.count({ where: { status: 'OPEN', assigneeId: r.userId } }),
    ]);
    return { pendingGrading: { writing, speaking, total: writing + speaking }, overdueGrading: overdue, todayClasses: classes, studentsAtRisk: atRisk, openFollowUps: open, targetHours };
  }

  /** Grading queue, oldest first, with a priority flag for anything past the target turnaround. */
  async queue(r: Reviewer, skill: 'WRITING' | 'SPEAKING' | undefined, take: number) {
    const scope = await batchScope(this.prisma, r);
    const targetHours = await this.settings.get<number>('analytics.grading.target_hours').catch(() => 48);
    const rows = await this.prisma.submission.findMany({
      where: {
        status: 'SUBMITTED',
        ...(skill ? { assignment: { skill } } : {}),
        ...(scope === 'ALL' ? {} : { enrollment: { batchId: { in: scope } } }),
      },
      orderBy: { submittedAt: 'asc' }, take,
      select: {
        id: true, status: true, submittedAt: true, late: true, revision: true,
        student: { select: { firstName: true, lastName: true } },
        enrollment: { select: { batch: { select: { id: true, name: true } } } },
        assignment: { select: { skill: true, contentItem: { select: { title: true } } } },
      },
    });
    const now = Date.now();
    return rows.map((s) => {
      const ageHours = s.submittedAt ? Math.floor((now - s.submittedAt.getTime()) / 3_600_000) : 0;
      return {
        id: s.id,
        student: `${s.student.firstName} ${s.student.lastName}`.trim(),
        batch: s.enrollment?.batch.name ?? '—',
        batchId: s.enrollment?.batch.id ?? null,
        assessment: s.assignment.contentItem.title,
        skill: s.assignment.skill,
        submittedAt: s.submittedAt,
        ageHours,
        priority: ageHours >= targetHours ? 'OVERDUE' : s.late ? 'LATE' : 'NORMAL',
        status: s.status,
      };
    });
  }

  private async assertSubmissionScope(r: Reviewer, submissionId: string) {
    const s = await this.prisma.submission.findUnique({ where: { id: submissionId }, select: { id: true, status: true, revision: true, enrollment: { select: { batchId: true } } } });
    if (!s) throw notFound('Submission');
    const scope = await batchScope(this.prisma, r);
    if (scope !== 'ALL' && !(s.enrollment && scope.includes(s.enrollment.batchId))) throw notFound('Submission');
    return s;
  }

  async getDraft(r: Reviewer, submissionId: string) {
    await this.assertSubmissionScope(r, submissionId);
    if (!r.mentorId) throw forbidden('Only teachers keep grading drafts.');
    const d = await this.prisma.gradingDraft.findUnique({ where: { submissionId_mentorId: { submissionId, mentorId: r.mentorId } } });
    return d ? { revision: d.revision, scores: d.scores, comment: d.comment, updatedAt: d.updatedAt } : { revision: 0, scores: [], comment: null, updatedAt: null };
  }

  /**
   * Autosave. The request must carry the revision the teacher last saw; a stale save is refused, so two open tabs
   * cannot overwrite each other silently.
   */
  async saveDraft(r: Reviewer, submissionId: string, input: { revision: number; scores: { criterionId: string; score: number }[]; comment: string | null }) {
    await this.assertSubmissionScope(r, submissionId);
    if (!r.mentorId) throw forbidden('Only teachers keep grading drafts.');
    const mentorId = r.mentorId;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.gradingDraft.findUnique({ where: { submissionId_mentorId: { submissionId, mentorId } }, select: { revision: true } });
      if (!existing) {
        if (input.revision !== 0) throw new AppError('ANSWER_SAVE_CONFLICT', 409, 'This draft changed elsewhere. Reload to see the latest.', { revision: 0 });
        const created = await tx.gradingDraft.create({ data: { submissionId, mentorId, scores: input.scores, comment: input.comment, revision: 1 } });
        return { revision: created.revision };
      }
      if (existing.revision !== input.revision) {
        throw new AppError('ANSWER_SAVE_CONFLICT', 409, 'This draft changed elsewhere. Reload to see the latest.', { revision: existing.revision });
      }
      const claimed = await tx.gradingDraft.updateMany({
        where: { submissionId, mentorId, revision: input.revision },
        data: { scores: input.scores, comment: input.comment, revision: { increment: 1 } },
      });
      if (claimed.count === 0) throw conflict('ANSWER_SAVE_CONFLICT', 'This draft changed elsewhere. Reload to see the latest.');
      return { revision: input.revision + 1 };
    });
  }

  // ───────── batch health ─────────
  async batchHealth(batchId: string, r: Reviewer, now = new Date()) {
    const scope = await batchScope(this.prisma, r);
    if (scope !== 'ALL' && !scope.includes(batchId)) throw notFound('Batch');
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, deletedAt: null }, select: { id: true, name: true } });
    if (!batch) throw notFound('Batch');
    const cached = await this.prisma.batchHealthSnapshot.findUnique({ where: { batchId } });
    if (cached && now.getTime() - cached.computedAt.getTime() < HEALTH_CACHE_MS) {
      return { batch: batch.name, ...(cached.payload as object), cached: true };
    }
    const metrics = await this.computeMetrics(batchId, now);
    const health = batchHealth(metrics);
    const payload = { metrics, status: health.status, reasons: health.reasons, computedAt: now };
    await this.prisma.batchHealthSnapshot.upsert({
      where: { batchId }, create: { batchId, payload: payload as unknown as object, inputsHash: 'v1' }, update: { payload: payload as unknown as object, computedAt: now },
    });
    return { batch: batch.name, ...payload, cached: false };
  }

  async computeMetrics(batchId: string, now: Date): Promise<BatchMetrics> {
    const enrolments = await this.prisma.enrollment.findMany({
      where: { batchId, status: { in: ['ACTIVE', 'COMPLETED'] }, deletedAt: null },
      select: { progressPercent: true, status: true, student: { select: { id: true, targetBand: true, currentBand: true } } },
      take: 1000,
    });
    const active = enrolments.filter((e) => e.status === 'ACTIVE');
    const ids = enrolments.map((e) => e.student.id);
    const [att, mockStudents, risk, due, submitted] = await Promise.all([
      this.prisma.attendance.findMany({ where: { studentId: { in: ids }, session: { batchId } }, select: { status: true, studentId: true, session: { select: { startsAt: true } } }, take: 5000 }),
      this.prisma.assessmentAttempt.findMany({ where: { studentId: { in: ids }, assessment: { type: 'MOCK' }, submittedAt: { gte: new Date(now.getTime() - 30 * DAY) } }, select: { studentId: true }, distinct: ['studentId'], take: 1000 }),
      this.prisma.studentEngagement.count({ where: { studentId: { in: ids }, status: { in: ['AT_RISK', 'INACTIVE'] } } }),
      this.prisma.assignment.count({ where: { dueAt: { lt: now }, contentItem: { section: { version: { enrollments: { some: { batchId, status: 'ACTIVE' } } } } } } }),
      this.prisma.submission.count({ where: { studentId: { in: ids }, status: { in: ['SUBMITTED', 'GRADED'] } } }),
    ]);
    const byStudent = new Map<string, MarkedSession[]>();
    for (const a of att) byStudent.set(a.studentId, [...(byStudent.get(a.studentId) ?? []), { startsAt: a.session.startsAt, status: a.status as MarkedSession['status'] }]);
    const allMarked = [...byStudent.values()].flat();
    const attPct = attendancePercent(allMarked);
    const completion = enrolments.length ? enrolments.reduce((s, e) => s + Number(e.progressPercent), 0) / enrolments.length : null;
    const mockPct = active.length ? Math.round((new Set(mockStudents.map((m) => m.studentId)).size / active.length) * 100) : null;
    const gaps = enrolments.filter((e) => e.student.targetBand !== null && e.student.currentBand !== null)
      .map((e) => Number(e.student.targetBand) - Number(e.student.currentBand));
    return {
      activeStudents: active.length,
      attendancePercent: attPct,
      completionPercent: completion === null ? null : Math.round(completion),
      mockCompletionPercent: mockPct,
      atRiskStudents: risk,
      pendingAssignments: Math.max(0, due * active.length - submitted),
      averageTargetGap: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null,
      averageImprovement: null,
    };
  }

  async allBatchHealth(take: number) {
    const batches = await this.prisma.batch.findMany({ where: { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true }, take });
    const out = [];
    for (const b of batches) out.push(await this.batchHealth(b.id, { userId: '', canOverseeAll: true }));
    return out;
  }

  // ───────── cohorts ─────────
  /**
   * Compares batches, or enrolment months, on enrolment, activation, attendance and completion. A group smaller than
   * the minimum size is withheld entirely, so no single student can be picked out.
   */
  async cohorts(groupBy: 'batch' | 'month', from: Date | undefined, to: Date | undefined) {
    const rows = await this.prisma.enrollment.findMany({
      where: { deletedAt: null, createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
      select: { status: true, createdAt: true, progressPercent: true, batch: { select: { id: true, name: true } }, studentId: true },
      take: 5000,
    });
    const groups = new Map<string, { label: string; rows: typeof rows }>();
    for (const r of rows) {
      const key = groupBy === 'batch' ? r.batch.id : `${r.createdAt.getUTCFullYear()}-${String(r.createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = groupBy === 'batch' ? r.batch.name : key;
      const g = groups.get(key) ?? { label, rows: [] as typeof rows };
      g.rows.push(r);
      groups.set(key, g);
    }
    return [...groups.entries()].map(([key, g]) => {
      const size = g.rows.length;
      if (isSuppressed(size)) return { key, label: g.label, size, suppressed: true as const };
      const active = g.rows.filter((r) => r.status === 'ACTIVE' || r.status === 'COMPLETED').length;
      const completion = g.rows.reduce((s, r) => s + Number(r.progressPercent), 0) / size;
      return { key, label: g.label, size, suppressed: false as const, enrolled: size, activationPercent: Math.round((active / size) * 100), completionPercent: Math.round(completion) };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }
}

// ───────── HTTP ─────────
const draftSchema = z.object({
  revision: z.number().int().min(0),
  scores: z.array(z.object({ criterionId: z.string().uuid(), score: z.number().min(0).max(9) })).max(20),
  comment: z.string().max(4000).nullable(),
});
const queueQuery = z.object({ skill: z.enum(['WRITING', 'SPEAKING']).optional(), take: z.coerce.number().int().min(1).max(200).default(100) });
const cohortQuery = z.object({
  groupBy: z.enum(['batch', 'month']).default('batch'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

async function reviewer(ctx: UserContextService, u: AuthUser): Promise<Reviewer> {
  const c = (await ctx.get(u.id))!;
  return { userId: u.id, mentorId: u.mentorId, canOverseeAll: c.permissions.has('batch.create') };
}

@Controller()
export class TeacherWorkspaceController {
  constructor(private readonly ws: TeacherWorkspaceService, private readonly ctx: UserContextService, private readonly audit: AuditService) {}

  @RequirePermission('teaching.view') @Get('mentor/workspace/summary')
  async summary(@CurrentUser() u: AuthUser) { return this.ws.summary(await reviewer(this.ctx, u)); }

  @RequirePermission('teaching.view') @Get('mentor/workspace/queue')
  async queue(@Query(new ZodPipe(queueQuery)) q: z.infer<typeof queueQuery>, @CurrentUser() u: AuthUser) {
    return this.ws.queue(await reviewer(this.ctx, u), q.skill, q.take);
  }

  @RequirePermission('teaching.view') @Get('mentor/submissions/:id/draft')
  async draft(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.ws.getDraft(await reviewer(this.ctx, u), id); }

  @RequirePermission('teaching.view') @HttpCode(200) @Put('mentor/submissions/:id/draft')
  async saveDraft(@Param('id', uuid) id: string, @Body(new ZodPipe(draftSchema)) body: z.infer<typeof draftSchema>, @CurrentUser() u: AuthUser) {
    return this.ws.saveDraft(await reviewer(this.ctx, u), id, body);
  }

  @RequirePermission('teaching.view') @Get('mentor/batches/:id/health')
  async health(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.ws.batchHealth(id, await reviewer(this.ctx, u)); }

  @RequirePermission('batch.view') @Get('admin/batches/health')
  allHealth() { return this.ws.allBatchHealth(100); }

  @RequirePermission('report.academic.view') @Get('admin/cohorts')
  cohorts(@Query(new ZodPipe(cohortQuery)) q: z.infer<typeof cohortQuery>) {
    return this.ws.cohorts(q.groupBy, q.from ? new Date(q.from) : undefined, q.to ? new Date(q.to) : undefined);
  }

  /** Export is audited: who took which cut of the data, and when. */
  @RequirePermission('report.academic.view') @Get('admin/cohorts.csv')
  async export(@Query(new ZodPipe(cohortQuery)) q: z.infer<typeof cohortQuery>, @CurrentUser() u: AuthUser, @Req() req: Request, @Res() res: Response) {
    const rows = await this.ws.cohorts(q.groupBy, q.from ? new Date(q.from) : undefined, q.to ? new Date(q.to) : undefined);
    const flat = rows.map((r) => ({ label: r.label, size: r.size, suppressed: r.suppressed, enrolled: 'enrolled' in r ? r.enrolled : '', activationPercent: 'activationPercent' in r ? r.activationPercent : '', completionPercent: 'completionPercent' in r ? r.completionPercent : '' }));
    await this.audit.record({ userId: u.id, ...clientMeta(req), action: 'DATA_EXPORTED', entityType: 'Cohorts', entityId: q.groupBy, after: { rows: flat.length, groupBy: q.groupBy } });
    const csv = toCsv(flat, ['label', 'size', 'suppressed', 'enrolled', 'activationPercent', 'completionPercent']);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cohorts.csv"');
    res.send(csv);
  }
}

@Module({ controllers: [TeacherWorkspaceController], providers: [TeacherWorkspaceService], exports: [TeacherWorkspaceService] })
export class TeacherWorkspaceModule {}

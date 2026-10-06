import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { LeaderboardInput, leaderboardEntries, periodKey } from '../engagement/engagement-rules';
import { PrismaService } from '../prisma/prisma.service';

const uuid = new ParseUUIDPipe();
const DAY = 86_400_000;
const CACHE_MS = 60 * 60_000;
type Period = 'WEEKLY' | 'MONTHLY';

/** The start of the current period in UTC: Monday for weekly, the first of the month for monthly. */
export function periodStart(type: Period, now: Date): Date {
  if (type === 'MONTHLY') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const day = now.getUTCDay() || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
}

/**
 * Batch leaderboards from meaningful academic activity only: practice answers, mock tests, attendance, assignments and
 * improvement. Snapshots are cached for an hour. Students who opt out are removed from the ranking entirely.
 */
@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async board(batchId: string, type: Period, requester: { studentId?: string }, now = new Date()) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, deletedAt: null }, select: { id: true, name: true } });
    if (!batch) throw notFound('Batch');
    const key = periodKey(type, now);
    const cached = await this.prisma.leaderboardSnapshot.findUnique({ where: { batchId_periodType_periodKey: { batchId, periodType: type, periodKey: key } } });
    const entries = cached && now.getTime() - cached.computedAt.getTime() < CACHE_MS
      ? (cached.entries as ReturnType<typeof leaderboardEntries>)
      : await this.compute(batchId, type, now);
    if (!cached || now.getTime() - cached.computedAt.getTime() >= CACHE_MS) {
      await this.prisma.leaderboardSnapshot.upsert({
        where: { batchId_periodType_periodKey: { batchId, periodType: type, periodKey: key } },
        create: { batchId, periodType: type, periodKey: key, entries: entries as unknown as object, computedAt: now },
        update: { entries: entries as unknown as object, computedAt: now },
      });
    }
    const mine = requester.studentId ? entries.find((e) => e.studentId === requester.studentId) ?? null : null;
    return {
      batch: batch.name,
      period: type,
      periodKey: key,
      top: entries.slice(0, 10).map(({ studentId: _s, ...e }) => e),
      me: mine ? { rank: mine.rank, points: mine.points } : null,
      note: 'Points come from practice, mocks, attendance, assignments and improvement. Students can opt out of public ranking.',
    };
  }

  private async compute(batchId: string, type: Period, now: Date) {
    const since = periodStart(type, now);
    const enrolled = await this.prisma.enrollment.findMany({
      where: { batchId, status: { in: ['ACTIVE', 'COMPLETED'] }, deletedAt: null },
      select: { student: { select: { id: true, firstName: true, lastName: true, leaderboardOptOut: true, user: { select: { id: true } } } } },
      take: 500,
    });
    const ids = enrolled.map((e) => e.student.id);
    const [answers, mocks, attendance, submissions, attempts] = await Promise.all([
      this.answersBy(ids, since),
      this.prisma.assessmentAttempt.groupBy({ by: ['studentId'], where: { studentId: { in: ids }, submittedAt: { gte: since }, assessment: { type: 'MOCK' } }, _count: { _all: true } }),
      this.prisma.attendance.groupBy({ by: ['studentId', 'status'], where: { studentId: { in: ids }, session: { batchId, startsAt: { gte: since } } }, _count: { _all: true } }),
      this.prisma.submission.groupBy({ by: ['studentId'], where: { studentId: { in: ids }, submittedAt: { gte: since }, status: { in: ['SUBMITTED', 'GRADED'] } }, _count: { _all: true } }),
      this.prisma.assessmentAttempt.findMany({ where: { studentId: { in: ids }, submittedAt: { gte: new Date(since.getTime() - 30 * DAY) }, bandScore: { not: null } }, orderBy: { submittedAt: 'asc' }, select: { studentId: true, bandScore: true }, take: 5000 }),
    ]);
    const mockMap = new Map(mocks.map((m) => [m.studentId, m._count._all]));
    const subMap = new Map(submissions.map((s) => [s.studentId, s._count._all]));
    const attMap = new Map<string, { present: number; held: number }>();
    for (const r of attendance) {
      const cur = attMap.get(r.studentId) ?? { present: 0, held: 0 };
      if (r.status !== 'EXCUSED') cur.held += r._count._all;
      if (r.status === 'PRESENT' || r.status === 'LATE') cur.present += r._count._all;
      attMap.set(r.studentId, cur);
    }
    const bandsBy = new Map<string, number[]>();
    for (const a of attempts) bandsBy.set(a.studentId, [...(bandsBy.get(a.studentId) ?? []), Number(a.bandScore)]);

    const rows: LeaderboardInput[] = enrolled.map((e) => {
      const s = e.student;
      const bands = bandsBy.get(s.id) ?? [];
      const att = attMap.get(s.id);
      return {
        studentId: s.id, firstName: s.firstName, lastName: s.lastName, optedOut: s.leaderboardOptOut,
        practiceAnswers: answers.get(s.id) ?? 0,
        mocksCompleted: mockMap.get(s.id) ?? 0,
        attendance: att && att.held > 0 ? Math.round((att.present / att.held) * 100) : null,
        assignmentsSubmitted: subMap.get(s.id) ?? 0,
        improvement: bands.length >= 2 ? bands[bands.length - 1] - bands[0] : null,
      };
    });
    return leaderboardEntries(rows);
  }

  /** Practice answers per student in the period, from attempts submitted in it. */
  private async answersBy(ids: string[], since: Date): Promise<Map<string, number>> {
    const rows = await this.prisma.assessmentAttempt.findMany({ where: { studentId: { in: ids }, submittedAt: { gte: since } }, select: { studentId: true, _count: { select: { answers: true } } }, take: 5000 });
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.studentId, (m.get(r.studentId) ?? 0) + r._count.answers);
    return m;
  }

  async setOptOut(studentId: string, optOut: boolean) {
    await this.prisma.studentProfile.update({ where: { id: studentId }, data: { leaderboardOptOut: optOut } });
    // Cached boards may still rank the student, so drop the snapshots for their batches; they are recomputed on next read.
    const batches = await this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null }, select: { batchId: true } });
    await this.prisma.leaderboardSnapshot.deleteMany({ where: { batchId: { in: batches.map((b) => b.batchId) } } });
    return { optedOut: optOut };
  }

  async currentBatchId(studentId: string): Promise<string | null> {
    const e = await this.prisma.enrollment.findFirst({ where: { studentId, status: 'ACTIVE', deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { batchId: true } });
    return e?.batchId ?? null;
  }
}

const periodQuery = z.object({ type: z.enum(['WEEKLY', 'MONTHLY']).default('WEEKLY') });

@Controller()
export class LeaderboardController {
  constructor(private readonly boards: LeaderboardService) {}

  @Get('me/leaderboard')
  async mine(@Query(new ZodPipe(periodQuery)) q: { type: Period }, @CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden();
    const batchId = await this.boards.currentBatchId(u.studentId);
    if (!batchId) return { batch: null, period: q.type, top: [], me: null, note: 'Enrol in a batch to see its leaderboard.' };
    return this.boards.board(batchId, q.type, { studentId: u.studentId });
  }

  @HttpCode(200) @Post('me/leaderboard/opt-out')
  optOut(@Body(new ZodPipe(z.object({ optOut: z.boolean() }))) body: { optOut: boolean }, @CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden();
    return this.boards.setOptOut(u.studentId, body.optOut);
  }

  @RequirePermission('batch.view') @Get('admin/batches/:id/leaderboard')
  staff(@Param('id', uuid) id: string, @Query(new ZodPipe(periodQuery)) q: { type: Period }) {
    return this.boards.board(id, q.type, {});
  }
}

@Module({ controllers: [LeaderboardController], providers: [LeaderboardService], exports: [LeaderboardService] })
export class LeaderboardModule {}

import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ActivityField = 'loginCount' | 'mockTestsTaken' | 'lessonsOpened' | 'submissionsMade' | 'classesAttended';

/**
 * Daily activity counts: one row per user per day, bumped at a handful of existing action points
 * (login, mock submit, lesson-progress ping, submission created, attendance marked). Deliberately not
 * a timestamped event log or request-level middleware -- "was this person active today and what did
 * they do," not minute-by-minute session/page tracking.
 */
@Injectable()
export class DailyActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort: a failure here should never break the real action it's attached to. */
  async bump(userId: string, field: ActivityField) {
    try {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      await this.prisma.dailyActivitySummary.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, [field]: 1 },
        update: { [field]: { increment: 1 }, lastActiveAt: new Date() },
      });
    } catch { /* never block the caller's real action on activity tracking */ }
  }

  /** Call sites usually only have a StudentProfile/MentorProfile id on hand, not the underlying User id. */
  async bumpStudent(studentId: string, field: ActivityField) {
    const s = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { userId: true } }).catch(() => null);
    if (s) await this.bump(s.userId, field);
  }

  async bumpMentor(mentorId: string, field: ActivityField) {
    const m = await this.prisma.mentorProfile.findUnique({ where: { id: mentorId }, select: { userId: true } }).catch(() => null);
    if (m) await this.bump(m.userId, field);
  }

  /** The last `days` days (oldest first), zero-filled for days with no row rather than skipped. */
  async summary(userId: string, days = 14) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const rows = await this.prisma.dailyActivitySummary.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: 'asc' } });
    const byDate = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(since);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const r = byDate.get(key);
      return {
        date: key,
        loginCount: r?.loginCount ?? 0, mockTestsTaken: r?.mockTestsTaken ?? 0, lessonsOpened: r?.lessonsOpened ?? 0,
        submissionsMade: r?.submissionsMade ?? 0, classesAttended: r?.classesAttended ?? 0,
        lastActiveAt: r?.lastActiveAt ?? null,
      };
    });
  }

  async summaryForStudent(studentId: string, days = 14) {
    const s = await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } });
    return this.summary(s.userId, days);
  }

  async summaryForMentor(mentorId: string, days = 14) {
    const m = await this.prisma.mentorProfile.findUniqueOrThrow({ where: { id: mentorId }, select: { userId: true } });
    return this.summary(m.userId, days);
  }
}

@Global()
@Module({ providers: [DailyActivityService], exports: [DailyActivityService] })
export class DailyActivityModule {}

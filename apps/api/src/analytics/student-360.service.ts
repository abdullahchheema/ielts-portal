import { Injectable } from '@nestjs/common';
import { notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The detail behind each Student 360 tab. Every list is read from recorded rows, bounded in size,
 * and ordered by date so the screen shows a true history.
 */
@Injectable()
export class Student360Service {
  constructor(private readonly prisma: PrismaService) {}

  private async assertStudent(studentId: string) {
    const exists = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!exists) throw notFound('Student');
  }

  /** Every session the student was enrolled for, with the mark and any note the teacher left. */
  async attendance(studentId: string) {
    await this.assertStudent(studentId);
    const rows = await this.prisma.attendance.findMany({
      where: { studentId },
      select: {
        status: true, note: true, markedAt: true, minutesAttended: true,
        session: { select: { topic: true, startsAt: true, endsAt: true, batch: { select: { name: true } } } },
      },
      orderBy: { session: { startsAt: 'desc' } },
      take: 200,
    });
    return rows.map((r) => ({
      date: r.session.startsAt, topic: r.session.topic, batch: r.session.batch.name, status: r.status,
      note: r.note, markedAt: r.markedAt, minutesAttended: r.minutesAttended,
    }));
  }

  /** Every assessment attempt, newest first, with the band where the test type has one. */
  async assessments(studentId: string) {
    await this.assertStudent(studentId);
    const attempts = await this.prisma.assessmentAttempt.findMany({
      where: { studentId, status: { notIn: ['NOT_STARTED', 'IN_PROGRESS'] } },
      select: {
        attemptNumber: true, status: true, submittedAt: true, percent: true, bandScore: true, rawScore: true, maxScore: true,
        assessment: { select: { title: true, skill: true, type: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
    return attempts.map((a) => ({
      title: a.assessment.title, skill: a.assessment.skill, type: a.assessment.type, attemptNumber: a.attemptNumber,
      status: a.status, submittedAt: a.submittedAt,
      score: a.rawScore === null ? null : `${Number(a.rawScore)} / ${Number(a.maxScore)}`,
      percent: a.percent === null ? null : Number(a.percent), band: a.bandScore === null ? null : Number(a.bandScore),
    }));
  }

  /** Every assignment on the student's course, whether submitted or not, so missing work is visible. */
  async assignments(studentId: string) {
    await this.assertStudent(studentId);
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] } },
      orderBy: { enrolledAt: 'desc' }, select: { courseVersionId: true },
    });
    if (!enrollment) return [];
    const assignments = await this.prisma.assignment.findMany({
      where: { contentItem: { section: { courseVersionId: enrollment.courseVersionId } } },
      select: {
        skill: true, dueAt: true,
        contentItem: { select: { title: true } },
        submissions: { where: { studentId }, select: { status: true, submittedAt: true, late: true, finalBand: true, gradedAt: true }, take: 1 },
      },
      orderBy: { dueAt: 'asc' },
      take: 200,
    });
    const now = Date.now();
    return assignments.map((a) => {
      const s = a.submissions[0];
      const overdue = !s && a.dueAt !== null && a.dueAt.getTime() < now;
      return {
        title: a.contentItem.title, skill: a.skill, dueAt: a.dueAt,
        status: s ? s.status : overdue ? 'OVERDUE' : 'NOT_SUBMITTED',
        submittedAt: s?.submittedAt ?? null, late: s?.late ?? false,
        band: s?.finalBand === null || s?.finalBand === undefined ? null : Number(s.finalBand), gradedAt: s?.gradedAt ?? null,
      };
    });
  }
}

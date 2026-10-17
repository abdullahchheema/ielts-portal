import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Admin visibility into the free-test pool and leads (conversion funnel). There is no "add to
 *  pool" action — eligibility is automatic: publish a student-facing bank set for any of the 4
 *  skills (via the plain question-bank import/approve/publish flow) and it's immediately in
 *  rotation. Listening/Reading sets additionally get a small internal Assessment lazily built the
 *  first time they're picked (see FreeTestService.resolveWrapperAssessment) — invisible here and
 *  everywhere else; this service only ever looks at the bank set itself. */
@Injectable()
export class FreeTestAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async poolStats() {
    const [listening, reading, writing, speaking] = await Promise.all([
      this.prisma.questionSet.count({ where: { skill: 'LISTENING', status: 'PUBLISHED', studentFacing: true } }),
      this.prisma.questionSet.count({ where: { skill: 'READING', status: 'PUBLISHED', studentFacing: true } }),
      this.prisma.question.count({ where: { deletedAt: null, ieltsType: 'WRITING_TASK2', questionSet: { skill: 'WRITING', status: 'PUBLISHED', studentFacing: true } } }),
      this.prisma.question.count({ where: { deletedAt: null, ieltsType: { in: ['SPEAKING_PART1', 'SPEAKING_PART2', 'SPEAKING_PART3'] }, questionSet: { skill: 'SPEAKING', status: 'PUBLISHED', studentFacing: true } } }),
    ]);
    return { listening, reading, writing, speaking };
  }

  async listLeads(q: { status?: string; skip: number; take: number }) {
    const where = q.status ? { status: q.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.freeAssessmentLead.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take,
        include: { examAttempt: { select: { stage: true, status: true, overallEstimate: true, missingSkills: true } } },
      }),
      this.prisma.freeAssessmentLead.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id, email: r.email, phone: r.phone, status: r.status,
        stage: r.examAttempt?.stage ?? null, examStatus: r.examAttempt?.status ?? null,
        overallEstimate: r.examAttempt?.overallEstimate ?? null, missingSkills: r.examAttempt?.missingSkills ?? [],
        createdAt: r.createdAt, linked: !!r.linkedStudentId,
      })),
    };
  }

  /** Every rotation module across all 4 skills, newest first — a quick "what's eligible right now"
   *  view, scoped correctly, without the admin having to filter the full question bank by hand. */
  async listModules() {
    const sets = await this.prisma.questionSet.findMany({
      where: { skill: { in: ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] }, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, skill: true, status: true, studentFacing: true, createdAt: true, _count: { select: { questions: true } } },
    });
    return sets.map((s) => ({
      id: s.id, skill: s.skill, title: s.title, published: s.status === 'PUBLISHED' && s.studentFacing,
      questionCount: s._count.questions, createdAt: s.createdAt,
    }));
  }
}

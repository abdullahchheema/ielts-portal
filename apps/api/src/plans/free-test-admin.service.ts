import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Admin visibility into the free-test pool and leads (conversion funnel). There is no "add to
 *  pool" action — eligibility is automatic: publish a DIAGNOSTIC Listening/Reading assessment, or a
 *  published + student-facing Writing/Speaking prompt, and it's immediately in rotation. */
@Injectable()
export class FreeTestAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async poolStats() {
    const [listening, reading, writing, speaking] = await Promise.all([
      this.prisma.assessment.count({ where: { type: 'DIAGNOSTIC', skill: 'LISTENING', versions: { some: { publishedAt: { not: null } } } } }),
      this.prisma.assessment.count({ where: { type: 'DIAGNOSTIC', skill: 'READING', versions: { some: { publishedAt: { not: null } } } } }),
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
}

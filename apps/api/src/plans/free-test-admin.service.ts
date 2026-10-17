import { Injectable } from '@nestjs/common';
import { BulkImportInput } from '@ielts/validation';
import { AssessmentsAdminService } from '../assessments/assessments-admin.service';
import { Actor } from '../courses/courses.service';
import { QuestionImportService } from '../question-bank/import.service';
import { QuestionBankService } from '../question-bank/question-bank.service';
import { PrismaService } from '../prisma/prisma.service';

/** Admin visibility into the free-test pool and leads (conversion funnel), plus the one-stop "upload
 *  a module" action: a module is a bulk-imported JSON set that becomes an independent rotation unit —
 *  a published QuestionSet for Writing/Speaking, or a published DIAGNOSTIC Assessment (built from that
 *  same imported content) for Listening/Reading. Eligibility itself stays fully automatic; this is
 *  just what turns an upload into something eligible without the admin touching two separate systems. */
@Injectable()
export class FreeTestAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importSvc: QuestionImportService,
    private readonly bank: QuestionBankService,
    private readonly assessmentsAdmin: AssessmentsAdminService,
  ) {}

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

  /** One upload, any mix of skills: each set in the payload becomes its own independent rotation
   *  module. Writing/Speaking publish the bank set directly; Listening/Reading get rebuilt into a
   *  published DIAGNOSTIC assessment (the shape the free-test pool actually rotates for those two
   *  skills), with the now-redundant staging bank set archived so it doesn't show up twice. */
  async importModules(input: BulkImportInput, actor: Actor) {
    const result = await this.importSvc.commit(input, actor);
    const modules: { moduleId: string; kind: 'ASSESSMENT' | 'QUESTION_SET'; skill: string; title: string; questionCount: number; needsAudio?: boolean }[] = [];

    for (let i = 0; i < input.sets.length; i++) {
      const set = input.sets[i];
      const created = result.created[i];

      if (set.skill === 'WRITING' || set.skill === 'SPEAKING') {
        await this.bank.setStatus(created.setId, { status: 'APPROVED' }, actor);
        await this.bank.setStatus(created.setId, { status: 'PUBLISHED', studentFacing: true }, actor);
        modules.push({ moduleId: created.setId, kind: 'QUESTION_SET', skill: set.skill, title: created.title, questionCount: created.questionCount });
        continue;
      }

      const assessment = await this.assessmentsAdmin.create({ title: set.title, type: 'DIAGNOSTIC', skill: set.skill, passPercent: 0, showAnswers: true }, actor);
      const full = await this.assessmentsAdmin.get(assessment.id);
      const versionId = full.versions[0].id;
      const content = set.stimulus?.passage ? { passage: set.stimulus.passage } : undefined;
      const section = await this.assessmentsAdmin.createSection(versionId, { title: set.title, content }, actor);
      const questionIds = (await this.prisma.question.findMany({
        where: { questionSetId: created.setId }, orderBy: { sequence: 'asc' }, select: { id: true },
      })).map((q) => q.id);
      await this.bank.copyIntoSection(section.id, questionIds, actor);
      await this.assessmentsAdmin.publishVersion(versionId, actor);
      await this.bank.setStatus(created.setId, { status: 'ARCHIVED' }, actor);
      modules.push({
        moduleId: assessment.id, kind: 'ASSESSMENT', skill: set.skill, title: created.title, questionCount: created.questionCount,
        needsAudio: set.skill === 'LISTENING',
      });
    }
    return { modules };
  }

  /** Every rotation module across all 4 skills, newest first — the one place the admin looks instead
   *  of checking the question bank and the assessments screen separately. */
  async listModules() {
    const [assessments, sets] = await Promise.all([
      this.prisma.assessment.findMany({
        where: { type: 'DIAGNOSTIC', skill: { in: ['LISTENING', 'READING'] } },
        select: { id: true, title: true, skill: true, createdAt: true, versions: { select: { publishedAt: true }, orderBy: { version: 'desc' }, take: 1 } },
      }),
      this.prisma.questionSet.findMany({
        where: { skill: { in: ['WRITING', 'SPEAKING'] }, status: { not: 'ARCHIVED' } },
        select: { id: true, title: true, skill: true, status: true, studentFacing: true, createdAt: true, _count: { select: { questions: true } } },
      }),
    ]);
    const modules = [
      ...assessments.map((a) => ({ id: a.id, kind: 'ASSESSMENT' as const, skill: a.skill!, title: a.title, published: !!a.versions[0]?.publishedAt, createdAt: a.createdAt })),
      ...sets.map((s) => ({ id: s.id, kind: 'QUESTION_SET' as const, skill: s.skill, title: s.title, published: s.status === 'PUBLISHED' && s.studentFacing, questionCount: s._count.questions, createdAt: s.createdAt })),
    ];
    return modules.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

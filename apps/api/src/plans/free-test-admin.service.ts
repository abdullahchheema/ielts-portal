import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Admin visibility into the free-test pool. There is no "add to pool" action — eligibility is
 *  automatic: publish a student-facing bank set for any of the 4 skills (via the plain
 *  question-bank import/approve/publish flow) and it's immediately in rotation. Listening/Reading
 *  sets additionally get a small internal Assessment lazily built the first time they're picked
 *  (see FreeTestService.resolveWrapperAssessment) — invisible here and everywhere else; this
 *  service only ever looks at the bank set itself. */
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

  /** Every rotation module across all 4 skills, newest first — a quick "what's eligible right now"
   *  view, scoped correctly, without the admin having to filter the full question bank by hand. */
  async listModules() {
    const sets = await this.prisma.questionSet.findMany({
      where: { skill: { in: ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] }, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, skill: true, status: true, studentFacing: true, eligibleForFreeTestRotation: true, createdAt: true, _count: { select: { questions: true } } },
    });
    return sets.map((s) => ({
      id: s.id, skill: s.skill, title: s.title, published: s.status === 'PUBLISHED' && s.studentFacing,
      eligibleForFreeTestRotation: s.eligibleForFreeTestRotation, questionCount: s._count.questions, createdAt: s.createdAt,
    }));
  }

  async setRotationEligibility(id: string, eligible: boolean) {
    await this.prisma.questionSet.update({ where: { id }, data: { eligibleForFreeTestRotation: eligible } });
    return { ok: true };
  }

  /** How often each module was actually picked (and how many of those picks were completed) — the
   *  same usage signal RotationService balances against, surfaced instead of thrown away. Listening/
   *  Reading usage is counted through the set's wrapper Assessment (RotationService's own join,
   *  repeated here rather than shared, since this read happens far less often and doesn't need to
   *  live on the hot picking path); Writing/Speaking are counted directly off
   *  WritingResponse/SpeakingResponse.questionId, same as RotationService.pickLeastUsedBankQuestion. */
  async moduleStats() {
    const sets = await this.prisma.questionSet.findMany({
      where: { skill: { in: ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] }, status: { not: 'ARCHIVED' } },
      select: { id: true, title: true, skill: true, wrapperAssessmentId: true, questions: { where: { deletedAt: null }, select: { id: true } } },
    });

    const setIdByAssessmentId = new Map(sets.filter((s) => s.wrapperAssessmentId).map((s) => [s.wrapperAssessmentId!, s.id]));
    const picks = new Map<string, number>();
    const completed = new Map<string, number>();
    const bump = (map: Map<string, number>, assessmentId: string | null | undefined) => {
      const setId = assessmentId ? setIdByAssessmentId.get(assessmentId) : undefined;
      if (setId) map.set(setId, (map.get(setId) ?? 0) + 1);
    };

    const [leads, mockExams] = await Promise.all([
      this.prisma.freeAssessmentLead.findMany({
        where: { examAttemptId: { not: null } },
        select: { examAttempt: { select: { listeningAssessmentId: true, readingAssessmentId: true, status: true } } },
      }),
      this.prisma.mockExam.findMany({ select: { listeningAssessmentId: true, readingAssessmentId: true } }),
    ]);
    for (const l of leads) {
      const e = l.examAttempt;
      if (!e) continue;
      bump(picks, e.listeningAssessmentId); bump(picks, e.readingAssessmentId);
      if (e.status === 'COMPLETED') { bump(completed, e.listeningAssessmentId); bump(completed, e.readingAssessmentId); }
    }
    for (const m of mockExams) { bump(picks, m.listeningAssessmentId); bump(picks, m.readingAssessmentId); }

    const writingIds = sets.filter((s) => s.skill === 'WRITING').flatMap((s) => s.questions.map((q) => q.id));
    const speakingIds = sets.filter((s) => s.skill === 'SPEAKING').flatMap((s) => s.questions.map((q) => q.id));
    const [writingAll, speakingAll] = await Promise.all([
      writingIds.length ? this.prisma.writingResponse.findMany({ where: { questionId: { in: writingIds } }, select: { questionId: true, submittedAt: true } }) : [],
      speakingIds.length ? this.prisma.speakingResponse.findMany({ where: { questionId: { in: speakingIds } }, select: { questionId: true, status: true } }) : [],
    ]);
    const questionSetId = new Map(sets.flatMap((s) => s.questions.map((q) => [q.id, s.id] as const)));
    for (const w of writingAll) {
      const setId = w.questionId ? questionSetId.get(w.questionId) : undefined;
      if (!setId) continue;
      picks.set(setId, (picks.get(setId) ?? 0) + 1);
      if (w.submittedAt) completed.set(setId, (completed.get(setId) ?? 0) + 1);
    }
    for (const sp of speakingAll) {
      const setId = sp.questionId ? questionSetId.get(sp.questionId) : undefined;
      if (!setId) continue;
      picks.set(setId, (picks.get(setId) ?? 0) + 1);
      if (sp.status === 'EVALUATED') completed.set(setId, (completed.get(setId) ?? 0) + 1);
    }
    return sets.map((s) => ({ id: s.id, title: s.title, skill: s.skill, picks: picks.get(s.id) ?? 0, completed: completed.get(s.id) ?? 0 }));
  }
}

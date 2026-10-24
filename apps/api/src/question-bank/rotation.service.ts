import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import type { ImportContentBlock } from '@ielts/validation';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { AssessmentsAdminService } from '../assessments/assessments-admin.service';
import { Actor } from '../courses/courses.service';
import { QuestionBankService } from '../question-bank/question-bank.service';

/** No human admin is involved in lazily building a wrapper assessment — AuditLog.userId is nullable,
 *  so this is safe; it just needs a cast past AssessmentsAdminService's stricter Actor type (same
 *  precedent as the `{ userId: undefined }` system actor already used in referrals.service.ts). */
const SYSTEM_ACTOR = { userId: undefined } as unknown as Actor;

/**
 * Shared Listening/Reading module-rotation logic: picks the least-used published, student-facing
 * bank set for a skill, and lazily builds (then reuses) that set's one-time internal wrapper
 * Assessment — the only thing the timed, graded AssessmentAttempt machinery can run against.
 *
 * Extracted from FreeTestService (its original, sole consumer) so MockExamsService's whole-module
 * mock composition (Phase 6) can share the exact same picking/building logic and usage counter —
 * both now count against each other, not just within their own feature, so the same module isn't
 * picked twice as often just because two different features both pick from it independently.
 */
@Injectable()
export class RotationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assessmentsAdmin: AssessmentsAdminService,
    private readonly bank: QuestionBankService,
  ) {}

  /** The least-used published, student-facing bank set for this skill, among however many exist.
   *  "Used" is counted from every existing free-test exam and mock exam that picked a wrapper built
   *  from a given set, so free-test and mock-exam usage feed one shared rotation counter. */
  async pickLeastUsedBankSet(tx: Prisma.TransactionClient, skill: 'LISTENING' | 'READING') {
    const eligible = await tx.questionSet.findMany({ where: { skill, status: 'PUBLISHED', studentFacing: true, eligibleForFreeTestRotation: true }, select: { id: true } });
    if (eligible.length === 0) throw new AppError('ASSESSMENT_NOT_AVAILABLE', 404, `No ${skill.toLowerCase()} module is published yet. Please check back soon.`);
    const [usedByFreeTest, usedByMockExams, wrapped] = await Promise.all([
      tx.freeAssessmentLead.findMany({
        where: { examAttemptId: { not: null } },
        select: { examAttempt: { select: { listeningAssessmentId: true, readingAssessmentId: true } } },
      }),
      tx.mockExam.findMany({ select: { listeningAssessmentId: true, readingAssessmentId: true } }),
      tx.questionSet.findMany({ where: { wrapperAssessmentId: { not: null } }, select: { id: true, wrapperAssessmentId: true } }),
    ]);
    const setIdByAssessmentId = new Map(wrapped.map((w) => [w.wrapperAssessmentId!, w.id]));
    const countOf = new Map<string, number>();
    const bump = (assessmentId: string | null | undefined) => {
      const setId = assessmentId ? setIdByAssessmentId.get(assessmentId) : undefined;
      if (setId) countOf.set(setId, (countOf.get(setId) ?? 0) + 1);
    };
    for (const u of usedByFreeTest) bump(skill === 'LISTENING' ? u.examAttempt?.listeningAssessmentId : u.examAttempt?.readingAssessmentId);
    for (const m of usedByMockExams) bump(skill === 'LISTENING' ? m.listeningAssessmentId : m.readingAssessmentId);
    return eligible.reduce((min, s) => ((countOf.get(s.id) ?? 0) < (countOf.get(min.id) ?? 0) ? s : min), eligible[0]).id;
  }

  /** Writing/Speaking's equivalent of pickLeastUsedBankSet() — there's no wrapper Assessment for
   *  these two skills (SimulatorService picks a bank Question directly), so usage is counted
   *  straight off WritingResponse.questionId/SpeakingResponse.questionId instead of through an
   *  assessment indirection. Only called for the free-test path (see SimulatorService.afterReading's
   *  ghost check) — the regular authenticated simulator keeps its existing random pick unchanged. */
  async pickLeastUsedBankQuestion(skill: 'WRITING' | 'SPEAKING', ieltsTypes: string[]) {
    const eligible = await this.prisma.question.findMany({
      where: { deletedAt: null, ieltsType: { in: ieltsTypes }, questionSet: { skill, status: 'PUBLISHED', studentFacing: true, eligibleForFreeTestRotation: true } },
      select: { id: true },
    });
    if (eligible.length === 0) return null;
    const ids = eligible.map((q) => q.id);
    const counts = skill === 'WRITING'
      ? await this.prisma.writingResponse.groupBy({ by: ['questionId'], where: { questionId: { in: ids } }, _count: { _all: true } })
      : await this.prisma.speakingResponse.groupBy({ by: ['questionId'], where: { questionId: { in: ids } }, _count: { _all: true } });
    const countOf = new Map(counts.map((c) => [c.questionId, c._count._all]));
    return eligible.reduce((min, q) => ((countOf.get(q.id) ?? 0) < (countOf.get(min.id) ?? 0) ? q : min), eligible[0]).id;
  }

  /** The bank set's own internal Assessment — built once, on first pick, then cached on the set so
   *  every later pick (by either free-test or mock-exam composition) reuses it. Never shown to an
   *  admin, never created by hand: this only exists because Listening/Reading's timed, graded
   *  attempt machinery (AttemptsService/AssessmentAttempt) has no bank-native equivalent. Runs as
   *  its own small transactions (not nested in the caller's), same reasoning as `attempts.start()`
   *  needing the ghost/real student already committed. */
  async resolveWrapperAssessment(setId: string, skill: 'LISTENING' | 'READING') {
    const set = await this.prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    if (set.wrapperAssessmentId) return set.wrapperAssessmentId;

    // IELTS-standard section timing — the same values this codebase already uses for mock-exam
    // composition (`/admin/mock-exams/compose`'s durationMin).
    const timeLimitMin = skill === 'LISTENING' ? 30 : 60;
    const assessment = await this.assessmentsAdmin.create({ title: set.title, type: 'DIAGNOSTIC', skill, passPercent: 0, showAnswers: true, timeLimitMin }, SYSTEM_ACTOR);
    const versionId = assessment.versionId;
    const stimulus = (set.stimulus ?? {}) as {
      passage?: string; audioKey?: string;
      sections?: { title: string; instructions?: string; passage?: string; audioKey?: string; instructionGroups?: { text: string; count: number }[]; contentBlocks?: ImportContentBlock[] }[];
    };

    const [images, allQuestions] = await Promise.all([
      this.prisma.questionImage.findMany({
        where: { questionSetId: setId }, orderBy: { sequence: 'asc' }, select: { sectionIndex: true, fileKey: true, altText: true },
      }),
      this.prisma.question.findMany({
        where: { questionSetId: setId }, orderBy: { sequence: 'asc' }, select: { id: true, bankSectionIndex: true },
      }),
    ]);
    const imagesByIndex = new Map<number | null, { fileKey: string; altText: string | null }[]>();
    for (const img of images) {
      const key = img.sectionIndex ?? null;
      imagesByIndex.set(key, [...(imagesByIndex.get(key) ?? []), { fileKey: img.fileKey, altText: img.altText }]);
    }
    const questionIdsByIndex = new Map<number | null, string[]>();
    for (const q of allQuestions) {
      const key = q.bankSectionIndex ?? null;
      questionIdsByIndex.set(key, [...(questionIdsByIndex.get(key) ?? []), q.id]);
    }

    const parts = stimulus.sections?.length
      ? stimulus.sections.map((s, i) => ({
          title: s.title, instructions: s.instructions, passage: s.passage, instructionGroups: s.instructionGroups, contentBlocks: s.contentBlocks,
          audioKey: s.audioKey ?? (i === 0 ? stimulus.audioKey : undefined),
          bankSectionIndex: i as number | null,
        }))
      : [{ title: set.title, instructions: undefined, passage: stimulus.passage, instructionGroups: undefined, contentBlocks: undefined as ImportContentBlock[] | undefined, audioKey: stimulus.audioKey, bankSectionIndex: null as number | null }];

    const sectionIds = parts.map(() => randomUUID());
    await this.prisma.assessmentSection.createMany({
      data: parts.map((part, i) => {
        const imageKeys = imagesByIndex.get(part.bankSectionIndex)?.map((img) => ({ key: img.fileKey, alt: img.altText ?? undefined }));
        const content = part.passage || part.instructions || part.instructionGroups || part.contentBlocks || part.audioKey || imageKeys?.length
          ? { passage: part.passage, instructions: part.instructions, instructionGroups: part.instructionGroups, contentBlocks: part.contentBlocks, audioKey: part.audioKey, imageKeys }
          : undefined;
        return { id: sectionIds[i], assessmentVersionId: versionId, title: part.title, sequence: i, content: content as Prisma.InputJsonValue | undefined };
      }),
    });

    await Promise.all(parts.map((part, i) => this.bank.copyIntoSection(sectionIds[i], questionIdsByIndex.get(part.bankSectionIndex) ?? [], SYSTEM_ACTOR)));

    await this.assessmentsAdmin.publishVersion(versionId, SYSTEM_ACTOR);

    // Only the first builder's id sticks; a concurrent duplicate build becomes a harmless, never-
    // reused orphan Assessment, the same tolerance already accepted elsewhere for concurrent picks.
    const claimed = await this.prisma.questionSet.updateMany({ where: { id: setId, wrapperAssessmentId: null }, data: { wrapperAssessmentId: assessment.id } });
    if (claimed.count === 0) {
      const latest = await this.prisma.questionSet.findUniqueOrThrow({ where: { id: setId }, select: { wrapperAssessmentId: true } });
      return latest.wrapperAssessmentId!;
    }
    return assessment.id;
  }
}

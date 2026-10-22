import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@ielts/db';
import type { AddSpeakingResponseInput, ImportContentBlock, SaveAnswersInput, SaveWritingInput } from '@ielts/validation';
import { AppError, conflict, notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { AssessmentsAdminService } from '../assessments/assessments-admin.service';
import { AttemptsService } from '../assessments/attempts.service';
import { Actor } from '../courses/courses.service';
import { QuestionBankService } from '../question-bank/question-bank.service';
import { SimulatorService } from '../simulator/simulator.service';
import { SpeakingService } from '../speaking/speaking.service';
import { WritingService } from '../writing/writing.service';

/** No human admin is involved in lazily building a wrapper assessment — AuditLog.userId is nullable,
 *  so this is safe; it just needs a cast past AssessmentsAdminService's stricter Actor type (same
 *  precedent as the `{ userId: undefined }` system actor already used in referrals.service.ts). */
const SYSTEM_ACTOR = { userId: undefined } as unknown as Actor;

/** Ghost accounts' email domain. Status stays PENDING_VERIFICATION forever, so the normal
 *  "verify your email before logging in" gate already makes them unreachable through /auth/login. */
const GHOST_EMAIL_DOMAIN = 'free-lead.internal';
const LEAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The anonymous free-test flow. Identity is email+phone (normalized), with no account created — a
 * lightweight "ghost" StudentProfile/User lets the free attempt reuse the existing, battle-tested
 * engines unchanged. The free test is a full 4-skill mock, orchestrated as an `ExamAttempt` exactly
 * like the authenticated full exam simulator (see SimulatorService): Listening and Reading are each
 * picked from whichever DIAGNOSTIC-type assessments are published for that skill (no fixed set —
 * publish as many as you like, the least-used one is picked each time); Writing and Speaking are
 * picked by SimulatorService's own existing logic, unchanged, from the question bank.
 *
 * `SimulatorService.get()`/`.advance()` do no gating beyond "does this studentId own this exam," so
 * once the ExamAttempt exists they can be called directly for the ghost. Only `.start()` gates on
 * enrollment/mocks-approval — this service never calls it, creating the exam and its first section
 * itself instead, the same way `.start()` does internally, just without that gate (DIAGNOSTIC-type
 * assessments need no enrollment or approval, which is exactly why Phase 4 used them originally).
 *
 * No AI-evaluation bypass exists here, and none should be added: the ghost has no plan (defaults to
 * FREE), so Writing/Speaking never get an AI estimate — `missingSkills` will list them and
 * `overallEstimate` stays null, which is the spec-correct behaviour for the Free tier, not a bug.
 */
@Injectable()
export class FreeTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: AttemptsService,
    private readonly sim: SimulatorService,
    private readonly writing: WritingService,
    private readonly speaking: SpeakingService,
    private readonly assessmentsAdmin: AssessmentsAdminService,
    private readonly bank: QuestionBankService,
  ) {}

  private normalize(email: string, phone: string) {
    return { emailNormalized: email.trim().toLowerCase(), phoneNormalized: phone.replace(/\D/g, '') };
  }

  /** Claim (or resume, or reclaim after expiry) a free test. Never grants a second entitlement to
   *  the same identity once it has been COMPLETED. */
  async claim(email: string, phone: string, meta: { ip?: string; userAgent?: string }) {
    const { emailNormalized, phoneNormalized } = this.normalize(email, phone);
    if (!phoneNormalized || phoneNormalized.length < 6) throw new AppError('VALIDATION_ERROR', 422, 'Enter a valid phone number.', { phone: 'Invalid phone number.' });

    const existing = await this.prisma.freeAssessmentLead.findUnique({ where: { emailNormalized_phoneNormalized: { emailNormalized, phoneNormalized } } });
    if (existing) {
      if (existing.status === 'COMPLETED') throw conflict('FREE_TEST_USED', 'You have already taken the free test. Register for a paid plan to unlock full results and more tests.');
      if (existing.status === 'EXPIRED') return this.reclaim(existing.id, meta);
      return { leadId: existing.id, resumable: !!existing.examAttemptId };
    }

    try {
      // Not one big transaction: createExam() calls AttemptsService.start(), which opens its own
      // transaction and needs the ghost student's row already committed and visible — not still
      // sitting inside an uncommitted outer transaction, which would fail its FK check.
      const ghostStudentId = await this.createGhostStudent(email, phone);
      const examAttemptId = await this.createExam(ghostStudentId);
      const lead = await this.prisma.freeAssessmentLead.create({
        data: {
          email, phone, emailNormalized, phoneNormalized, ghostStudentId, examAttemptId,
          ipAddress: meta.ip, userAgent: meta.userAgent, expiresAt: new Date(Date.now() + LEAD_TTL_MS),
        },
      });
      return { leadId: lead.id, resumable: false };
    } catch (e) {
      // Two near-simultaneous claims for the same identity: the loser's insert hits the unique
      // index. Recover by returning the winner's lead instead of a spurious 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const after = await this.prisma.freeAssessmentLead.findUnique({ where: { emailNormalized_phoneNormalized: { emailNormalized, phoneNormalized } } });
        if (after) return { leadId: after.id, resumable: !!after.examAttemptId };
      }
      throw e;
    }
  }

  private async reclaim(leadId: string, meta: { ip?: string; userAgent?: string }) {
    const lead = await this.prisma.freeAssessmentLead.findUniqueOrThrow({ where: { id: leadId } });
    const ghostStudentId = lead.ghostStudentId ?? await this.createGhostStudent(lead.email, lead.phone);
    // An IN_PROGRESS exam already satisfies the one-open-exam-per-student constraint — reuse it
    // rather than creating a second one, which that constraint would reject anyway.
    const open = await this.prisma.examAttempt.findFirst({ where: { studentId: ghostStudentId, status: 'IN_PROGRESS' }, select: { id: true } });
    const examAttemptId = open?.id ?? await this.createExam(ghostStudentId);
    await this.prisma.freeAssessmentLead.update({
      where: { id: leadId },
      data: { ghostStudentId, examAttemptId, status: 'CLAIMED', expiresAt: new Date(Date.now() + LEAD_TTL_MS), ipAddress: meta.ip, userAgent: meta.userAgent },
    });
    return { leadId, resumable: !!open };
  }

  /** The least-used published, student-facing bank set for this skill, among however many exist.
   *  "Used" is counted from existing free-test exams only (joined through FreeAssessmentLead, via
   *  whichever bank set each wrapper Assessment traces back to), so a real student's own simulator
   *  run on the same wrapper Assessment never skews the free-test rotation. */
  private async pickLeastUsedBankSet(tx: Prisma.TransactionClient, skill: 'LISTENING' | 'READING') {
    const eligible = await tx.questionSet.findMany({ where: { skill, status: 'PUBLISHED', studentFacing: true }, select: { id: true } });
    if (eligible.length === 0) throw new AppError('ASSESSMENT_NOT_AVAILABLE', 404, `No ${skill.toLowerCase()} module is published for the free test yet. Please check back soon.`);
    const [used, wrapped] = await Promise.all([
      tx.freeAssessmentLead.findMany({
        where: { examAttemptId: { not: null } },
        select: { examAttempt: { select: { listeningAssessmentId: true, readingAssessmentId: true } } },
      }),
      tx.questionSet.findMany({ where: { wrapperAssessmentId: { not: null } }, select: { id: true, wrapperAssessmentId: true } }),
    ]);
    const setIdByAssessmentId = new Map(wrapped.map((w) => [w.wrapperAssessmentId!, w.id]));
    const countOf = new Map<string, number>();
    for (const u of used) {
      const assessmentId = skill === 'LISTENING' ? u.examAttempt?.listeningAssessmentId : u.examAttempt?.readingAssessmentId;
      const setId = assessmentId ? setIdByAssessmentId.get(assessmentId) : undefined;
      if (setId) countOf.set(setId, (countOf.get(setId) ?? 0) + 1);
    }
    return eligible.reduce((min, s) => ((countOf.get(s.id) ?? 0) < (countOf.get(min.id) ?? 0) ? s : min), eligible[0]).id;
  }

  /** The bank set's own internal Assessment — built once, on first pick, then cached on the set so
   *  every later pick reuses it. Never shown to an admin, never created by hand: this only exists
   *  because Listening/Reading's timed, graded attempt machinery (AttemptsService/AssessmentAttempt)
   *  has no bank-native equivalent. Runs as its own small transactions (not nested in the caller's),
   *  same reasoning as `attempts.start()` needing the ghost student already committed. */
  /** Builds the wrapper on the first pick of a set — this runs inline in the student's claim request,
   *  so every round trip here is latency the student is actually waiting on. Kept to the minimum:
   *  one batched insert for every section (instead of one create() call per part), the two lookup
   *  queries run together, and the independent per-section question-copy work runs in parallel
   *  instead of one part after another. */
  private async resolveWrapperAssessment(setId: string, skill: 'LISTENING' | 'READING') {
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
    // Shared stimulus images (e.g. a labelled map) are attached per bankSectionIndex (null = whole-set,
    // for a single-passage set) — carry their storage keys into each part's content the same way audio is.
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

    // A multi-passage set (sections[]) gets one AssessmentSection per passage, each copying only its
    // own questions — this is what makes the existing section-by-section renderer (AttemptsService's
    // paper(), the free-test SectionStage) show each passage directly above its own questions instead
    // of one giant block. A single-passage set keeps the original one-section shape.
    //
    // Audio: a real Listening test is normally one continuous recording for every part, not a
    // separate file per part — that whole-module file (stimulus.audioKey, attached without a section
    // index) plays once, attached to the first part only, so the student gets a single player instead
    // of the same recording repeated behind every part. A part with its own audioKey (a genuinely
    // separate file for that part) always takes priority over the whole-module one.
    const parts = stimulus.sections?.length
      ? stimulus.sections.map((s, i) => ({
          title: s.title, instructions: s.instructions, passage: s.passage, instructionGroups: s.instructionGroups, contentBlocks: s.contentBlocks,
          audioKey: s.audioKey ?? (i === 0 ? stimulus.audioKey : undefined),
          bankSectionIndex: i as number | null,
        }))
      : [{ title: set.title, instructions: undefined, passage: stimulus.passage, instructionGroups: undefined, contentBlocks: undefined as ImportContentBlock[] | undefined, audioKey: stimulus.audioKey, bankSectionIndex: null as number | null }];

    // One batched insert for every section, content fully baked in up front — no per-section
    // create-then-update round trip. Sequence is just the part's position: this version is brand new,
    // so there's no existing-section count to race against (unlike AssessmentsAdminService.createSection).
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

    // Each part writes to its own section, so these are independent — safe to run concurrently
    // instead of waiting on one part's question-copy before starting the next.
    await Promise.all(parts.map((part, i) => this.bank.copyIntoSection(sectionIds[i], questionIdsByIndex.get(part.bankSectionIndex) ?? [], SYSTEM_ACTOR)));

    await this.assessmentsAdmin.publishVersion(versionId, SYSTEM_ACTOR);

    // Only the first builder's id sticks; a concurrent duplicate build (rare — only possible the very
    // first time a set is ever picked) becomes a harmless, never-reused orphan Assessment, the same
    // tolerance already accepted for claim()'s own P2002 concurrent-claim recovery below.
    const claimed = await this.prisma.questionSet.updateMany({ where: { id: setId, wrapperAssessmentId: null }, data: { wrapperAssessmentId: assessment.id } });
    if (claimed.count === 0) {
      const latest = await this.prisma.questionSet.findUniqueOrThrow({ where: { id: setId }, select: { wrapperAssessmentId: true } });
      return latest.wrapperAssessmentId!;
    }
    return assessment.id;
  }

  /** Picks Listening/Reading bank sets (advisory-locked so concurrent claims balance fairly), then —
   *  outside that lock, since resolving a wrapper may itself build one through several small
   *  transactions — resolves each pick's wrapper Assessment and creates the bare ExamAttempt row, the
   *  same shape `SimulatorService.start()` creates, but without that method's enrollment/mocks-
   *  approval gate: DIAGNOSTIC assessments need neither, exactly as the free test already relied on. */
  private async createExamRow(ghostStudentId: string) {
    const [listeningSetId, readingSetId] = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('free_test_assign'))`;
      return Promise.all([this.pickLeastUsedBankSet(tx, 'LISTENING'), this.pickLeastUsedBankSet(tx, 'READING')]);
    });
    const [listeningAssessmentId, readingAssessmentId] = await Promise.all([
      this.resolveWrapperAssessment(listeningSetId, 'LISTENING'),
      this.resolveWrapperAssessment(readingSetId, 'READING'),
    ]);
    const exam = await this.prisma.examAttempt.create({
      data: { studentId: ghostStudentId, includeSpeaking: true, listeningAssessmentId, readingAssessmentId, stage: 'LISTENING' },
      select: { id: true },
    });
    return { examAttemptId: exam.id, listeningAssessmentId };
  }

  /** Starting the listening section calls AttemptsService.start(), which opens its own transaction —
   *  so this runs after createExamRow()'s own transactions have committed, never nested inside one. */
  private async createExam(ghostStudentId: string) {
    const { examAttemptId, listeningAssessmentId } = await this.createExamRow(ghostStudentId);
    const started = await this.attempts.start({ studentId: ghostStudentId }, listeningAssessmentId);
    await this.prisma.examAttempt.update({ where: { id: examAttemptId }, data: { listeningAttemptId: started.attempt.id, stageDeadlineAt: started.attempt.expiresAt } });
    return examAttemptId;
  }

  private async createGhostStudent(email: string, phone: string) {
    const studentRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
    const passwordHash = await argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email: `freelead-${randomUUID()}@${GHOST_EMAIL_DOMAIN}`, phone, passwordHash,
        student: { create: { firstName: 'Free', lastName: 'Trial' } },
        roles: { create: { roleId: studentRole.id } },
      },
      include: { student: { select: { id: true } } },
    });
    return user.student!.id;
  }

  private async loadLead(leadId: string) {
    const lead = await this.prisma.freeAssessmentLead.findUnique({ where: { id: leadId }, include: { examAttempt: true } });
    if (!lead) throw notFound('Free test claim');
    if (!lead.ghostStudentId || !lead.examAttempt) throw new AppError('FREE_TEST_INVALID', 409, 'This free test claim is no longer valid.');
    return { ...lead, ghostStudentId: lead.ghostStudentId, examAttempt: lead.examAttempt };
  }

  /** Current state of the free test — the same restricted DTO shape SimulatorService.get() already
   *  returns (band/status/word-count per section, never per-question data), so no separate
   *  hand-written projection is needed here. */
  async get(leadId: string) {
    const lead = await this.loadLead(leadId);
    return this.sim.get(lead.ghostStudentId, lead.examAttempt.id);
  }

  private activeSectionAttemptId(lead: Awaited<ReturnType<FreeTestService['loadLead']>>) {
    const attemptId = lead.examAttempt.stage === 'READING' ? lead.examAttempt.readingAttemptId : lead.examAttempt.listeningAttemptId;
    if (!attemptId) throw new AppError('SUBMISSION_INCOMPLETE', 409, 'This section is not open yet.');
    return attemptId;
  }

  /** The Listening/Reading paper (sections, questions, saved answers) for whichever sub-attempt is
   *  currently active — the same shape AttemptsService.getAttempt() returns to a logged-in student. */
  async getSection(leadId: string) {
    const lead = await this.loadLead(leadId);
    return this.attempts.getAttempt({ studentId: lead.ghostStudentId }, this.activeSectionAttemptId(lead));
  }

  async saveAnswers(leadId: string, input: SaveAnswersInput) {
    const lead = await this.loadLead(leadId);
    return this.attempts.saveAnswers({ studentId: lead.ghostStudentId }, this.activeSectionAttemptId(lead), input);
  }

  async submitSection(leadId: string) {
    const lead = await this.loadLead(leadId);
    return this.attempts.submit({ studentId: lead.ghostStudentId }, this.activeSectionAttemptId(lead));
  }

  async advance(leadId: string, expectedRevision: number) {
    const lead = await this.loadLead(leadId);
    const result = await this.sim.advance(lead.ghostStudentId, lead.examAttempt.id, expectedRevision);
    if (result.status === 'COMPLETED') await this.prisma.freeAssessmentLead.update({ where: { id: leadId }, data: { status: 'COMPLETED' } });
    return result;
  }

  private activeWritingResponseId(lead: Awaited<ReturnType<FreeTestService['loadLead']>>) {
    if (!lead.examAttempt.writingResponseId) throw new AppError('SUBMISSION_INCOMPLETE', 409, 'The writing section is not open yet.');
    return lead.examAttempt.writingResponseId;
  }

  async getWriting(leadId: string) {
    const lead = await this.loadLead(leadId);
    return this.writing.get(lead.ghostStudentId, this.activeWritingResponseId(lead));
  }

  async saveWriting(leadId: string, input: SaveWritingInput) {
    const lead = await this.loadLead(leadId);
    return this.writing.save(lead.ghostStudentId, this.activeWritingResponseId(lead), input);
  }

  async submitWriting(leadId: string) {
    const lead = await this.loadLead(leadId);
    return this.writing.submit(lead.ghostStudentId, this.activeWritingResponseId(lead));
  }

  async listSpeakingQuestions(part: 'PART1' | 'PART2' | 'PART3') {
    return this.speaking.questions(part);
  }

  async addSpeakingResponse(leadId: string, body: AddSpeakingResponseInput) {
    const lead = await this.loadLead(leadId);
    if (!lead.examAttempt.speakingAttemptId) throw new AppError('SUBMISSION_INCOMPLETE', 409, 'The speaking section is not open yet.');
    return this.speaking.addResponse(lead.ghostStudentId, lead.examAttempt.speakingAttemptId, body);
  }

  async uploadSpeakingAudio(leadId: string, responseId: string, file: { buffer: Buffer; size: number }) {
    const lead = await this.loadLead(leadId);
    return this.speaking.uploadLocal(lead.ghostStudentId, responseId, file);
  }

  /** Called when a visitor registers for real with the same email: links the lead's history to the
   *  new account without granting a second free entitlement. All 4 owned resources are reassigned so
   *  the real student can see their free-test history (listening/reading attempts, essay, speaking
   *  attempt), matching how the single-assessment free test reassigned its one attempt. */
  async linkToRegisteredStudent(email: string, newStudentId: string) {
    const emailNormalized = email.trim().toLowerCase();
    const leads = await this.prisma.freeAssessmentLead.findMany({ where: { emailNormalized, linkedStudentId: null }, include: { examAttempt: true } });
    for (const lead of leads) {
      await this.prisma.$transaction(async (tx) => {
        const e = lead.examAttempt;
        if (e) {
          if (e.listeningAttemptId) await tx.assessmentAttempt.updateMany({ where: { id: e.listeningAttemptId }, data: { studentId: newStudentId } });
          if (e.readingAttemptId) await tx.assessmentAttempt.updateMany({ where: { id: e.readingAttemptId }, data: { studentId: newStudentId } });
          if (e.writingResponseId) await tx.writingResponse.updateMany({ where: { id: e.writingResponseId }, data: { studentId: newStudentId } });
          if (e.speakingAttemptId) await tx.speakingAttempt.updateMany({ where: { id: e.speakingAttemptId }, data: { studentId: newStudentId } });
          await tx.examAttempt.updateMany({ where: { id: e.id }, data: { studentId: newStudentId } });
        }
        await tx.freeAssessmentLead.update({ where: { id: lead.id }, data: { linkedStudentId: newStudentId } });
      });
    }
  }
}

import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { AddSpeakingResponseInput, SaveAnswersInput, SaveWritingInput } from '@ielts/validation';
import { AppError, notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptsService } from '../assessments/attempts.service';
import { RotationService } from '../question-bank/rotation.service';
import { SimulatorService } from '../simulator/simulator.service';
import { SpeakingService } from '../speaking/speaking.service';
import { WritingService } from '../writing/writing.service';

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
    private readonly rotation: RotationService,
  ) {}

  /** Claims a brand-new, fully anonymous free test. No identity is collected, so there is nothing
   *  to dedupe or resume server-side — the client is solely responsible for remembering its own
   *  leadId (see the free-test pages' localStorage use) and calling GET /free-test/:leadId to
   *  resume. This means "one free test per person" is no longer enforced — an accepted tradeoff. */
  async claim(meta: { ip?: string; userAgent?: string }) {
    // Not one big transaction: createExam() calls AttemptsService.start(), which opens its own
    // transaction and needs the ghost student's row already committed and visible — not still
    // sitting inside an uncommitted outer transaction, which would fail its FK check.
    const ghostStudentId = await this.createGhostStudent();
    const examAttemptId = await this.createExam(ghostStudentId);
    const lead = await this.prisma.freeAssessmentLead.create({
      data: { ghostStudentId, examAttemptId, ipAddress: meta.ip, userAgent: meta.userAgent, expiresAt: new Date(Date.now() + LEAD_TTL_MS) },
    });
    return { leadId: lead.id, resumable: false };
  }

  /** Picks Listening/Reading bank sets (advisory-locked so concurrent claims balance fairly), then —
   *  outside that lock, since resolving a wrapper may itself build one through several small
   *  transactions — resolves each pick's wrapper Assessment and creates the bare ExamAttempt row, the
   *  same shape `SimulatorService.start()` creates, but without that method's enrollment/mocks-
   *  approval gate: DIAGNOSTIC assessments need neither, exactly as the free test already relied on.
   *  Picking/wrapper-building itself is shared with mock-exam composition via RotationService. */
  private async createExamRow(ghostStudentId: string) {
    const [listeningSetId, readingSetId] = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('free_test_assign'))`;
      return Promise.all([this.rotation.pickLeastUsedBankSet(tx, 'LISTENING'), this.rotation.pickLeastUsedBankSet(tx, 'READING')]);
    });
    const [listeningAssessmentId, readingAssessmentId] = await Promise.all([
      this.rotation.resolveWrapperAssessment(listeningSetId, 'LISTENING'),
      this.rotation.resolveWrapperAssessment(readingSetId, 'READING'),
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

  /** No email/phone is ever collected for an anonymous free test, so the ghost's own synthetic
   *  email (never real, never reachable) is its only identity. */
  private async createGhostStudent() {
    const studentRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
    const passwordHash = await argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email: `freelead-${randomUUID()}@${GHOST_EMAIL_DOMAIN}`, passwordHash,
        student: { create: { firstName: 'Free', lastName: 'Trial', isGhost: true } },
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

  async markAudioPlayed(leadId: string) {
    const lead = await this.loadLead(leadId);
    return this.attempts.markAudioPlayed({ studentId: lead.ghostStudentId }, this.activeSectionAttemptId(lead));
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
    // The free test is designed to let a visitor finish even with incomplete answers (missing
    // sections are recorded, not blocked) — an essay under the normal 20-word minimum should grade
    // as a weak answer, not hard-stop the whole test the way it does for an enrolled student.
    return this.writing.submit(lead.ghostStudentId, this.activeWritingResponseId(lead), true);
  }

  async listSpeakingQuestions(part: 'PART1' | 'PART2' | 'PART3') {
    return this.speaking.questions(part, 20, true);
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

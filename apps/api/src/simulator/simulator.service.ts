import { Body, Controller, Get, HttpCode, Injectable, Logger, Module, OnModuleInit, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SIMULATOR_COMPLETED, SimulatorCompleted } from './events';
import {
  simulatorAdvanceSchema, simulatorStartSchema, simulatorStartFromMockExamSchema, SimulatorStartInput, SimulatorStartFromMockExamInput,
} from '@ielts/validation';
import { AttemptsService } from '../assessments/attempts.service';
import { AppError, conflict, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { roundHalfBand } from '../analytics/band';
import { SchedulerService } from '../jobs/scheduler.service';
import { MocksService } from '../mocks/mocks.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionBankService } from '../question-bank/question-bank.service';
import { RotationService } from '../question-bank/rotation.service';
import { SpeakingService } from '../speaking/speaking.service';
import { WritingService } from '../writing/writing.service';
import { AssessmentsModule } from '../assessments/assessments.module';
import { MocksModule } from '../mocks/mocks.service';
import { QuestionBankModule } from '../question-bank/question-bank.module';
import { WritingModule } from '../writing/writing.module';
import { SpeakingModule } from '../speaking/speaking.module';
import { selectCandidates } from '../question-bank/selection';

export type Stage = 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING' | 'DONE';
const WRITING_MINUTES = 60;
const SPEAKING_MINUTES = 20;
const ADVANCE_EVERY_MS = 60_000;

/** The order of the simulator. A stage only moves forward. */
export const NEXT_STAGE: Record<Exclude<Stage, 'DONE'>, Stage> = { LISTENING: 'READING', READING: 'WRITING', WRITING: 'SPEAKING', SPEAKING: 'DONE' };

/**
 * Overall estimate: the mean of the four skill bands, rounded to the nearest half band (the convention already
 * used by analytics). Null when any skill is missing; the missing skills are named rather than averaged away.
 */
export function overallFrom(skills: Record<'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING', number | null>) {
  const missing = (Object.keys(skills) as (keyof typeof skills)[]).filter((k) => skills[k] === null);
  if (missing.length > 0) return { overall: null, missing };
  const values = Object.values(skills) as number[];
  return { overall: roundHalfBand(values.reduce((s, v) => s + v, 0) / values.length), missing: [] as string[] };
}

@Injectable()
export class SimulatorService implements OnModuleInit {
  private readonly logger = new Logger(SimulatorService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: AttemptsService,
    private readonly writing: WritingService,
    private readonly speaking: SpeakingService,
    private readonly bank: QuestionBankService,
    private readonly rotation: RotationService,
    private readonly scheduler: SchedulerService,
    private readonly events: EventEmitter2,
    private readonly mocks: MocksService,
  ) {}

  onModuleInit() {
    this.scheduler.register('simulator.advance', ADVANCE_EVERY_MS * 5, () => this.advanceDue());
  }

  /** Library mocks a student may take in the simulator, each with the student's own access status.
   *  `mockExams` is the new whole-module bundle shape (Phase 6) — a single pre-paired Listening+
   *  Reading unit, requested/started as one thing instead of mixing and matching from two separate
   *  lists. `listening`/`reading` stay for any pre-Phase-6 single-skill mocks still in the library,
   *  so in-flight access requests/activations on them keep working unchanged. */
  async available(studentId: string) {
    const rows = await this.prisma.assessment.findMany({
      where: { type: 'MOCK', origin: 'BANK', libraryVisible: true, skill: { in: ['LISTENING', 'READING'] }, versions: { some: { publishedAt: { not: null } } } },
      orderBy: { title: 'asc' }, take: 200,
      select: { id: true, title: true, skill: true, timeLimitMin: true },
    });
    const mockExamRows = await this.prisma.mockExam.findMany({
      where: { libraryVisible: true, status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'desc' }, take: 200,
      select: {
        id: true, title: true, createdAt: true,
        listeningSet: { select: { title: true } },
        readingSet: { select: { title: true } },
        listeningAssessmentId: true, readingAssessmentId: true,
      },
    });
    const mockExamsWithAttempts = await Promise.all(mockExamRows.map(async (m) => {
      const attempts = await this.prisma.examAttempt.findMany({
        where: { studentId, listeningAssessmentId: m.listeningAssessmentId, readingAssessmentId: m.readingAssessmentId },
        orderBy: { createdAt: 'desc' }, take: 10,
        select: { id: true, status: true, overallEstimate: true, completedAt: true },
      });
      return {
        id: m.id, title: m.title, createdAt: m.createdAt,
        listeningModuleTitle: m.listeningSet.title, readingModuleTitle: m.readingSet.title,
        attempts: attempts.map((a) => ({ id: a.id, status: a.status, overallEstimate: a.overallEstimate, completedAt: a.completedAt })),
        inProgressAttemptId: attempts.find((a) => a.status === 'IN_PROGRESS')?.id ?? null,
      };
    }));
    return {
      listening: rows.filter((r) => r.skill === 'LISTENING'),
      reading: rows.filter((r) => r.skill === 'READING'),
      mockExams: mockExamsWithAttempts,
    };
  }

  async start(studentId: string, input: SimulatorStartInput) {
    const [l, r] = await Promise.all([
      this.prisma.assessment.findUnique({ where: { id: input.listeningAssessmentId }, select: { type: true, skill: true, libraryVisible: true } }),
      this.prisma.assessment.findUnique({ where: { id: input.readingAssessmentId }, select: { type: true, skill: true, libraryVisible: true } }),
    ]);
    if (!l || l.skill !== 'LISTENING' || !l.libraryVisible || !r || r.skill !== 'READING' || !r.libraryVisible) {
      throw notFound('Mock exam');
    }
    return this.createExamAttempt(studentId, input.listeningAssessmentId, input.readingAssessmentId, input.includeSpeaking);
  }

  /** start()'s twin for the new whole-module MockExam shape (Phase 6) — one access check against
   *  the bundle instead of two against its underlying Listening/Reading assessments. */
  async startFromMockExam(studentId: string, mockExamId: string, includeSpeaking: boolean) {
    const m = await this.prisma.mockExam.findUnique({ where: { id: mockExamId }, select: { libraryVisible: true, status: true, listeningAssessmentId: true, readingAssessmentId: true } });
    if (!m || !m.libraryVisible || m.status === 'ARCHIVED') throw notFound('Mock exam');
    return this.createExamAttempt(studentId, m.listeningAssessmentId, m.readingAssessmentId, includeSpeaking, mockExamId);
  }

  private async createExamAttempt(studentId: string, listeningAssessmentId: string, readingAssessmentId: string, includeSpeaking: boolean, mockExamId?: string) {
    // ── Safety check: surface any already-bricked open attempt with a resume link ────────────────
    // The partial unique index exam_attempts_one_open(student_id) allows exactly one IN_PROGRESS
    // exam attempt per student.  If a previous attempt was created but then its startSection()
    // failed (leaving listeningAttemptId null), it permanently blocks new attempts and there is no
    // auto-recovery path.  Detect it here so the error message includes a usable link.
    const stuck = await this.prisma.examAttempt.findFirst({
      where: { studentId, status: 'IN_PROGRESS', listeningAttemptId: null },
      select: { id: true },
    });
    if (stuck) {
      // Abandon the orphan — it has no listening attempt, no deadline, and is unresumable.
      await this.prisma.examAttempt.updateMany({ where: { id: stuck.id, listeningAttemptId: null }, data: { status: 'ABANDONED' } });
    }

    // ── Attempt creation (P2002 = already has a valid in-progress one) ───────────────────────────
    let examId: string;
    try {
      const exam = await this.prisma.examAttempt.create({
        data: { studentId, includeSpeaking, listeningAssessmentId, readingAssessmentId, stage: 'LISTENING', ...(mockExamId ? { mockExamId } : {}) },
        select: { id: true },
      });
      examId = exam.id;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.examAttempt.findFirst({ where: { studentId, status: 'IN_PROGRESS' }, select: { id: true } });
        throw conflict('ALREADY_IN_PROGRESS', existing
          ? `You already have a simulator in progress. Resume it to continue.`
          : 'You already have a simulator in progress. Finish or resume it first.');
      }
      throw e;
    }

    // ── Start the listening section; roll back the attempt row on failure ─────────────────────────
    // Not wrapped in a single DB transaction because AttemptsService.start() opens its own
    // transaction internally — nesting would violate the "no interactive tx nesting" rule.
    // Instead, we simply delete the attempt row on any start failure so the student is never stuck.
    let started: { id: string; expiresAt: Date | null };
    try {
      started = await this.startSection(studentId, listeningAssessmentId);
    } catch (e) {
      await this.prisma.examAttempt.deleteMany({ where: { id: examId } });
      throw e;
    }

    await this.prisma.examAttempt.update({ where: { id: examId }, data: { listeningAttemptId: started.id, stageDeadlineAt: started.expiresAt } });
    return this.get(studentId, examId);
  }

  async get(studentId: string, id: string) {
    const e = await this.prisma.examAttempt.findFirst({
      where: { id, studentId },
      include: {
        listeningAttempt: { select: { id: true, status: true, bandScore: true } },
        readingAttempt: { select: { id: true, status: true, bandScore: true } },
        writingTask1Response: { select: { id: true, status: true, wordCount: true } },
        writingResponse: { select: { id: true, status: true, wordCount: true } },
        speakingAttempt: { select: { id: true, status: true, responses: { select: { id: true } } } },
      },
    });
    if (!e) throw notFound('Simulator');
    const now = Date.now();
    return {
      id: e.id,
      status: e.status,
      stage: e.stage,
      stageRevision: e.stageRevision,
      includeSpeaking: e.includeSpeaking,
      stageDeadlineAt: e.stageDeadlineAt,
      secondsRemaining: e.stageDeadlineAt ? Math.max(0, Math.floor((e.stageDeadlineAt.getTime() - now) / 1000)) : null,
      sections: {
        listening: e.listeningAttempt ? { attemptId: e.listeningAttempt.id, status: e.listeningAttempt.status, band: e.listeningAttempt.bandScore } : null,
        reading: e.readingAttempt ? { attemptId: e.readingAttempt.id, status: e.readingAttempt.status, band: e.readingAttempt.bandScore } : null,
        writing: {
          task1: e.writingTask1Response ? { responseId: e.writingTask1Response.id, status: e.writingTask1Response.status, wordCount: e.writingTask1Response.wordCount } : null,
          task2: e.writingResponse ? { responseId: e.writingResponse.id, status: e.writingResponse.status, wordCount: e.writingResponse.wordCount } : null,
        },
        speaking: e.speakingAttempt ? { attemptId: e.speakingAttempt.id, status: e.speakingAttempt.status, answers: e.speakingAttempt.responses.length } : null,
      },
      overallEstimate: e.overallEstimate,
      missingSkills: e.missingSkills,
      completedAt: e.completedAt,
    };
  }

  async list(studentId: string) {
    return this.prisma.examAttempt.findMany({
      where: { studentId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, status: true, stage: true, overallEstimate: true, missingSkills: true, createdAt: true, completedAt: true },
    });
  }

  /**
   * Moves the simulator on when the current section is finished. The request must carry the revision the client
   * saw; a stale or repeated request is refused, so one click can never advance twice.
   */
  async advance(studentId: string, id: string, expectedRevision: number) {
    const e = await this.prisma.examAttempt.findFirst({ where: { id, studentId }, select: { id: true, status: true } });
    if (!e) throw notFound('Simulator');
    return this.progress(id, studentId, expectedRevision, false);
  }

  /** Scheduled: advances any simulator whose timed section has run out, so nothing waits on the student. */
  async advanceDue(now = new Date()) {
    const due = await this.prisma.examAttempt.findMany({
      where: { status: 'IN_PROGRESS', stage: { in: ['LISTENING', 'READING', 'WRITING'] }, stageDeadlineAt: { lt: now } },
      select: { id: true, studentId: true, stageRevision: true }, take: 100,
    });
    let moved = 0;
    for (const d of due) {
      try {
        await this.progress(d.id, d.studentId, d.stageRevision, true);
        moved++;
      } catch (err) {
        // Suppress revision-race errors (already advanced by the student or a concurrent cron tick).
        // Log everything else so stuck attempts are visible.
        const code = (err as { code?: string; response?: { code?: string } })?.code ?? (err as { response?: { code?: string } })?.response?.code;
        if (code !== 'CONFLICT') this.logger.warn({ examAttemptId: d.id, err }, 'advanceDue: failed to advance exam attempt');
      }
    }
    return { moved };
  }

  private async progress(id: string, studentId: string, expectedRevision: number, forced: boolean) {
    const e = await this.prisma.examAttempt.findUniqueOrThrow({ where: { id } });
    if (e.status !== 'IN_PROGRESS') throw conflict('CONFLICT', 'This simulator is already finished.');
    if (e.stageRevision !== expectedRevision) throw conflict('CONFLICT', 'The simulator has moved on. Reload to see where you are.');
    const expired = !!e.stageDeadlineAt && e.stageDeadlineAt.getTime() <= Date.now();
    const user = { studentId } as Pick<AuthUser, 'id'> & { studentId: string };
    const claim = async (data: Prisma.ExamAttemptUncheckedUpdateInput) => {
      const r = await this.prisma.examAttempt.updateMany({ where: { id, stageRevision: expectedRevision }, data: { ...data, stageRevision: { increment: 1 } } });
      if (r.count === 0) throw conflict('CONFLICT', 'The simulator has moved on. Reload to see where you are.');
    };

    switch (e.stage) {
      case 'LISTENING':
      case 'READING': {
        const attemptId = e.stage === 'LISTENING' ? e.listeningAttemptId : e.readingAttemptId;
        const attempt = attemptId ? await this.prisma.assessmentAttempt.findUnique({ where: { id: attemptId }, select: { id: true, status: true } }) : null;
        if (attempt && attempt.status === 'IN_PROGRESS') {
          if (!expired && !forced) throw new AppError('CONFLICT', 409, `Finish the ${e.stage.toLowerCase()} section first.`);
          await this.attempts.submit(user, attempt.id).catch(() => undefined);
        }
        const nextAssessment = e.stage === 'LISTENING' ? e.readingAssessmentId : null;
        if (e.stage === 'LISTENING') {
          // Guard: readingAssessmentId is nullable in the schema; if somehow null, skip reading.
          if (!nextAssessment) return this.afterReading(e, studentId, claim);
          const started = await this.startSection(studentId, nextAssessment);
          try {
            await claim({ stage: 'READING', readingAttemptId: started.id, stageDeadlineAt: started.expiresAt });
          } catch (claimErr) {
            // Race lost: another concurrent advance already moved us on. Roll back the assessment
            // attempt we just created so it doesn't orphan under the one_in_progress index.
            await this.prisma.assessmentAttempt.deleteMany({ where: { id: started.id, status: 'IN_PROGRESS' } }).catch(() => undefined);
            throw claimErr;
          }
          return this.get(studentId, id);
        }
        return this.afterReading(e, studentId, claim);
      }
      case 'WRITING': {
        const [w1, w2] = await Promise.all([
          e.writingTask1ResponseId ? this.prisma.writingResponse.findUnique({ where: { id: e.writingTask1ResponseId }, select: { status: true, id: true } }) : null,
          e.writingResponseId ? this.prisma.writingResponse.findUnique({ where: { id: e.writingResponseId }, select: { status: true, id: true } }) : null,
        ]);
        const drafts = [w1, w2].filter((w): w is NonNullable<typeof w> => !!w && w.status === 'DRAFT');
        if (drafts.length > 0) {
          if (!expired && !forced) throw new AppError('CONFLICT', 409, 'Submit your writing tasks first.');
          await Promise.all(drafts.map((w) => this.writing.submit(studentId, w.id)));
        }
        if (e.includeSpeaking) {
          const speaking = await this.prisma.speakingAttempt.create({ data: { studentId, mode: 'FULL' }, select: { id: true } });
          try {
            await claim({ stage: 'SPEAKING', speakingAttemptId: speaking.id, stageDeadlineAt: new Date(Date.now() + SPEAKING_MINUTES * 60_000) });
          } catch (claimErr) {
            // Race lost: clean up the speaking attempt we just created.
            await this.prisma.speakingAttempt.deleteMany({ where: { id: speaking.id } }).catch(() => undefined);
            throw claimErr;
          }
          return this.get(studentId, id);
        }
        return this.finish(e, claim, studentId);
      }
      case 'SPEAKING': {
        const answers = e.speakingAttemptId ? await this.prisma.speakingResponse.count({ where: { attemptId: e.speakingAttemptId } }) : 0;
        if (answers === 0 && !expired && !forced) throw new AppError('CONFLICT', 409, 'Record your speaking answers first.');
        return this.finish(e, claim, studentId);
      }
      default:
        throw conflict('CONFLICT', 'This simulator is already finished.');
    }
  }

  /** Reading finished: move to writing with prompts from the bank (or the mock's pinned questions if set),
   *  or skip writing if none are available.
   *  A free-test ghost student picks least-used-first among rotation-eligible sets only;
   *  a real, authenticated student uses a seeded random pick across every published set. */
  private async afterReading(e: { id: string; includeSpeaking: boolean; stageRevision: number }, studentId: string, claim: (d: Prisma.ExamAttemptUncheckedUpdateInput) => Promise<void>) {
    // Check for a mock-exam with pinned W questions first (Phase 3.2).
    const examRow = await this.prisma.examAttempt.findUnique({ where: { id: e.id }, select: { mockExamId: true } });
    const mockExam = examRow?.mockExamId
      ? await this.prisma.mockExam.findUnique({ where: { id: examRow.mockExamId }, select: { writingTask1QuestionId: true, writingTask2QuestionId: true } })
      : null;

    let task1Pick: string | undefined;
    let task2Pick: string | undefined;

    if (mockExam?.writingTask1QuestionId || mockExam?.writingTask2QuestionId) {
      // Use pinned questions from the mock exam (nullish → auto-pick that slot)
      task1Pick = mockExam.writingTask1QuestionId ?? undefined;
      task2Pick = mockExam.writingTask2QuestionId ?? undefined;
    } else {
      const student = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { isGhost: true } });
      [task1Pick, task2Pick] = await (student?.isGhost
        ? Promise.all([
            this.rotation.pickLeastUsedBankQuestion('WRITING', ['WRITING_TASK1']),
            this.rotation.pickLeastUsedBankQuestion('WRITING', ['WRITING_TASK2']),
          ])
        : Promise.all([
            selectCandidates(await this.bank.candidates({ skill: 'WRITING', ieltsTypes: ['WRITING_TASK1'] }, true), { count: 1, seed: `sim1|${e.id}` }),
            selectCandidates(await this.bank.candidates({ skill: 'WRITING', ieltsTypes: ['WRITING_TASK2'] }, true), { count: 1, seed: `sim2|${e.id}` }),
          ]).then(([a, b]) => [a[0], b[0]] as [string | undefined, string | undefined]));
    }
    if (!task1Pick && !task2Pick) {
      return this.afterWritingSkipped(e, studentId, claim);
    }
    const [task1, task2] = await Promise.all([
      task1Pick ? this.writing.create(studentId, { taskType: 'TASK1', questionId: task1Pick }) : null,
      task2Pick ? this.writing.create(studentId, { taskType: 'TASK2', questionId: task2Pick }) : null,
    ]);
    try {
      await claim({
        stage: 'WRITING',
        writingTask1ResponseId: task1?.id ?? null,
        writingResponseId: task2?.id ?? null,
        stageDeadlineAt: new Date(Date.now() + WRITING_MINUTES * 60_000),
      });
    } catch (claimErr) {
      // Race lost: delete the writing responses we just created before re-throwing.
      await Promise.all([
        task1 ? this.prisma.writingResponse.deleteMany({ where: { id: task1.id, status: 'DRAFT' } }) : null,
        task2 ? this.prisma.writingResponse.deleteMany({ where: { id: task2.id, status: 'DRAFT' } }) : null,
      ]).catch(() => undefined);
      throw claimErr;
    }
    return this.get(studentId, e.id);
  }

  private async afterWritingSkipped(e: { id: string; includeSpeaking: boolean }, studentId: string, claim: (d: Prisma.ExamAttemptUncheckedUpdateInput) => Promise<void>) {
    await this.prisma.examAttempt.update({ where: { id: e.id }, data: { missingSkills: ['WRITING'] } });
    if (e.includeSpeaking) {
      const speaking = await this.prisma.speakingAttempt.create({ data: { studentId, mode: 'FULL' }, select: { id: true } });
      await claim({ stage: 'SPEAKING', speakingAttemptId: speaking.id, stageDeadlineAt: new Date(Date.now() + SPEAKING_MINUTES * 60_000) });
      return this.get(studentId, e.id);
    }
    const fresh = await this.prisma.examAttempt.findUniqueOrThrow({ where: { id: e.id } });
    return this.finish(fresh, claim, studentId);
  }

  /** Works out the overall estimate from the stored section results, then closes the simulator. */
  private async finish(e: { id: string; listeningAttemptId: string | null; readingAttemptId: string | null; writingTask1ResponseId: string | null; writingResponseId: string | null; speakingAttemptId: string | null; missingSkills: string[]; stageRevision: number }, claim: (d: Prisma.ExamAttemptUncheckedUpdateInput) => Promise<void>, studentId: string) {
    const [listening, reading] = await Promise.all([
      e.listeningAttemptId ? this.prisma.assessmentAttempt.findUnique({ where: { id: e.listeningAttemptId }, select: { bandScore: true } }) : null,
      e.readingAttemptId ? this.prisma.assessmentAttempt.findUnique({ where: { id: e.readingAttemptId }, select: { bandScore: true } }) : null,
    ]);
    const [writingEval1, writingEval2] = await Promise.all([
      e.writingTask1ResponseId ? this.prisma.writingEvaluation.findFirst({ where: { responseId: e.writingTask1ResponseId }, orderBy: { createdAt: 'desc' }, select: { estimatedBand: true } }) : null,
      e.writingResponseId ? this.prisma.writingEvaluation.findFirst({ where: { responseId: e.writingResponseId }, orderBy: { createdAt: 'desc' }, select: { estimatedBand: true } }) : null,
    ]);
    const writingBands = [writingEval1, writingEval2].flatMap((ev) => ev?.estimatedBand !== null && ev?.estimatedBand !== undefined ? [Number(ev.estimatedBand)] : []);
    const writingEval = writingBands.length ? { estimatedBand: writingBands.reduce((a, b) => a + b, 0) / writingBands.length } : null;
    const speakingEvals = e.speakingAttemptId
      ? await this.prisma.speakingEvaluation.findMany({ where: { response: { attemptId: e.speakingAttemptId } }, orderBy: { createdAt: 'desc' }, select: { responseId: true, estimatedBand: true } })
      : [];
    const latestSpeaking = [...new Map(speakingEvals.map((s) => [s.responseId, s])).values()];
    const speakingBand = latestSpeaking.length
      ? roundHalfBand(latestSpeaking.reduce((sum, s) => sum + Number(s.estimatedBand ?? 0), 0) / latestSpeaking.length)
      : null;
    const skills = {
      LISTENING: listening?.bandScore === null || listening?.bandScore === undefined ? null : Number(listening.bandScore),
      READING: reading?.bandScore === null || reading?.bandScore === undefined ? null : Number(reading.bandScore),
      WRITING: writingEval?.estimatedBand === null || writingEval?.estimatedBand === undefined ? null : Number(writingEval.estimatedBand),
      SPEAKING: e.speakingAttemptId ? speakingBand : null,
    };
    const { overall, missing } = overallFrom(skills);
    const allMissing = [...new Set([...e.missingSkills, ...missing])];
    await claim({
      stage: 'DONE', status: 'COMPLETED', completedAt: new Date(), overallEstimate: overall === null ? null : new Prisma.Decimal(overall), missingSkills: allMissing,
    });
    this.events.emit(SIMULATOR_COMPLETED, { studentId, examAttemptId: e.id } satisfies SimulatorCompleted);
    return this.get(studentId, e.id);
  }

  /** Full results after the simulator completes — one object per skill with per-question review,
   *  writing evaluation, and speaking transcripts, plus overall band. */
  async results(studentId: string, id: string) {
    const e = await this.prisma.examAttempt.findFirst({
      where: { id, studentId },
      select: { status: true, overallEstimate: true, missingSkills: true, listeningAttemptId: true, readingAttemptId: true, writingTask1ResponseId: true, writingResponseId: true, speakingAttemptId: true },
    });
    if (!e) throw notFound('Simulator');

    const user = { studentId };
    const [listeningResult, readingResult] = await Promise.all([
      e.listeningAttemptId ? this.attempts.result(user, e.listeningAttemptId).catch(() => null) : null,
      e.readingAttemptId ? this.attempts.result(user, e.readingAttemptId).catch(() => null) : null,
    ]);

    const writingSelect = {
      id: true, status: true, taskType: true, body: true, wordCount: true, promptText: true,
      evaluations: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { estimatedBand: true, criteria: true, feedback: true } },
    };
    const [writingTask1, writingTask2] = await Promise.all([
      e.writingTask1ResponseId ? this.prisma.writingResponse.findUnique({ where: { id: e.writingTask1ResponseId }, select: writingSelect }) : null,
      e.writingResponseId ? this.prisma.writingResponse.findUnique({ where: { id: e.writingResponseId }, select: writingSelect }) : null,
    ]);
    const toWritingResult = (r: typeof writingTask1) => r ? {
      taskType: r.taskType, status: r.status, wordCount: r.wordCount, prompt: r.promptText, body: r.body,
      evaluation: r.evaluations[0] ?? null,
    } : null;

    const speaking = e.speakingAttemptId
      ? await this.prisma.speakingAttempt.findUnique({
          where: { id: e.speakingAttemptId },
          select: {
            id: true, status: true,
            responses: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true, part: true, promptText: true, transcript: true, durationSec: true,
                evaluations: { orderBy: { createdAt: 'desc' }, take: 1, select: { estimatedBand: true, criteria: true, feedback: true } },
              },
            },
          },
        })
      : null;

    const speakingBands = speaking?.responses?.flatMap((r) => r.evaluations.map((ev) => Number(ev.estimatedBand ?? 0))) ?? [];
    const speakingBand = speakingBands.length ? roundHalfBand(speakingBands.reduce((a, b) => a + b, 0) / speakingBands.length) : null;

    return {
      overall: e.overallEstimate === null ? null : Number(e.overallEstimate),
      missingSkills: e.missingSkills,
      listening: listeningResult,
      reading: readingResult,
      writing: { task1: toWritingResult(writingTask1), task2: toWritingResult(writingTask2) },
      speaking: speaking ? {
        status: speaking.status, band: speakingBand,
        responses: speaking.responses.map((r) => ({
          id: r.id, part: r.part, prompt: r.promptText, transcript: r.transcript, durationSec: r.durationSec,
          evaluation: r.evaluations[0] ?? null,
        })),
      } : null,
    };
  }

  /** Starts a library mock as a normal attempt, so the existing timing, autosave and grading all apply. */
  private async startSection(studentId: string, assessmentId: string): Promise<{ id: string; expiresAt: Date | null }> {
    const started = await this.attempts.start({ studentId } as AuthUser & { studentId: string }, assessmentId);
    const attempt = (started as { attempt?: { id: string; expiresAt: Date | null } }).attempt;
    if (!attempt) throw forbidden();
    return { id: attempt.id, expiresAt: attempt.expiresAt };
  }
}

const uuid = new ParseUUIDPipe();
const sid = (u: AuthUser) => { if (!u.studentId) throw forbidden(); return u.studentId; };

@Controller('simulator')
export class SimulatorController {
  constructor(private readonly sim: SimulatorService) {}

  @Get('available') available(@CurrentUser() u: AuthUser) { return this.sim.available(sid(u)); }
  @Get('exams') list(@CurrentUser() u: AuthUser) { return this.sim.list(sid(u)); }

  @HttpCode(201) @Post('exams')
  start(@Body(new ZodPipe(simulatorStartSchema)) body: SimulatorStartInput, @CurrentUser() u: AuthUser) { return this.sim.start(sid(u), body); }

  /** start()'s twin for the new whole-module MockExam shape (Phase 6). Declared before 'exams/:id'
   *  below so 'from-mock-exam' is never matched as an exam id. */
  @HttpCode(201) @Post('exams/from-mock-exam')
  startFromMockExam(@Body(new ZodPipe(simulatorStartFromMockExamSchema)) body: SimulatorStartFromMockExamInput, @CurrentUser() u: AuthUser) {
    return this.sim.startFromMockExam(sid(u), body.mockExamId, body.includeSpeaking);
  }

  @Get('exams/:id') get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.sim.get(sid(u), id); }

  /** Declared after ':id' (not a collision risk) since 'results' is a sub-path, not an id match. */
  @Get('exams/:id/results') getResults(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.sim.results(sid(u), id); }

  @HttpCode(200) @Post('exams/:id/advance')
  advance(@Param('id', uuid) id: string, @Body(new ZodPipe(simulatorAdvanceSchema)) body: { expectedRevision: number }, @CurrentUser() u: AuthUser) {
    return this.sim.advance(sid(u), id, body.expectedRevision);
  }
}

@Module({
  imports: [AssessmentsModule, QuestionBankModule, WritingModule, SpeakingModule, MocksModule],
  controllers: [SimulatorController],
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}


import { Body, Controller, Get, HttpCode, Injectable, Module, OnModuleInit, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SIMULATOR_COMPLETED, SimulatorCompleted } from './events';
import { simulatorAdvanceSchema, simulatorStartSchema, SimulatorStartInput } from '@ielts/validation';
import { AttemptsService } from '../assessments/attempts.service';
import { AppError, conflict, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { roundHalfBand } from '../analytics/band';
import { SchedulerService } from '../jobs/scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionBankService } from '../question-bank/question-bank.service';
import { SpeakingService } from '../speaking/speaking.service';
import { WritingService } from '../writing/writing.service';
import { AssessmentsModule } from '../assessments/assessments.module';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: AttemptsService,
    private readonly writing: WritingService,
    private readonly speaking: SpeakingService,
    private readonly bank: QuestionBankService,
    private readonly scheduler: SchedulerService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.scheduler.register('simulator.advance', ADVANCE_EVERY_MS * 5, () => this.advanceDue());
  }

  /** Library mocks a student may take in the simulator. */
  async available() {
    const rows = await this.prisma.assessment.findMany({
      where: { type: 'MOCK', origin: 'BANK', libraryVisible: true, skill: { in: ['LISTENING', 'READING'] }, versions: { some: { publishedAt: { not: null } } } },
      orderBy: { title: 'asc' }, take: 200,
      select: { id: true, title: true, skill: true, timeLimitMin: true },
    });
    return {
      listening: rows.filter((r) => r.skill === 'LISTENING'),
      reading: rows.filter((r) => r.skill === 'READING'),
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
    const exam = await this.prisma.examAttempt.create({
      data: { studentId, includeSpeaking: input.includeSpeaking, listeningAssessmentId: input.listeningAssessmentId, readingAssessmentId: input.readingAssessmentId, stage: 'LISTENING' },
      select: { id: true },
    }).catch((e) => {
      if ((e as { code?: string }).code === 'P2002') throw conflict('CONFLICT', 'You already have a simulator in progress. Finish or resume it first.');
      throw e;
    });
    const started = await this.startSection(studentId, input.listeningAssessmentId);
    await this.prisma.examAttempt.update({ where: { id: exam.id }, data: { listeningAttemptId: started.id, stageDeadlineAt: started.expiresAt } });
    return this.get(studentId, exam.id);
  }

  async get(studentId: string, id: string) {
    const e = await this.prisma.examAttempt.findFirst({
      where: { id, studentId },
      include: {
        listeningAttempt: { select: { id: true, status: true, bandScore: true } },
        readingAttempt: { select: { id: true, status: true, bandScore: true } },
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
        writing: e.writingResponse ? { responseId: e.writingResponse.id, status: e.writingResponse.status, wordCount: e.writingResponse.wordCount } : null,
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
      } catch {
        // Already moved, or the section is still being finished. Try again on the next run.
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
          const started = await this.startSection(studentId, nextAssessment!);
          await claim({ stage: 'READING', readingAttemptId: started.id, stageDeadlineAt: started.expiresAt });
          return this.get(studentId, id);
        }
        return this.afterReading(e, studentId, claim);
      }
      case 'WRITING': {
        const w = e.writingResponseId ? await this.prisma.writingResponse.findUnique({ where: { id: e.writingResponseId }, select: { status: true, id: true } }) : null;
        if (w && w.status === 'DRAFT') {
          if (!expired && !forced) throw new AppError('CONFLICT', 409, 'Submit your essay first.');
          await this.writing.submit(studentId, w.id);
        }
        if (e.includeSpeaking) {
          const speaking = await this.prisma.speakingAttempt.create({ data: { studentId, mode: 'FULL' }, select: { id: true } });
          await claim({ stage: 'SPEAKING', speakingAttemptId: speaking.id, stageDeadlineAt: new Date(Date.now() + SPEAKING_MINUTES * 60_000) });
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

  /** Reading finished: move to writing with a Task 2 prompt from the bank, or skip writing if none is published. */
  private async afterReading(e: { id: string; includeSpeaking: boolean; stageRevision: number }, studentId: string, claim: (d: Prisma.ExamAttemptUncheckedUpdateInput) => Promise<void>) {
    const cands = await this.bank.candidates({ skill: 'WRITING', ieltsTypes: ['WRITING_TASK2'] }, true);
    const pick = selectCandidates(cands, { count: 1, seed: `sim|${e.id}` })[0];
    if (!pick) {
      // No Task 2 prompt is published. The skill is recorded as missing rather than estimated from nothing.
      return this.afterWritingSkipped(e, studentId, claim);
    }
    const w = await this.writing.create(studentId, { taskType: 'TASK2', questionId: pick });
    await claim({ stage: 'WRITING', writingResponseId: w.id, stageDeadlineAt: new Date(Date.now() + WRITING_MINUTES * 60_000) });
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
  private async finish(e: { id: string; listeningAttemptId: string | null; readingAttemptId: string | null; writingResponseId: string | null; speakingAttemptId: string | null; missingSkills: string[]; stageRevision: number }, claim: (d: Prisma.ExamAttemptUncheckedUpdateInput) => Promise<void>, studentId: string) {
    const [listening, reading] = await Promise.all([
      e.listeningAttemptId ? this.prisma.assessmentAttempt.findUnique({ where: { id: e.listeningAttemptId }, select: { bandScore: true } }) : null,
      e.readingAttemptId ? this.prisma.assessmentAttempt.findUnique({ where: { id: e.readingAttemptId }, select: { bandScore: true } }) : null,
    ]);
    const writingEval = e.writingResponseId
      ? await this.prisma.writingEvaluation.findFirst({ where: { responseId: e.writingResponseId }, orderBy: { createdAt: 'desc' }, select: { estimatedBand: true } })
      : null;
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

  @Get('available') available(@CurrentUser() u: AuthUser) { sid(u); return this.sim.available(); }
  @Get('exams') list(@CurrentUser() u: AuthUser) { return this.sim.list(sid(u)); }

  @HttpCode(201) @Post('exams')
  start(@Body(new ZodPipe(simulatorStartSchema)) body: SimulatorStartInput, @CurrentUser() u: AuthUser) { return this.sim.start(sid(u), body); }

  @Get('exams/:id') get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.sim.get(sid(u), id); }

  @HttpCode(200) @Post('exams/:id/advance')
  advance(@Param('id', uuid) id: string, @Body(new ZodPipe(simulatorAdvanceSchema)) body: { expectedRevision: number }, @CurrentUser() u: AuthUser) {
    return this.sim.advance(sid(u), id, body.expectedRevision);
  }
}

@Module({
  imports: [AssessmentsModule, QuestionBankModule, WritingModule, SpeakingModule],
  controllers: [SimulatorController],
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}


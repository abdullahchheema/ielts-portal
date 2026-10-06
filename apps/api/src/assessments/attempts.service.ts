import { BandService } from '../analytics/band.service';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import type { SaveAnswersInput } from '@ielts/validation';
import { AppError, notFound } from '../common/app-error';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { LearningService } from '../learning/learning.service';
import { StorageService } from '../integrations/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { BandRow, GradableQuestion, QuestionType, bandFromRaw, gradeAttempt, sanitizeAnswer } from './grading';

type Tx = Prisma.TransactionClient;
/** Time after the deadline during which a late autosave/submit is still accepted (network latency, clock skew). */
const GRACE_MS = 15_000;
const BAND_ASSESSMENT_TYPES = ['LISTENING', 'READING', 'MOCK', 'DIAGNOSTIC', 'FINAL'];

interface FlatQuestion extends GradableQuestion {
  id: string; // question_version id — what answers are keyed by
  sectionId: string;
  prompt: unknown;
  options: { id: string; label: string; isCorrect: boolean }[];
}

interface Finished {
  attemptId: string; studentId: string; enrollmentId: string | null; itemId: string | null;
  assessmentTitle: string; percent: number; band: number | null; passed: boolean;
}

@Injectable()
export class AttemptsService implements OnModuleInit {
  private readonly logger = new Logger(AttemptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly learning: LearningService,
    private readonly bands: BandService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit() {
    this.scheduler.register('attempts.sweep', 60_000, () => this.sweepExpired());
  }

  // ───────── loading ─────────
  private async questions(versionId: string): Promise<{ sections: { id: string; title: string; content: unknown }[]; questions: FlatQuestion[] }> {
    const sections = await this.prisma.assessmentSection.findMany({
      where: { assessmentVersionId: versionId }, orderBy: [{ sequence: 'asc' }, { title: 'asc' }],
      include: { questions: { where: { deletedAt: null }, orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }], include: { versions: { include: { options: { orderBy: { sequence: 'asc' } } } } } } },
    });
    const questions: FlatQuestion[] = sections.flatMap((s) => s.questions.map((q) => {
      const qv = q.versions[0];
      return {
        id: qv.id, sectionId: s.id, type: q.questionType as QuestionType, marks: Number(qv.marks), prompt: qv.prompt,
        answerKey: qv.answerKey as FlatQuestion['answerKey'], options: qv.options.map((o) => ({ id: o.id, label: o.label, isCorrect: o.isCorrect })),
      };
    }));
    return { sections: sections.map((s) => ({ id: s.id, title: s.title, content: s.content })), questions };
  }

  /** What the student may see: never answer keys or which options are correct. */
  private async paper(versionId: string) {
    const { sections, questions } = await this.questions(versionId);
    return Promise.all(sections.map(async (s) => {
      const c = (s.content ?? {}) as { passage?: string; instructions?: string; audioKey?: string };
      return {
        id: s.id, title: s.title,
        content: { passage: c.passage, instructions: c.instructions, audioUrl: c.audioKey ? await this.storage.signedUrl(c.audioKey, 3600) : undefined },
        questions: questions.filter((q) => q.sectionId === s.id).map((q) => ({
          id: q.id, type: q.type, prompt: q.prompt, marks: q.marks,
          options: q.options.length ? q.options.map((o) => ({ id: o.id, label: o.label })) : undefined,
        })),
      };
    }));
  }

  // ───────── start ─────────
  /** Which enrollment/content item unlocks this assessment for the student (or throws the reason it is closed). */
  private async resolveAccess(studentId: string, assessment: { id: string; type: string; origin?: string; generatedForStudentId?: string | null }) {
    // A personal practice paper belongs to one student and is not tied to a course item.
    if (assessment.origin === 'ADAPTIVE') {
      if (assessment.generatedForStudentId !== studentId) throw new AppError('ASSESSMENT_NOT_AVAILABLE', 404, 'This assessment is not available.');
      return { enrollmentId: null, itemId: null };
    }
    const items = await this.prisma.contentItem.findMany({
      where: { status: 'PUBLISHED', metadataJson: { path: ['assessmentId'], equals: assessment.id } },
      select: { id: true },
    });
    if (items.length === 0) {
      if (assessment.type === 'DIAGNOSTIC') return { enrollmentId: null, itemId: null };
      throw new AppError('ASSESSMENT_NOT_AVAILABLE', 404, 'This assessment is not available.');
    }
    let last: unknown;
    for (const item of items) {
      try {
        const { enrollment } = await this.learning.assertItemAccess(studentId, item.id);
        return { enrollmentId: enrollment.id, itemId: item.id };
      } catch (e) { last = e; }
    }
    throw last;
  }

  async start(user: { studentId: string }, assessmentId: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { versions: { where: { publishedAt: { not: null } }, orderBy: { version: 'desc' }, take: 1 } },
    });
    const version = assessment?.versions[0];
    if (!assessment || !version) throw new AppError('ASSESSMENT_NOT_AVAILABLE', 404, 'This assessment is not available.');
    const access = await this.resolveAccess(user.studentId, assessment);

    let lapsed = null as Finished | null;
    const started = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM student_profiles WHERE id = ${user.studentId}::uuid FOR UPDATE`; // serialise this student's starts
      const open = await tx.assessmentAttempt.findFirst({ where: { assessmentId, studentId: user.studentId, status: 'IN_PROGRESS' } });
      if (open) {
        if (!this.isPastDeadline(open.expiresAt)) return open.id; // resume — double-click / second tab gets the same attempt
        lapsed = await this.finish(tx, open.id);
      }
      const attempts = await tx.assessmentAttempt.findMany({ where: { assessmentId, studentId: user.studentId, status: { not: 'INVALIDATED' } }, select: { attemptNumber: true } });
      // Not thrown here: that would roll back the auto-submit of a lapsed attempt done above.
      if (assessment.maxAttempts && attempts.length >= assessment.maxAttempts) return { limitReached: assessment.maxAttempts };
      const now = new Date();
      const created = await tx.assessmentAttempt.create({
        data: {
          assessmentId, assessmentVersionId: version.id, studentId: user.studentId, enrollmentId: access.enrollmentId,
          attemptNumber: Math.max(0, ...attempts.map((a) => a.attemptNumber)) + 1, status: 'IN_PROGRESS', startedAt: now,
          expiresAt: assessment.timeLimitMin ? new Date(now.getTime() + assessment.timeLimitMin * 60_000) : null,
        },
      });
      return created.id;
    });
    if (lapsed) await this.afterFinish(lapsed);
    if (typeof started !== 'string') throw new AppError('ATTEMPT_LIMIT_REACHED', 409, `You have used all ${started.limitReached} attempt(s) for this assessment.`);
    return this.getAttempt(user, started);
  }

  private isPastDeadline(expiresAt: Date | null, now = Date.now()) {
    return !!expiresAt && now > expiresAt.getTime() + GRACE_MS;
  }

  // ───────── read ─────────
  async getAttempt(user: { studentId: string }, attemptId: string) {
    let attempt = await this.prisma.assessmentAttempt.findFirst({ where: { id: attemptId, studentId: user.studentId }, include: { assessment: true } });
    if (!attempt) throw notFound('Attempt');

    if (attempt.status === 'IN_PROGRESS' && this.isPastDeadline(attempt.expiresAt)) {
      const done = await this.prisma.$transaction((tx) => this.finish(tx, attemptId));
      if (done) await this.afterFinish(done);
      attempt = await this.prisma.assessmentAttempt.findFirstOrThrow({ where: { id: attemptId }, include: { assessment: true } });
    }

    if (attempt.status !== 'IN_PROGRESS') return { attempt: this.summary(attempt), result: await this.result(user, attemptId) };

    const [paper, rows] = await Promise.all([
      this.paper(attempt.assessmentVersionId),
      this.prisma.attemptAnswer.findMany({ where: { attemptId } }),
    ]);
    return {
      attempt: this.summary(attempt),
      assessment: { id: attempt.assessment.id, title: attempt.assessment.title, type: attempt.assessment.type, timeLimitMin: attempt.assessment.timeLimitMin },
      paper,
      answers: Object.fromEntries(rows.map((r) => [r.questionVersionId, r.answer])),
    };
  }

  private summary(a: { id: string; status: string; revision: number; attemptNumber: number; startedAt: Date | null; expiresAt: Date | null; submittedAt: Date | null }) {
    return {
      id: a.id, status: a.status, revision: a.revision, attemptNumber: a.attemptNumber, startedAt: a.startedAt, submittedAt: a.submittedAt, expiresAt: a.expiresAt,
      remainingSeconds: a.expiresAt && a.status === 'IN_PROGRESS' ? Math.max(0, Math.floor((a.expiresAt.getTime() - Date.now()) / 1000)) : null,
    };
  }

  // ───────── autosave ─────────
  /**
   * Optimistic concurrency: the client sends the revision it last saw. If another tab/device saved in between,
   * the server rejects with ANSWER_SAVE_CONFLICT + the current answers so nothing is silently overwritten.
   */
  async saveAnswers(user: { studentId: string }, attemptId: string, input: SaveAnswersInput) {
    let lapsed = null as Finished | null;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
      const attempt = await tx.assessmentAttempt.findFirst({ where: { id: attemptId, studentId: user.studentId } });
      if (!attempt) throw notFound('Attempt');
      if (attempt.status !== 'IN_PROGRESS') throw new AppError('ATTEMPT_ALREADY_SUBMITTED', 409, 'This attempt has already been submitted.');

      if (this.isPastDeadline(attempt.expiresAt)) {
        lapsed = await this.finish(tx, attemptId); // grade what was saved; the late write is refused
        return { expired: true as const };
      }
      if (input.revision !== attempt.revision) {
        const rows = await tx.attemptAnswer.findMany({ where: { attemptId } });
        throw new AppError('ANSWER_SAVE_CONFLICT', 409, 'Your answers were changed elsewhere. Reload to see the latest.', {
          revision: attempt.revision, answers: Object.fromEntries(rows.map((r) => [r.questionVersionId, r.answer])),
        });
      }

      const { questions } = await this.questions(attempt.assessmentVersionId);
      const byId = new Map(questions.map((q) => [q.id, q]));
      const seen = new Set<string>();
      const nextRevision = attempt.revision + 1;
      for (const a of input.answers) {
        const q = byId.get(a.questionVersionId);
        if (!q) throw new AppError('QUESTION_VERSION_INVALID', 422, 'One of the answers does not belong to this test.', { questionVersionId: a.questionVersionId });
        if (seen.has(a.questionVersionId)) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { [a.questionVersionId]: 'Duplicate answer.' });
        seen.add(a.questionVersionId);
        if (a.answer === null) { // clearing an answer
          await tx.attemptAnswer.deleteMany({ where: { attemptId, questionVersionId: q.id } });
          continue;
        }
        const clean = sanitizeAnswer(q, a.answer);
        if (!clean) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { [q.id]: 'Invalid answer for this question type.' });
        await tx.attemptAnswer.upsert({
          where: { attemptId_questionVersionId: { attemptId, questionVersionId: q.id } },
          create: { attemptId, questionVersionId: q.id, answer: clean as Prisma.InputJsonValue, revision: nextRevision },
          update: { answer: clean as Prisma.InputJsonValue, revision: nextRevision },
        });
      }
      await tx.assessmentAttempt.update({ where: { id: attemptId }, data: { revision: nextRevision } });
      return { expired: false as const, revision: nextRevision };
    });

    if (lapsed) await this.afterFinish(lapsed);
    if (result.expired) throw new AppError('ATTEMPT_EXPIRED', 409, 'Time is up. Your saved answers were submitted.');
    return { revision: result.revision };
  }

  // ───────── submit ─────────
  /** Idempotent: submitting twice (double-click, retry) returns the same result and grades once. */
  async submit(user: { studentId: string }, attemptId: string) {
    let done = null as Finished | null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
      const attempt = await tx.assessmentAttempt.findFirst({ where: { id: attemptId, studentId: user.studentId } });
      if (!attempt) throw notFound('Attempt');
      if (attempt.status === 'IN_PROGRESS') done = await this.finish(tx, attemptId);
    });
    if (done) await this.afterFinish(done);
    return this.result(user, attemptId);
  }

  /** Grades and closes an attempt. Caller must hold the row lock and be inside a transaction. */
  private async finish(tx: Tx, attemptId: string): Promise<Finished | null> {
    await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id = ${attemptId}::uuid FOR UPDATE`; // re-entrant; guarantees one grader
    const attempt = await tx.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { assessment: true, student: { select: { academicOrGeneral: true } } } });
    if (attempt.status !== 'IN_PROGRESS') return null;

    const { questions } = await this.questions(attempt.assessmentVersionId);
    const rows = await tx.attemptAnswer.findMany({ where: { attemptId } });
    const answerOf = new Map(rows.map((r) => [r.questionVersionId, r.answer]));
    const graded = gradeAttempt(questions, questions.map((q) => answerOf.get(q.id)));

    const correctIds = questions.filter((_, i) => graded.perQuestion[i].correct).map((q) => q.id);
    const wrongIds = questions.filter((_, i) => !graded.perQuestion[i].correct && answerOf.has(questions[i].id)).map((q) => q.id);
    if (correctIds.length) await tx.attemptAnswer.updateMany({ where: { attemptId, questionVersionId: { in: correctIds } }, data: { isCorrect: true } });
    if (wrongIds.length) await tx.attemptAnswer.updateMany({ where: { attemptId, questionVersionId: { in: wrongIds } }, data: { isCorrect: false } });

    const band = await this.lookupBand(tx, attempt.assessment, attempt.student.academicOrGeneral, graded.raw, graded.max);
    // Status is flipped AFTER answers are graded; the DB trigger freezes answers once status leaves IN_PROGRESS.
    await tx.assessmentAttempt.update({
      where: { id: attemptId },
      data: { status: 'AUTO_GRADED', submittedAt: new Date(), rawScore: graded.raw, maxScore: graded.max, percent: graded.percent, bandScore: band },
    });

    const link = attempt.enrollmentId
      ? await tx.contentItem.findFirst({ where: { metadataJson: { path: ['assessmentId'], equals: attempt.assessmentId }, section: { courseVersionId: (await tx.enrollment.findUniqueOrThrow({ where: { id: attempt.enrollmentId } })).courseVersionId } }, select: { id: true } })
      : null;
    return {
      attemptId, studentId: attempt.studentId, enrollmentId: attempt.enrollmentId, itemId: link?.id ?? null,
      assessmentTitle: attempt.assessment.title, percent: graded.percent, band, passed: graded.percent >= attempt.assessment.passPercent,
    };
  }

  private async lookupBand(tx: Tx, a: { skill: string | null; type: string }, academicOrGeneral: string | null, raw: number, max: number): Promise<number | null> {
    if (!a.skill || !BAND_ASSESSMENT_TYPES.includes(a.type)) return null;
    const testType = a.skill === 'LISTENING' ? 'LISTENING' : a.skill === 'READING' ? (academicOrGeneral === 'GENERAL' ? 'READING_GENERAL' : 'READING_ACADEMIC') : null;
    if (!testType) return null;
    const latest = await tx.bandConversionTable.aggregate({ where: { testType, effectiveDate: { lte: new Date() } }, _max: { version: true } });
    if (!latest._max.version) return null;
    const rows = await tx.bandConversionTable.findMany({ where: { testType, version: latest._max.version } });
    return bandFromRaw(rows.map((r): BandRow => ({ rawMin: r.rawMin, rawMax: r.rawMax, band: Number(r.band) })), raw, max);
  }

  /** Side effects that must not roll back the grading: course progress + student timeline. */
  private async afterFinish(f: Finished) {
    try {
      if (f.enrollmentId && f.itemId && f.passed) await this.learning.markCompletedBySystem(f.studentId, f.enrollmentId, f.itemId);
      await this.prisma.studentTimelineEvent.create({
        data: { studentId: f.studentId, type: 'ASSESSMENT_COMPLETED', summary: `Completed “${f.assessmentTitle}”: ${Math.round(f.percent)}%${f.band !== null ? ` (Band ${f.band.toFixed(1)})` : ''}`, meta: { attemptId: f.attemptId } },
      });
    } catch (e) {
      this.logger.warn(`afterFinish failed for attempt ${f.attemptId}: ${(e as Error).message}`);
    }
  }

  // ───────── results ─────────
  async result(user: { studentId: string }, attemptId: string) {
    const attempt = await this.prisma.assessmentAttempt.findFirst({ where: { id: attemptId, studentId: user.studentId }, include: { assessment: true, answers: true } });
    if (!attempt) throw notFound('Attempt');
    if (attempt.status === 'IN_PROGRESS') throw new AppError('SUBMISSION_INCOMPLETE', 409, 'This attempt has not been submitted yet.');

    const a = attempt.assessment;
    const base = {
      attemptId, attemptNumber: attempt.attemptNumber, status: attempt.status, submittedAt: attempt.submittedAt,
      assessment: { id: a.id, title: a.title, type: a.type, skill: a.skill, passPercent: a.passPercent },
      score: {
        raw: attempt.rawScore === null ? null : Number(attempt.rawScore), max: attempt.maxScore === null ? null : Number(attempt.maxScore),
        percent: attempt.percent === null ? null : Number(attempt.percent), band: attempt.bandScore === null ? null : Number(attempt.bandScore),
        passed: attempt.percent !== null ? Number(attempt.percent) >= a.passPercent : null,
      },
    };
    if (!a.showAnswers) return { ...base, review: null };

    const { sections, questions } = await this.questions(attempt.assessmentVersionId);
    const answerOf = new Map(attempt.answers.map((r) => [r.questionVersionId, r]));
    return {
      ...base,
      review: sections.map((s) => ({
        id: s.id, title: s.title,
        questions: questions.filter((q) => q.sectionId === s.id).map((q) => {
          const ans = answerOf.get(q.id);
          return {
            id: q.id, type: q.type, prompt: q.prompt, marks: q.marks, options: q.options.map((o) => ({ id: o.id, label: o.label })),
            yourAnswer: ans?.answer ?? null, correct: ans?.isCorrect ?? false,
            correctAnswer: q.options.length ? { optionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id) } : q.answerKey,
          };
        }),
      })),
    };
  }

  /** Published diagnostic tests any student may take, with their own attempt summary. */
  async diagnostics(studentId: string) {
    const list = await this.prisma.assessment.findMany({
      where: { type: 'DIAGNOSTIC', versions: { some: { publishedAt: { not: null } } } }, orderBy: { title: 'asc' },
      select: { id: true, title: true, skill: true, timeLimitMin: true, maxAttempts: true },
    });
    return Promise.all(list.map(async (d) => {
      const attempts = await this.prisma.assessmentAttempt.findMany({ where: { assessmentId: d.id, studentId, status: { not: 'INVALIDATED' } }, orderBy: { attemptNumber: 'desc' }, select: { id: true, status: true, bandScore: true, percent: true } });
      const done = attempts.filter((x) => x.status !== 'IN_PROGRESS');
      return { ...d, attemptsUsed: attempts.length, inProgressAttemptId: attempts.find((x) => x.status === 'IN_PROGRESS')?.id ?? null, latestAttemptId: done[0]?.id ?? null, latestBand: done[0]?.bandScore === null || !done[0] ? null : Number(done[0].bandScore) };
    }));
  }

  async history(studentId: string) {
    const rows = await this.prisma.assessmentAttempt.findMany({
      where: { studentId, status: { notIn: ['IN_PROGRESS', 'NOT_STARTED', 'INVALIDATED'] } },
      orderBy: { submittedAt: 'desc' }, take: 100,
      include: { assessment: { select: { id: true, title: true, type: true, skill: true } } },
    });
    return rows.map((r) => ({
      attemptId: r.id, attemptNumber: r.attemptNumber, submittedAt: r.submittedAt, status: r.status, assessment: r.assessment,
      percent: r.percent === null ? null : Number(r.percent), band: r.bandScore === null ? null : Number(r.bandScore),
    }));
  }

  /** Per-skill band history (never overwritten) with latest and best. Writing/speaking join this in the grading pass. */
  /** Per-skill band history. The estimate itself lives in BandService so every screen agrees. */
  async skillProgress(studentId: string) {
    const est = await this.bands.forStudent(studentId);
    return est.skills;
  }

  // ───────── sweeper ─────────
  async sweepExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - GRACE_MS);
    const stale = await this.prisma.assessmentAttempt.findMany({ where: { status: 'IN_PROGRESS', expiresAt: { lt: cutoff } }, select: { id: true }, take: 100 });
    let n = 0;
    for (const s of stale) {
      const done = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id = ${s.id}::uuid FOR UPDATE`;
        return this.finish(tx, s.id);
      });
      if (done) { await this.afterFinish(done); n++; }
    }
    if (n) this.logger.log(`Auto-submitted ${n} timed-out attempt(s).`);
    return n;
  }
}

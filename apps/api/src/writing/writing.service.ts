import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { CreateWritingInput, SaveWritingInput, MAX_ESSAY_CHARS } from '@ielts/validation';
import { AiService } from '../ai/ai.service';
import { AppError, conflict, notFound } from '../common/app-error';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { MIN_WORDS, textStats, wordCount } from './text-stats';
import { mockWritingEvaluation, writingEvaluationSchema, WritingEvaluation } from './writing.schemas';

export const WRITING_INSTRUCTIONS = [
  'You help IELTS learners understand their writing. You are not an examiner and your numbers are estimates.',
  'Estimate band scores from 0 to 9 in half bands for TASK_RESPONSE, COHERENCE, LEXICAL and GRAMMAR, using the public IELTS band descriptors.',
  'Quote short excerpts exactly as written. Do not invent errors that are not in the text.',
  'Return one JSON object with keys: estimatedBand (number), criteria (array of 4 objects with key, score, comment), feedback (object with strengths, taskIssues, coherenceIssues, vocabularyIssues [{excerpt, suggestion}], grammarIssues [{excerpt, correction, explanation}], sentenceCorrections [{original, corrected}], suggestions).',
  'Keep every list short and specific. Do not state that the result is an official IELTS score.',
].join(' ');

const EDITABLE = 'DRAFT';

@Injectable()
export class WritingService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiService, private readonly jobs: JobsService) {}

  onModuleInit() {
    this.jobs.handle('writing.evaluate', async (payload) => {
      const { responseId, revision } = payload as { responseId: string; revision: number };
      await this.evaluateResponse(responseId, revision);
    });
    this.jobs.handle('writing.evaluate.submission', async (payload) => {
      const { submissionId } = payload as { submissionId: string };
      await this.evaluateSubmission(submissionId);
    });
  }

  // ───────── student practice ─────────
  async create(studentId: string, input: CreateWritingInput) {
    let promptText = input.promptText ?? '';
    let questionId: string | null = null;
    if (input.questionId) {
      const q = await this.prisma.question.findFirst({
        where: {
          id: input.questionId, deletedAt: null, ieltsType: { in: ['WRITING_TASK1', 'WRITING_TASK2'] },
          questionSet: { status: 'PUBLISHED', studentFacing: true },
        },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!q || !q.versions[0]) throw notFound('Writing task');
      promptText = (q.versions[0].prompt as { text: string }).text;
      questionId = q.id;
    }
    const r = await this.prisma.writingResponse.create({
      data: { studentId, questionId, taskType: input.taskType, promptText },
      select: { id: true, taskType: true, promptText: true },
    });
    return r;
  }

  /** Autosave. Refused unless the caller's revision is current, so two open tabs cannot overwrite each other. */
  async save(studentId: string, id: string, input: SaveWritingInput) {
    if (input.body.length > MAX_ESSAY_CHARS) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { body: 'This essay is too long.' });
    const words = wordCount(input.body);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.writingResponse.findFirst({ where: { id, studentId }, select: { id: true, status: true, revision: true } });
      if (!current) throw notFound('Writing');
      if (current.status !== EDITABLE) throw conflict('CONFLICT', 'This essay has been submitted and can no longer be edited.');
      const next = current.revision + 1;
      const claimed = await tx.writingResponse.updateMany({
        where: { id, studentId, status: EDITABLE, revision: input.revision },
        data: { body: input.body, wordCount: words, revision: next },
      });
      if (claimed.count === 0) {
        const latest = await tx.writingResponse.findUniqueOrThrow({ where: { id }, select: { revision: true, body: true } });
        throw new AppError('ANSWER_SAVE_CONFLICT', 409, 'This essay changed in another tab. Your latest text is shown.', { revision: latest.revision, body: latest.body });
      }
      await tx.writingRevision.create({ data: { responseId: id, revision: next, body: input.body, wordCount: words } });
      return { revision: next, wordCount: words };
    });
  }

  /** Locks the essay and queues an AI evaluation. The student sees the result when it is ready. */
  async submit(studentId: string, id: string) {
    const r = await this.prisma.writingResponse.findFirst({ where: { id, studentId }, select: { id: true, status: true, revision: true, body: true } });
    if (!r) throw notFound('Writing');
    if (r.status === 'EVALUATED' || r.status === 'SUBMITTED') return { status: r.status };
    if (wordCount(r.body) < 20) throw new AppError('VALIDATION_ERROR', 422, 'Write at least a short paragraph before submitting.');
    const claimed = await this.prisma.writingResponse.updateMany({ where: { id, studentId, status: EDITABLE }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    if (claimed.count === 0) return { status: 'SUBMITTED' };
    const jobId = await this.jobs.enqueue('writing.evaluate', `writing:${id}:${r.revision}`, { responseId: id, revision: r.revision });
    if (jobId) await this.jobs.runById(jobId).catch(() => false);
    return { status: 'SUBMITTED' };
  }

  async get(studentId: string, id: string) {
    const r = await this.prisma.writingResponse.findFirst({
      where: { id, studentId },
      select: {
        id: true, taskType: true, promptText: true, body: true, wordCount: true, status: true, revision: true, submittedAt: true, createdAt: true,
        evaluations: { orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, revision: true, estimatedBand: true, criteria: true, feedback: true, stats: true, model: true, createdAt: true } },
      },
    });
    if (!r) throw notFound('Writing');
    const latest = r.evaluations[0] ?? null;
    return {
      ...r,
      latestEvaluation: latest,
      stats: textStats(r.body),
      minWords: MIN_WORDS[r.taskType as 'TASK1' | 'TASK2'],
      history: r.evaluations.map((e) => ({ id: e.id, revision: e.revision, estimatedBand: e.estimatedBand, createdAt: e.createdAt })),
    };
  }

  async list(studentId: string) {
    const rows = await this.prisma.writingResponse.findMany({
      where: { studentId, status: { not: 'DRAFT' } }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, taskType: true, promptText: true, wordCount: true, status: true, submittedAt: true, evaluations: { orderBy: { createdAt: 'desc' }, take: 1, select: { estimatedBand: true } } },
    });
    return rows.map(({ evaluations, ...r }) => ({ ...r, estimatedBand: evaluations[0]?.estimatedBand ?? null }));
  }

  // ───────── background evaluation ─────────
  /** Runs as a job. An AI outage leaves the response SUBMITTED and the job retries, so no work is lost. */
  async evaluateResponse(responseId: string, revision: number) {
    const r = await this.prisma.writingResponse.findUnique({ where: { id: responseId }, select: { studentId: true, taskType: true, promptText: true, body: true, revision: true, status: true } });
    if (!r || r.revision !== revision || r.status !== 'SUBMITTED') return;
    const { data, model, provider } = await this.estimate(r.studentId, r.taskType, r.promptText, r.body);
    await this.prisma.$transaction(async (tx) => {
      await tx.writingEvaluation.create({ data: this.evaluationRow({ responseId, revision, provider, model, data, body: r.body }) });
      await tx.writingResponse.update({ where: { id: responseId }, data: { status: 'EVALUATED' } });
    });
  }

  /**
   * Assignment essays from teacher-run courses also get AI analysis, stored beside the teacher's grade. The
   * grade itself is never touched; the analysis is supporting evidence only.
   */
  async evaluateSubmission(submissionId: string) {
    const s = await this.prisma.submission.findUnique({ where: { id: submissionId }, select: { studentId: true, body: true, revision: true, assignment: { select: { instructions: true, contentItem: { select: { title: true } } } } } });
    if (!s || !s.body) return;
    const taskPrompt = s.assignment.instructions ?? s.assignment.contentItem.title;
    const { data, model, provider } = await this.estimate(s.studentId, 'TASK2', taskPrompt, s.body);
    await this.prisma.writingEvaluation.create({ data: this.evaluationRow({ submissionId, revision: s.revision, provider, model, data, body: s.body }) });
  }

  /** Enqueues the teacher-assignment analysis after a submission. Never blocks or changes the submission. */
  async queueSubmissionAnalysis(submissionId: string, revision: number) {
    await this.jobs.enqueue('writing.evaluate.submission', `submission-ai:${submissionId}:${revision}`, { submissionId });
  }

  private async estimate(userId: string, taskType: string, prompt: string, body: string) {
    const stats = textStats(body);
    const user = [
      `Task type: ${taskType === 'TASK1' ? 'Task 1' : 'Task 2'}`,
      this.ai.wrapForPrompt('TASK PROMPT', prompt),
      this.ai.wrapForPrompt('ESSAY', body),
      `Measured facts (for context only): ${stats.words} words, ${stats.paragraphs} paragraphs, ${stats.sentences} sentences.`,
    ].join('\n\n');
    const out = await this.ai.json<WritingEvaluation>({
      feature: 'writing.evaluate',
      userId,
      system: this.ai.systemPrompt('writing.evaluate', WRITING_INSTRUCTIONS),
      user,
      schema: writingEvaluationSchema,
      mock: () => mockWritingEvaluation(stats.words, stats.typeTokenRatio),
      maxTokens: 1800,
    });
    return { data: out.data, model: out.model, provider: out.provider };
  }

  private evaluationRow(o: {
    responseId?: string; submissionId?: string; revision: number; provider: string; model: string; data: WritingEvaluation; body: string;
  }): Prisma.WritingEvaluationUncheckedCreateInput {
    return {
      responseId: o.responseId ?? null,
      submissionId: o.submissionId ?? null,
      revision: o.revision,
      provider: o.provider,
      model: o.model,
      promptVersion: this.ai.promptVersion('writing.evaluate'),
      estimatedBand: new Prisma.Decimal(o.data.estimatedBand),
      criteria: o.data.criteria as unknown as Prisma.InputJsonValue,
      feedback: o.data.feedback as unknown as Prisma.InputJsonValue,
      stats: textStats(o.body) as unknown as Prisma.InputJsonValue,
    };
  }
}

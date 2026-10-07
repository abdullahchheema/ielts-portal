import { EventEmitter2 } from '@nestjs/event-emitter';
import { STUDY_EVIDENCE, StudyEvidence } from '../study-plan/evidence';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { AddSpeakingResponseInput, AUDIO_MIME_TYPES, CreateSpeakingAttemptInput, MAX_SPEAKING_BYTES, PresignSpeakingInput } from '@ielts/validation';
import { AiService } from '../ai/ai.service';
import { AppError, conflict, notFound } from '../common/app-error';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionBankService } from '../question-bank/question-bank.service';
import { sniffFileType, sha256Hex, StorageService } from '../integrations/storage.service';
import { wordCount } from '../writing/text-stats';
import { mockSpeakingEvaluation, speakingEvaluationSchema, SpeakingEvaluation } from './speaking.schemas';
import { fluencyOf, profileOf } from './fluency';

const SPEAKING_INSTRUCTIONS = [
  'You help IELTS learners with speaking practice. You are not an examiner and your numbers are estimates.',
  'You are given a transcript of one answer. Estimate band scores from 0 to 9 in half bands for FLUENCY, LEXICAL, GRAMMAR, using the public IELTS band descriptors.',
  'Set PRONUNCIATION score to null: pronunciation cannot be judged from a text transcript. Say so in pronunciationNote.',
  'Quote short corrections exactly. Do not invent errors that are not in the transcript.',
  'Return one JSON object with keys: estimatedBand, criteria (array of 4 objects with key, score, comment), feedback (strengths, weaknesses, corrections [{original, corrected}], recommendedPractice, pronunciationNote).',
].join(' ');

const ALLOWED = new Set<string>(AUDIO_MIME_TYPES);

@Injectable()
export class SpeakingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
    private readonly jobs: JobsService,
    private readonly bank: QuestionBankService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.jobs.handle('speaking.transcribe', async (payload) => this.transcribe((payload as { responseId: string }).responseId));
    this.jobs.handle('speaking.evaluate', async (payload) => this.evaluate((payload as { responseId: string }).responseId));
  }

  // ───────── attempts and prompts ─────────
  async createAttempt(studentId: string, input: CreateSpeakingAttemptInput) {
    return this.prisma.speakingAttempt.create({ data: { studentId, mode: input.mode }, select: { id: true, mode: true, status: true } });
  }

  async getAttempt(studentId: string, id: string) {
    const a = await this.prisma.speakingAttempt.findFirst({
      where: { id, studentId },
      select: {
        id: true, mode: true, status: true, createdAt: true,
        responses: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, part: true, promptText: true, status: true, transcriptStatus: true, durationSec: true, createdAt: true, evaluations: { orderBy: { createdAt: 'desc' }, take: 1, select: { estimatedBand: true } } },
        },
      },
    });
    if (!a) throw notFound('Speaking attempt');
    return { ...a, responses: a.responses.map(({ evaluations, ...r }) => ({ ...r, estimatedBand: evaluations[0]?.estimatedBand ?? null })) };
  }

  /** Questions students may answer: published, student-facing speaking prompts for one part. */
  async questions(part: 'PART1' | 'PART2' | 'PART3', take = 20) {
    const cands = await this.bank.candidates({ skill: 'SPEAKING', ieltsTypes: [`SPEAKING_${part}`] }, true);
    const ids = cands.slice(0, take).map((c) => c.id);
    if (ids.length === 0) return [];
    const rows = await this.prisma.question.findMany({ where: { id: { in: ids } }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    return rows.map((q) => ({ id: q.id, part, prompt: (q.versions[0]?.prompt as { text: string } | undefined)?.text ?? '' }));
  }

  async addResponse(studentId: string, attemptId: string, input: AddSpeakingResponseInput) {
    const a = await this.prisma.speakingAttempt.findFirst({ where: { id: attemptId, studentId }, select: { id: true, status: true } });
    if (!a) throw notFound('Speaking attempt');
    if (a.status !== 'IN_PROGRESS') throw conflict('CONFLICT', 'This speaking attempt is complete.');
    let promptText = input.promptText ?? '';
    let questionId: string | null = null;
    if (input.questionId) {
      const q = await this.prisma.question.findFirst({
        where: { id: input.questionId, deletedAt: null, ieltsType: `SPEAKING_${input.part}`, questionSet: { status: 'PUBLISHED', studentFacing: true } },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!q) throw notFound('Speaking question');
      promptText = (q.versions[0]?.prompt as { text: string }).text;
      questionId = q.id;
    }
    const r = await this.prisma.speakingResponse.create({
      data: { attemptId, studentId, part: input.part, promptText, questionId },
      select: { id: true, part: true, promptText: true, status: true },
    });
    return r;
  }

  // ───────── upload ─────────
  /** Direct browser upload to private storage when S3 is configured; otherwise the multipart route is used. */
  async presign(studentId: string, id: string, input: PresignSpeakingInput) {
    const r = await this.ownedResponse(studentId, id);
    if (r.status !== 'UPLOADING') throw conflict('CONFLICT', 'This answer already has audio.');
    const key = `speaking/${studentId}/${id}`;
    const put = await this.storage.presignPut(key, input.mime);
    await this.prisma.speakingResponse.update({ where: { id }, data: { storageKey: key, mime: input.mime, sizeBytes: BigInt(input.sizeBytes) } });
    if (!put) return { mode: 'multipart' as const, url: `/api/speaking/responses/${id}/audio` };
    return { mode: 'direct' as const, url: put.url, headers: put.headers };
  }

  /** Local-fallback upload. Content is sniffed; the declared type is never trusted. */
  async uploadLocal(studentId: string, id: string, file: { buffer: Buffer; size: number }) {
    const r = await this.ownedResponse(studentId, id);
    if (r.status !== 'UPLOADING') throw conflict('CONFLICT', 'This answer already has audio.');
    if (file.size > MAX_SPEAKING_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The recording is larger than 25 MB.');
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed || !ALLOWED.has(sniffed.mime)) throw new AppError('UNSUPPORTED_FILE_TYPE', 422, 'Upload a recording in WebM, OGG, MP4, MP3 or WAV format.');
    const key = `speaking/${studentId}/${id}`;
    await this.storage.put(key, file.buffer, sniffed.mime);
    await this.prisma.speakingResponse.update({
      where: { id },
      data: { storageKey: key, mime: sniffed.mime, sizeBytes: BigInt(file.size), sha256: sha256Hex(file.buffer), status: 'UPLOADED' },
    });
    await this.queueTranscription(id);
    return { status: 'UPLOADED' };
  }

  /** After a direct upload: check the object really exists, is within the size limit, and is audio. */
  async complete(studentId: string, id: string, durationSec?: number) {
    const r = await this.ownedResponse(studentId, id);
    if (r.status !== 'UPLOADING' || !r.storageKey) throw conflict('CONFLICT', 'Upload the recording first.');
    const meta = await this.storage.head(r.storageKey);
    if (!meta) throw new AppError('UPLOAD_FAILED', 422, 'The recording did not arrive. Please record again.');
    if (meta.size <= 0 || meta.size > MAX_SPEAKING_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The recording is larger than 25 MB.');
    const sniffed = sniffFileType(await this.storage.readHead(r.storageKey, 64));
    if (!sniffed || !ALLOWED.has(sniffed.mime)) {
      await this.storage.remove(r.storageKey);
      throw new AppError('UNSUPPORTED_FILE_TYPE', 422, 'That file is not an audio recording.');
    }
    await this.prisma.speakingResponse.update({
      where: { id },
      data: { mime: sniffed.mime, sizeBytes: BigInt(meta.size), durationSec: durationSec === undefined ? null : new Prisma.Decimal(durationSec), status: 'UPLOADED' },
    });
    await this.queueTranscription(id);
    const answered = await this.prisma.speakingResponse.findUnique({ where: { id }, select: { questionId: true } });
    if (answered?.questionId) this.events.emit(STUDY_EVIDENCE, { studentId, refType: 'SPEAKING_PART', refId: answered.questionId } satisfies StudyEvidence);
    return { status: 'UPLOADED' };
  }

  // ───────── background processing ─────────
  private async queueTranscription(id: string) {
    const jobId = await this.jobs.enqueue('speaking.transcribe', `speaking-transcribe:${id}`, { responseId: id });
    if (jobId) await this.jobs.runById(jobId).catch(() => false);
  }

  /** Transcribes the stored audio. Unavailable speech is recorded and the audio is kept; a failure is retried. */
  async transcribe(id: string) {
    const r = await this.prisma.speakingResponse.findUnique({ where: { id }, select: { studentId: true, storageKey: true, mime: true, sizeBytes: true, status: true, durationSec: true } });
    if (!r || !r.storageKey || !r.mime) return;
    if (r.status === 'EVALUATED') return;
    if (!this.ai.speechAvailable()) {
      await this.prisma.speakingResponse.update({ where: { id }, data: { transcriptStatus: 'UNAVAILABLE' } });
      return;
    }
    await this.prisma.speakingResponse.update({ where: { id }, data: { status: 'PROCESSING' } });
    try {
      const audio = await this.storage.getBuffer(r.storageKey);
      if (audio.length > MAX_SPEAKING_BYTES) throw new Error('recording too large');
      const result = await this.ai.transcribe(audio, r.mime, { feature: 'speaking.transcribe', userId: r.studentId });
      if (!result) throw new Error('transcription failed');
      await this.prisma.speakingResponse.update({
        where: { id },
        data: {
          transcript: result.text.slice(0, 20_000), transcriptStatus: 'DONE', status: 'UPLOADED', lastError: null,
          durationSec: r.durationSec ?? new Prisma.Decimal(result.durationSec || 0),
          metrics: { words: wordCount(result.text), durationSec: result.durationSec } as Prisma.InputJsonValue,
        },
      });
      const jobId = await this.jobs.enqueue('speaking.evaluate', `speaking-eval:${id}`, { responseId: id });
      if (jobId) await this.jobs.runById(jobId).catch(() => false);
    } catch (e) {
      await this.prisma.speakingResponse.update({ where: { id }, data: { status: 'PROCESSING_FAILED', transcriptStatus: 'FAILED', lastError: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }

  /** Scores the transcript. Runs as a job, so an AI outage is retried and the recording is kept. */
  async evaluate(id: string) {
    const r = await this.prisma.speakingResponse.findUnique({ where: { id }, select: { studentId: true, transcript: true, transcriptStatus: true, status: true } });
    if (!r || r.status === 'EVALUATED' || r.transcriptStatus !== 'DONE' || !r.transcript) return;
    try {
      const words = wordCount(r.transcript);
      const out = await this.ai.json<SpeakingEvaluation>({
        feature: 'speaking.evaluate',
        userId: r.studentId,
        system: this.ai.systemPrompt('speaking.evaluate', SPEAKING_INSTRUCTIONS),
        user: this.ai.wrapForPrompt('TRANSCRIPT', r.transcript),
        schema: speakingEvaluationSchema,
        mock: () => mockSpeakingEvaluation(words),
        maxTokens: 1200,
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.speakingEvaluation.create({
          data: {
            responseId: id, provider: out.provider, model: out.model, promptVersion: this.ai.promptVersion('speaking.evaluate'),
            estimatedBand: new Prisma.Decimal(out.data.estimatedBand),
            criteria: out.data.criteria as unknown as Prisma.InputJsonValue,
            feedback: out.data.feedback as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.speakingResponse.update({ where: { id }, data: { status: 'EVALUATED', lastError: null } });
      });
    } catch (e) {
      await this.prisma.speakingResponse.update({ where: { id }, data: { status: 'PROCESSING_FAILED', lastError: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }

  /** Re-queues whichever stage failed, for the student who owns the answer. */
  async retry(studentId: string, id: string) {
    const r = await this.ownedResponse(studentId, id);
    if (r.status !== 'PROCESSING_FAILED' && r.transcriptStatus !== 'FAILED') throw conflict('CONFLICT', 'Nothing to retry for this answer.');
    const stamp = Date.now();
    await this.prisma.speakingResponse.update({ where: { id }, data: { status: 'UPLOADED', transcriptStatus: 'PENDING', lastError: null } });
    const jobId = await this.jobs.enqueue('speaking.transcribe', `speaking-transcribe:${id}:retry:${stamp}`, { responseId: id });
    if (jobId) await this.jobs.runById(jobId).catch(() => false);
    return { status: 'UPLOADED' };
  }

  /** The answer, its transcript if ready, and the latest estimate. The storage key is never returned. */
  async getResponse(studentId: string, id: string) {
    const r = await this.prisma.speakingResponse.findFirst({
      where: { id, studentId },
      select: {
        id: true, part: true, promptText: true, status: true, transcriptStatus: true, transcript: true, durationSec: true, metrics: true, lastError: true, createdAt: true,
        evaluations: { orderBy: { createdAt: 'desc' }, take: 1, select: { estimatedBand: true, criteria: true, feedback: true, model: true, createdAt: true } },
      },
    });
    if (!r) throw notFound('Speaking answer');
    const transcript = r.transcriptStatus === 'DONE' ? r.transcript : null;
    return {
      ...r,
      transcript,
      fluency: transcript ? fluencyOf(transcript, r.durationSec === null ? null : Number(r.durationSec)) : null,
      latestEvaluation: r.evaluations[0] ?? null,
      evaluations: undefined,
    };
  }

  /** Average fluency indicators across the student's recent answers that have a transcript. */
  async fluencyProfile(studentId: string) {
    const rows = await this.prisma.speakingResponse.findMany({
      where: { studentId, transcriptStatus: 'DONE', transcript: { not: null } }, orderBy: { createdAt: 'desc' }, take: 30,
      select: { transcript: true, durationSec: true },
    });
    return profileOf(rows.map((r) => fluencyOf(r.transcript ?? '', r.durationSec === null ? null : Number(r.durationSec))));
  }

  private async ownedResponse(studentId: string, id: string) {
    const r = await this.prisma.speakingResponse.findFirst({ where: { id, studentId }, select: { id: true, status: true, transcriptStatus: true, storageKey: true } });
    if (!r) throw notFound('Speaking answer');
    return r;
  }
}

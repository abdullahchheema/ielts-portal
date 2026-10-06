import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ZodType } from 'zod';
import { AppError } from '../common/app-error';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { RateLimiter } from '../integrations/rate-limiter.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiMode, SpeechProvider, TextProvider, TranscriptResult } from './ai.types';
import { AiPromptService, parseJsonLoose } from './prompt.service';
import { MockSpeechProvider } from './providers/mock.provider';
import { OpenAiSpeechProvider, OpenAiTextProvider } from './providers/openai.provider';

export const AI_UNAVAILABLE_MESSAGE = 'AI analysis is temporarily unavailable. Your submission has been saved.';
const DAY_SEC = 86_400;

/** Picks the mode from env. Production without a key degrades to `none`, so the LMS still runs. */
export function resolveMode(provider: AiMode | undefined, key: string | undefined, nodeEnv: string): AiMode {
  if (provider === 'none') return 'none';
  if (provider === 'openai') return key ? 'openai' : 'none';
  if (provider === 'mock') return 'mock';
  if (key) return 'openai';
  return nodeEnv === 'production' ? 'none' : 'mock';
}

/**
 * The only entry point for AI calls. Features give it a zod schema and a deterministic `mock` fallback.
 * It enforces the per-student daily limit and a timeout, and writes one ai_requests row per call
 * (metadata only, never the prompt or the reply).
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  readonly mode: AiMode;
  readonly speechMode: AiMode;
  private readonly text?: TextProvider;
  private readonly speech?: SpeechProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiter,
    private readonly prompts: AiPromptService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.mode = resolveMode(config.AI_PROVIDER, config.AI_API_KEY, config.NODE_ENV);
    this.speechMode = config.AI_TRANSCRIPTION_PROVIDER
      ? resolveMode(config.AI_TRANSCRIPTION_PROVIDER, config.AI_API_KEY, config.NODE_ENV)
      : this.mode;
    if (this.mode === 'openai') this.text = new OpenAiTextProvider(config.AI_API_KEY!, config.AI_MODEL);
    if (this.speechMode === 'openai') this.speech = new OpenAiSpeechProvider(config.AI_API_KEY!, config.AI_TRANSCRIPTION_MODEL);
    if (this.speechMode === 'mock') this.speech = new MockSpeechProvider();
    this.logger.log(`AI mode: text=${this.mode} speech=${this.speechMode}`);
  }

  available(): boolean {
    return this.mode !== 'none';
  }

  speechAvailable(): boolean {
    return this.speechMode !== 'none';
  }

  /** The guarded system prompt for a feature. Features call this rather than building prompts themselves. */
  systemPrompt(feature: string, instructions: string): string {
    return this.prompts.system(feature, instructions);
  }

  /** Wraps learner text as quoted data, so it cannot be read as instructions. */
  wrapForPrompt(label: string, text: string, maxChars?: number): string {
    return this.prompts.wrap(label, text, maxChars);
  }

  promptVersion(feature: string): string {
    return this.prompts.version(feature);
  }

  /**
   * Runs a JSON-producing feature. Throws AI_UNAVAILABLE on any failure; the caller keeps the
   * student's submission, so an AI outage never loses work.
   */
  async json<T>(o: {
    feature: string; userId?: string; system: string; user: string; schema: ZodType<T>; mock: () => T; maxTokens?: number;
  }): Promise<{ data: T; model: string; provider: AiMode }> {
    const started = Date.now();
    const inputHash = createHash('sha256').update(o.system).update('\n').update(o.user).digest('hex').slice(0, 32);
    if (this.mode === 'none') {
      await this.record(o.feature, o.userId, 'UNAVAILABLE', 'none', inputHash, started, 'AI_DISABLED');
      throw new AppError('AI_UNAVAILABLE', 503, AI_UNAVAILABLE_MESSAGE);
    }
    await this.enforceLimit(o.feature, o.userId);

    if (this.mode === 'mock') {
      const data = o.schema.parse(o.mock());
      await this.record(o.feature, o.userId, 'SUCCEEDED', 'mock', inputHash, started);
      return { data, model: 'mock', provider: 'mock' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.AI_TIMEOUT_MS);
    try {
      const reply = await this.text!.complete({ feature: o.feature, system: o.system, user: o.user, maxTokens: o.maxTokens }, controller.signal);
      const parsed = o.schema.safeParse(parseJsonLoose(reply.text));
      if (!parsed.success) throw new Error('reply failed schema validation');
      await this.record(o.feature, o.userId, 'SUCCEEDED', this.mode, inputHash, started, undefined, reply);
      return { data: parsed.data, model: reply.model, provider: this.mode };
    } catch (e) {
      const code = controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_ERROR';
      await this.record(o.feature, o.userId, 'FAILED', this.mode, inputHash, started, code);
      this.logger.warn(JSON.stringify({ event: 'ai_failed', feature: o.feature, code, message: (e as Error).message.slice(0, 200) }));
      throw new AppError('AI_UNAVAILABLE', 503, AI_UNAVAILABLE_MESSAGE);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Transcribes audio. Returns null when speech is unavailable or fails, so the recording is still kept. */
  async transcribe(audio: Buffer, mime: string, o: { feature: string; userId?: string }): Promise<TranscriptResult | null> {
    const started = Date.now();
    if (!this.speech) {
      await this.record(o.feature, o.userId, 'UNAVAILABLE', 'none', null, started, 'SPEECH_DISABLED');
      return null;
    }
    await this.enforceLimit(o.feature, o.userId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.AI_TIMEOUT_MS);
    try {
      const result = await this.speech.transcribe(audio, mime, controller.signal);
      await this.record(o.feature, o.userId, 'SUCCEEDED', this.speechMode, null, started);
      return result;
    } catch (e) {
      await this.record(o.feature, o.userId, 'FAILED', this.speechMode, null, started, controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_ERROR');
      this.logger.warn(JSON.stringify({ event: 'transcription_failed', feature: o.feature, message: (e as Error).message.slice(0, 200) }));
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async enforceLimit(feature: string, userId?: string) {
    if (!userId || this.config.AI_DAILY_LIMIT === 0) return;
    const r = await this.limiter.hit(`ai:${feature}:${userId}`, this.config.AI_DAILY_LIMIT, DAY_SEC);
    if (!r.allowed) throw new AppError('AI_LIMIT_REACHED', 429, 'You have reached today\'s limit for this feature. Please try again tomorrow.');
  }

  private async record(
    feature: string, userId: string | undefined, status: 'SUCCEEDED' | 'FAILED' | 'UNAVAILABLE', provider: string,
    inputHash: string | null, started: number, errorCode?: string, reply?: { model: string; tokensIn?: number; tokensOut?: number },
  ) {
    const latencyMs = Date.now() - started;
    this.logger.log(JSON.stringify({ event: 'ai_call', feature, status, provider, latencyMs }));
    try {
      await this.prisma.aiRequest.create({
        data: {
          feature, userId: userId ?? null, provider, model: reply?.model ?? provider, status, inputHash, latencyMs,
          tokensIn: reply?.tokensIn ?? null, tokensOut: reply?.tokensOut ?? null, errorCode: errorCode ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`ai_requests write failed: ${(e as Error).message}`);
    }
  }
}

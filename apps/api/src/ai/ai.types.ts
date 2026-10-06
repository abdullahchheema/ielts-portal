/**
 * Vendor-neutral AI contracts. Nothing outside `ai/providers/` may import a vendor SDK or name a vendor.
 */

export interface TextRequest {
  feature: string;
  system: string;
  user: string;
  maxTokens?: number;
}

export interface TextResult {
  text: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface TextProvider {
  readonly name: string;
  complete(req: TextRequest, signal: AbortSignal): Promise<TextResult>;
}

export interface TranscriptWord {
  w: string;
  start: number;
  end: number;
}

export interface TranscriptResult {
  text: string;
  words: TranscriptWord[];
  durationSec: number;
  model: string;
}

export interface SpeechProvider {
  readonly name: string;
  transcribe(audio: Buffer, mime: string, signal: AbortSignal): Promise<TranscriptResult>;
}

export type AiMode = 'mock' | 'openai' | 'none';

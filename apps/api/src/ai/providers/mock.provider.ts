import { createHash } from 'node:crypto';
import { SpeechProvider, TranscriptResult } from '../ai.types';

/**
 * Deterministic stand-in for dev and tests: the same audio always yields the same transcript,
 * and no network call is made. Text evaluations use the caller's own deterministic `mock()` fallback.
 */
export class MockSpeechProvider implements SpeechProvider {
  readonly name = 'mock';

  async transcribe(audio: Buffer): Promise<TranscriptResult> {
    const digest = createHash('sha256').update(audio).digest();
    const count = 20 + (digest[0] % 40);
    const words = Array.from({ length: count }, (_, i) => ({ w: `word${(digest[i % digest.length] % 9) + 1}`, start: i * 0.45, end: i * 0.45 + 0.35 }));
    return { text: words.map((w) => w.w).join(' '), words, durationSec: count * 0.45, model: 'mock-speech' };
  }
}

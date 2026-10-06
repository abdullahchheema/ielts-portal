import { SpeechProvider, TextProvider, TextRequest, TextResult, TranscriptResult } from '../ai.types';

/**
 * OpenAI adapter. Plain `fetch` against the public REST API, so no vendor SDK is needed and this
 * file is the only place that knows the OpenAI wire format. Errors are thrown as plain Errors;
 * AiService turns them into AiUnavailable.
 */
const BASE = 'https://api.openai.com/v1';

export class OpenAiTextProvider implements TextProvider {
  readonly name = 'openai';
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async complete(req: TextRequest, signal: AbortSignal): Promise<TextResult> {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        response_format: { type: 'json_object' },
        ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`openai chat ${res.status}`);
    const body = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error('openai chat returned no content');
    return { text, model: body.model ?? this.model, tokensIn: body.usage?.prompt_tokens, tokensOut: body.usage?.completion_tokens };
  }
}

export class OpenAiSpeechProvider implements SpeechProvider {
  readonly name = 'openai';
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async transcribe(audio: Buffer, mime: string, signal: AbortSignal): Promise<TranscriptResult> {
    const ext = mime.split('/')[1]?.split(';')[0] || 'webm';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `recording.${ext}`);
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    const res = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}` }, body: form, signal });
    if (!res.ok) throw new Error(`openai transcription ${res.status}`);
    const body = (await res.json()) as { text?: string; duration?: number; words?: { word: string; start: number; end: number }[] };
    const words = (body.words ?? []).map((w) => ({ w: w.word, start: w.start, end: w.end }));
    return { text: body.text ?? '', words, durationSec: body.duration ?? words.at(-1)?.end ?? 0, model: this.model };
  }
}

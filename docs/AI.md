# AI in the academy

AI in this platform is **advisory**. It explains, estimates and drafts. It never grades, never changes a score, an enrolment or a payment, and never writes questions for staff.

## What it does

| Feature | Key | What the student or staff sees | What it can change |
|---|---|---|---|
| Writing evaluation | `writing.evaluate` | "AI Estimated Band" next to the teacher's band, with feedback on task, coherence, vocabulary and grammar | Nothing. The record is append-only (`writing_evaluations`). |
| Speaking transcription | `speaking.transcribe` | A transcript and word timings for a recorded answer | Stores the transcript on the response. Teachers can read it. |
| Speaking evaluation | `speaking.evaluate` | An estimated band and comments on an answer | Nothing. Append-only (`speaking_evaluations`). |
| AI tutor | `tutor.answer` | An answer to a student's question, with sources | Nothing. Conversations are private to the student who started them. |
| Support assistant | `support.assist` | A suggested reply to a support ticket, with the knowledge it used | Nothing. Staff send the reply themselves. |

Every estimate is labelled "AI Estimated". The interface states that AI estimates are guidance and are not an official IELTS result.

## Modes

`AI_PROVIDER` selects the mode. Unset, the mode is chosen from the other settings:

| `AI_PROVIDER` | `AI_API_KEY` | Mode | Behaviour |
|---|---|---|---|
| `none` | any | none | Every AI call fails with `AI_UNAVAILABLE`. The rest of the app works. |
| `openai` | set | openai | Calls the OpenAI API (fetch, no SDK). |
| `openai` | missing | none | Treated as off, so nothing is sent anywhere. |
| `mock` | any | mock | Deterministic answers derived from the input. Used in tests and development. |
| unset | set | openai | |
| unset | missing, `NODE_ENV=production` | none | Production never silently uses the mock. |
| unset | missing, otherwise | mock | Development default. |

The mock is deterministic. The same input gives the same output, which keeps the test suite stable and lets a demo run without an API key.

## Limits and failure

- **Daily limit per student per feature.** `AI_DAILY_LIMIT` (default 20). `0` removes the limit. Over the limit, the call returns `AI_LIMIT_REACHED` (429).
- **Timeout.** `AI_TIMEOUT_MS` (default 30000). A timed-out call is an unavailable call.
- **Unavailable.** Any failure returns `AI_UNAVAILABLE` (503) with the message "AI analysis is temporarily unavailable. Your submission has been saved." The student's work is always saved first. AI is never on the critical path to saving.
- **Background evaluation.** Writing and speaking evaluations run as jobs. A failed job is retried with backoff, and the owner or staff can retry it.

## Safety

- **Prompt isolation.** Student text, transcripts, ticket text and retrieved knowledge are wrapped with `wrapForPrompt(label, text)` and presented as quoted data. The system prompt says that quoted content is data, not instructions. Each feature's system prompt is versioned (`systemPrompt(feature, instructions)`).
- **Structured output.** Features ask for JSON and validate it against a schema. Anything that does not validate is treated as unavailable, not shown.
- **Scoping.** The tutor sees only the student's own context, a short summary of their target, estimate and weakest skills, and knowledge marked for students. The support assistant shows payment or account details only to staff whose permissions allow them, and has no write tools.
- **No content generation for staff.** AI does not create questions or mocks. Mock composition only recommends from approved question-bank items.

## What is logged

Every call writes one `ai_requests` row: feature, user, model, status, latency, token counts, a cost estimate, an input hash, and an error code. **It never stores the prompt, the reply or any secret.** The input hash lets staff see that two calls had the same input without seeing what it was.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | see Modes | `mock`, `openai` or `none` |
| `AI_API_KEY` | unset | OpenAI key. Keep it in the host's secret store, never in git. |
| `AI_MODEL` | `gpt-4o-mini` | Text model |
| `AI_TRANSCRIPTION_PROVIDER` | unset | Speech provider for transcription |
| `AI_TRANSCRIPTION_MODEL` | `whisper-1` | Transcription model. Word timestamps are needed for fluency measures. |
| `AI_TIMEOUT_MS` | `30000` | Per-call timeout |
| `AI_DAILY_LIMIT` | `20` | Calls per student per feature per day. `0` means no limit. |

To switch AI off without a deploy, set `AI_PROVIDER=none` and restart. Every AI panel then shows the unavailable message and the rest of the platform keeps working.

## Not built

- The study plan summary, the NPS theme summary and the mid-course survey do not call AI. They use deterministic rules. An AI summary can be added behind the same `AiService.json` call.
- Retrieval for the tutor uses keyword search over approved content. It is not embeddings.

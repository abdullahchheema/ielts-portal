'use client';

import { useEffect, useState } from 'react';
import {
  BAND_STEPS, SURVEY_DAILY_MINUTES, SURVEY_HELP, SURVEY_LEARNING_FORMATS, SURVEY_PROFICIENCY, SURVEY_REASONS, SURVEY_SKILLS, SURVEY_TIMELINES,
  SurveyDraftInput, surveySubmitSchema,
} from '@ielts/validation';
import { Alert, Button, Loading, OptionCard, Select, StepProgress } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import {
  DAILY_MINUTES_LABEL, HELP_LABEL, LEARNING_FORMAT_LABEL, PROFICIENCY_LABEL, REASON_LABEL, SKILL_LABEL, SURVEY_SLIDE_COUNT, TIMELINE_LABEL,
} from './questions';

interface SurveyDoc { status: 'DRAFT' | 'SUBMITTED'; revision: number; submittedAt: string | null }
export type Answers = SurveyDraftInput;

const SLIDE_TITLE = [
  'Have you taken IELTS before?', 'How confident are you with your current level?', "What's bringing you to IELTS?",
  "What's your target band?", 'When are you planning to take the test?', 'Which skills do you find most challenging?',
  'How would you describe your English proficiency?', 'How much time can you study each day?', 'How would you like to learn?',
  'What would help you most?',
];

export interface SurveyComplete { targetBand: string; ieltsHistory: 'NEVER' | 'TAKEN'; ieltsOverall: string }

/**
 * The 10-question onboarding survey.
 *
 * `persist="auth"` (default): behind an account, exactly as before — GET on mount, PUT-autosave per
 * slide, POST on submit, all against `/me/enrollment-survey`.
 *
 * `persist="local"`: for an anonymous visitor taking the survey before they have an account. No network
 * calls — every save/submit writes to `localStorage` under `storageKey` instead. `onComplete` still
 * fires on submit so the caller can move them on to account creation; the answers are picked back up
 * once they're authenticated, via `localSeed`.
 */
export function SurveyWizard({ onComplete, persist = 'auth', storageKey, localSeed }: {
  onComplete: (mapped: SurveyComplete) => void; persist?: 'auth' | 'local'; storageKey?: string; localSeed?: Answers;
}) {
  const [mode, setMode] = useState<'loading' | 'slides' | 'review' | 'submitted'>('loading');
  const [slide, setSlide] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (persist === 'local') {
      let seeded: Answers = {};
      try {
        const raw = storageKey ? localStorage.getItem(storageKey) : null;
        if (raw) seeded = JSON.parse(raw);
      } catch { /* storage may be blocked */ }
      setAnswers(seeded);
      setMode(surveySubmitSchema.safeParse(seeded).success ? 'review' : 'slides');
      return;
    }
    (async () => {
      const doc = await api<SurveyDoc & Answers>('/me/enrollment-survey');
      const { status, revision: rev, submittedAt, ...rest } = doc;
      const hasServerAnswers = Object.keys(rest).length > 0;
      // A completed answer set captured anonymously, picked up once the account exists.
      const seeded = hasServerAnswers ? rest : (localSeed ?? rest);
      setAnswers(seeded);
      setRevision(rev);
      setMode(status === 'SUBMITTED' ? 'submitted' : (surveySubmitSchema.safeParse(seeded).success ? 'review' : 'slides'));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);

  const patch = (p: Partial<Answers>) => setAnswers((a) => ({ ...a, ...p }));

  /** Jump to any question at any time — not gated on earlier questions being answered. */
  const jump = (i: number) => { setNotice(null); setSlide(i); setMode('slides'); };

  const save = async (next: Answers) => {
    if (persist === 'local') {
      try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage may be blocked */ }
      return true;
    }
    try {
      const doc = await api<SurveyDoc & Answers>('/me/enrollment-survey', { method: 'PUT', body: { revision, answers: next } });
      setRevision(doc.revision);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ANSWER_SAVE_CONFLICT') {
        const latest = await api<SurveyDoc & Answers>('/me/enrollment-survey');
        const { status: _s, revision: rev, submittedAt: _sub, ...rest } = latest;
        setAnswers(rest);
        setRevision(rev);
        setNotice('Your answers changed elsewhere — reloaded the latest version. Please continue.');
        return false;
      }
      setNotice(errorMessage(e));
      return false;
    }
  };

  const canContinue = (() => {
    switch (slide) {
      case 0: return answers.takenBefore !== undefined;
      case 1: return answers.takenBefore !== 'YES' || (answers.hadBand !== undefined && (answers.hadBand !== 'YES' || answers.priorScores?.overall !== undefined));
      case 2: return answers.reason !== undefined && (answers.reason !== 'OTHER' || !!answers.reasonOther);
      case 3: return answers.targetBand !== undefined;
      case 4: return answers.testTimeline !== undefined;
      case 5: return !!answers.challengingSkills?.length;
      case 6: return answers.proficiency !== undefined;
      case 7: return answers.dailyMinutes !== undefined;
      case 8: return answers.learningFormat !== undefined;
      case 9: return !!answers.helpWith?.length;
      default: return false;
    }
  })();

  /** Saves `toSave` (not necessarily the latest `answers` state, which hasn't flushed yet when
   * called right after a `setAnswers`) and moves to the next question, or review on the last one. */
  const advance = async (toSave: Answers) => {
    setNotice(null);
    setBusy(true);
    const ok = await save(toSave);
    setBusy(false);
    if (!ok) return;
    if (slide < SURVEY_SLIDE_COUNT - 1) setSlide(slide + 1);
    else setMode('review');
  };
  const next = () => advance(answers);
  const back = () => { setNotice(null); if (slide === 0) return; setSlide(slide - 1); };

  /** Pick a single-choice answer and immediately move on — the common case where there's nothing
   * else to fill in on this question. Slides with a follow-up field (an "Other" text box, prior
   * band scores) or multi-select stay on manual Next so the person can finish filling them in. */
  const selectAndAdvance = (p: Partial<Answers>) => {
    const merged = { ...answers, ...p };
    setAnswers(merged);
    advance(merged);
  };

  const mapped = (): SurveyComplete => ({
    targetBand: answers.targetBand !== undefined ? String(answers.targetBand) : '',
    ieltsHistory: answers.takenBefore === 'YES' ? 'TAKEN' : 'NEVER',
    ieltsOverall: answers.hadBand === 'YES' && answers.priorScores?.overall !== undefined ? String(answers.priorScores.overall) : '',
  });

  const submit = async () => {
    setBusy(true); setNotice(null);
    const r = surveySubmitSchema.safeParse(answers);
    if (!r.success) {
      const e: Record<string, string> = {};
      for (const i of r.error.issues) e[String(i.path[0])] ??= i.message;
      setSubmitErrors(e);
      setBusy(false);
      return;
    }
    setSubmitErrors({});
    if (persist === 'local') {
      try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify(r.data)); } catch { /* storage may be blocked */ }
      setBusy(false);
      onComplete(mapped());
      return;
    }
    try {
      await api('/me/enrollment-survey/submit', { method: 'POST', body: r.data });
      onComplete(mapped());
    } catch (e) {
      setNotice(errorMessage(e));
    } finally { setBusy(false); }
  };

  if (mode === 'loading') return <Loading />;

  if (mode === 'submitted') {
    return (
      <div className="space-y-4">
        <Alert kind="success">You already completed this survey. You can continue, or edit your answers.</Alert>
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => { setSlide(0); setMode('slides'); }}>Edit answers</Button>
          <Button onClick={() => onComplete(mapped())}>Continue to payment</Button>
        </div>
      </div>
    );
  }

  if (mode === 'review') {
    const rows: { label: string; value: string; jump: number }[] = [
      { label: SLIDE_TITLE[0], value: answers.takenBefore === 'YES' ? 'Yes' : 'No', jump: 0 },
      { label: SLIDE_TITLE[1], value: answers.takenBefore !== 'YES' ? 'N/A' : answers.hadBand === 'YES' ? `Yes, overall ${answers.priorScores?.overall}` : "Don't remember / No", jump: 1 },
      { label: SLIDE_TITLE[2], value: answers.reason ? (answers.reason === 'OTHER' ? answers.reasonOther ?? 'Other' : REASON_LABEL[answers.reason]) : '—', jump: 2 },
      { label: SLIDE_TITLE[3], value: answers.targetBand !== undefined ? String(answers.targetBand) : '—', jump: 3 },
      { label: SLIDE_TITLE[4], value: answers.testTimeline ? TIMELINE_LABEL[answers.testTimeline] : '—', jump: 4 },
      { label: SLIDE_TITLE[5], value: answers.challengingSkills?.map((s) => SKILL_LABEL[s]).join(', ') || '—', jump: 5 },
      { label: SLIDE_TITLE[6], value: answers.proficiency ? PROFICIENCY_LABEL[answers.proficiency] : '—', jump: 6 },
      { label: SLIDE_TITLE[7], value: answers.dailyMinutes ? DAILY_MINUTES_LABEL[answers.dailyMinutes] : '—', jump: 7 },
      { label: SLIDE_TITLE[8], value: answers.learningFormat ? LEARNING_FORMAT_LABEL[answers.learningFormat] : '—', jump: 8 },
      { label: SLIDE_TITLE[9], value: answers.helpWith?.map((h) => HELP_LABEL[h]).join(', ') || '—', jump: 9 },
    ];
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-fg">Review your answers</h2>
        {notice && <Alert>{notice}</Alert>}
        <dl className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-3 px-4 py-3">
              <div>
                <dt className="text-xs text-fg-muted">{r.label}</dt>
                <dd className="text-sm font-medium text-fg">{r.value}</dd>
              </div>
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { setSlide(r.jump); setMode('slides'); }}>Edit</button>
            </div>
          ))}
        </dl>
        {Object.keys(submitErrors).length > 0 && <Alert>Some answers need a second look. Use Edit above to fix them.</Alert>}
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => { setSlide(SURVEY_SLIDE_COUNT - 1); setMode('slides'); }}>Back</Button>
          <Button onClick={submit} busy={busy}>Continue to payment</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <StepProgress current={slide + 1} total={SURVEY_SLIDE_COUNT} />
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Jump to a question">
        {Array.from({ length: SURVEY_SLIDE_COUNT }, (_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === slide}
            aria-label={`Question ${i + 1}: ${SLIDE_TITLE[i]}`}
            onClick={() => jump(i)}
            className={cx(
              'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ring-1 ring-inset transition-colors duration-[var(--dur-fast)] ease-out-soft',
              i === slide ? 'bg-primary text-primary-fg ring-primary' : 'bg-surface text-fg-subtle ring-border-strong hover:bg-surface-muted hover:text-fg',
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
      {notice && <Alert>{notice}</Alert>}
      <h2 className="text-lg font-semibold text-fg">{SLIDE_TITLE[slide]}</h2>

      {slide === 0 && (
        <div className="space-y-2">
          <OptionCard selected={answers.takenBefore === 'YES'} onClick={() => selectAndAdvance({ takenBefore: 'YES' })}>Yes, I have</OptionCard>
          <OptionCard selected={answers.takenBefore === 'NO'} onClick={() => selectAndAdvance({ takenBefore: 'NO', hadBand: undefined, priorScores: undefined })}>No, this is my first time</OptionCard>
        </div>
      )}

      {slide === 1 && (
        answers.takenBefore !== 'YES' ? (
          <p className="text-sm text-fg-muted">This question only applies if you have taken IELTS before — nothing to answer here.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <OptionCard selected={answers.hadBand === 'YES'} onClick={() => patch({ hadBand: 'YES' })}>Yes, I remember my band</OptionCard>
              <OptionCard selected={answers.hadBand === 'NO'} onClick={() => selectAndAdvance({ hadBand: 'NO', priorScores: undefined })}>No / I don&apos;t remember</OptionCard>
            </div>
            {answers.hadBand === 'YES' && (
              <div className="grid gap-3 sm:grid-cols-2">
                {(['overall', 'listening', 'reading', 'writing', 'speaking'] as const).map((k) => (
                  <div key={k}>
                    <label className="mb-1 block text-xs font-medium text-fg-muted capitalize">{k}{k === 'overall' ? ' (required)' : ' (optional)'}</label>
                    <Select
                      value={answers.priorScores?.[k] !== undefined ? String(answers.priorScores[k]) : ''}
                      onChange={(e) => patch({ priorScores: { ...answers.priorScores, [k]: e.target.value ? Number(e.target.value) : undefined } })}
                    >
                      <option value="">Select</option>
                      {BAND_STEPS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {slide === 2 && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {SURVEY_REASONS.map((r) => (
              <OptionCard
                key={r} selected={answers.reason === r}
                onClick={() => r === 'OTHER' ? patch({ reason: r }) : selectAndAdvance({ reason: r, reasonOther: undefined })}
              >
                {REASON_LABEL[r]}
              </OptionCard>
            ))}
          </div>
          {answers.reason === 'OTHER' && (
            <input
              className="block w-full rounded-md border-0 bg-surface px-3 py-2 text-sm text-fg shadow-xs ring-1 ring-inset ring-border-strong focus:ring-2 focus:ring-primary focus:outline-none"
              placeholder="Tell us why" value={answers.reasonOther ?? ''} onChange={(e) => patch({ reasonOther: e.target.value })}
            />
          )}
        </div>
      )}

      {slide === 3 && (
        <div className="max-w-xs">
          <Select value={answers.targetBand !== undefined ? String(answers.targetBand) : ''} onChange={(e) => e.target.value && selectAndAdvance({ targetBand: Number(e.target.value) })}>
            <option value="">Select</option>
            {BAND_STEPS.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </div>
      )}

      {slide === 4 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {SURVEY_TIMELINES.map((t) => <OptionCard key={t} selected={answers.testTimeline === t} onClick={() => selectAndAdvance({ testTimeline: t })}>{TIMELINE_LABEL[t]}</OptionCard>)}
        </div>
      )}

      {slide === 5 && (
        <div className="space-y-2">
          <p className="text-xs text-fg-muted">Choose up to 4.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SURVEY_SKILLS.map((s) => {
              const selected = !!answers.challengingSkills?.includes(s);
              return (
                <OptionCard
                  key={s} multi selected={selected}
                  onClick={() => {
                    const cur = answers.challengingSkills ?? [];
                    if (selected) patch({ challengingSkills: cur.filter((x) => x !== s) });
                    else if (cur.length < 4) patch({ challengingSkills: [...cur, s] });
                  }}
                >
                  {SKILL_LABEL[s]}
                </OptionCard>
              );
            })}
          </div>
        </div>
      )}

      {slide === 6 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {SURVEY_PROFICIENCY.map((p) => <OptionCard key={p} selected={answers.proficiency === p} onClick={() => selectAndAdvance({ proficiency: p })}>{PROFICIENCY_LABEL[p]}</OptionCard>)}
        </div>
      )}

      {slide === 7 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {SURVEY_DAILY_MINUTES.map((m) => <OptionCard key={m} selected={answers.dailyMinutes === m} onClick={() => selectAndAdvance({ dailyMinutes: m })}>{DAILY_MINUTES_LABEL[m]}</OptionCard>)}
        </div>
      )}

      {slide === 8 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {SURVEY_LEARNING_FORMATS.map((f) => <OptionCard key={f} selected={answers.learningFormat === f} onClick={() => selectAndAdvance({ learningFormat: f })}>{LEARNING_FORMAT_LABEL[f]}</OptionCard>)}
        </div>
      )}

      {slide === 9 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {SURVEY_HELP.map((h) => {
            const selected = !!answers.helpWith?.includes(h);
            return (
              <OptionCard
                key={h} multi selected={selected}
                onClick={() => {
                  const cur = answers.helpWith ?? [];
                  patch({ helpWith: selected ? cur.filter((x) => x !== h) : [...cur, h] });
                }}
              >
                {HELP_LABEL[h]}
              </OptionCard>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        {slide > 0 ? <Button variant="secondary" onClick={back} disabled={busy}>Back</Button> : <span />}
        <Button onClick={next} busy={busy} disabled={!canContinue}>{slide === SURVEY_SLIDE_COUNT - 1 ? 'Review' : 'Next'}</Button>
      </div>
    </div>
  );
}

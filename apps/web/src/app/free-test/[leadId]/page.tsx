'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { BookOpen, Headphones, Mic, PenLine, Trophy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Loading, PageHeader, ProgressBar, Select, Textarea, useConfirm } from '@/components/ui';
import { Stepper, type StepDef } from '@/components/ui/stepper';
import { AudioPlayer } from '@/components/audio-player';
import { Q, QuestionImages, QuestionInput } from '@/components/question-input';
import { ContentBlock, RichContent, RichImage } from '@/components/rich-content';
import { ApiError, api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { extensionFor, useRecorder } from '@/lib/use-recorder';

type Stage = 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING' | 'DONE';
const ORDER: Stage[] = ['LISTENING', 'READING', 'WRITING', 'SPEAKING', 'DONE'];
const STAGE_STEPS: Record<Stage, StepDef> = {
  LISTENING: { key: 'LISTENING', label: 'Listening', icon: Headphones },
  READING: { key: 'READING', label: 'Reading', icon: BookOpen },
  WRITING: { key: 'WRITING', label: 'Writing', icon: PenLine },
  SPEAKING: { key: 'SPEAKING', label: 'Speaking', icon: Mic },
  DONE: { key: 'DONE', label: 'Results', icon: Trophy },
};

interface Exam {
  id: string; status: string; stage: Stage; stageRevision: number; includeSpeaking: boolean;
  overallEstimate: string | null; missingSkills: string[];
  sections: {
    listening: { attemptId: string; status: string; band: string | null } | null;
    reading: { attemptId: string; status: string; band: string | null } | null;
    writing: { responseId: string; status: string; wordCount: number } | null;
    speaking: { attemptId: string; status: string; answers: number } | null;
  };
}

type Question = Q;
interface Section {
  id: string; title: string;
  content: {
    passage?: string; instructions?: string; audioUrl?: string; instructionGroups?: { text: string; count: number }[];
    contentBlocks?: ContentBlock[]; images?: RichImage[];
  };
  questions: Question[];
}
type Answers = Record<string, unknown>;
interface SectionPaper {
  attempt: { id: string; revision: number; remainingSeconds: number | null; audioPlayed: boolean };
  // Once the attempt is no longer IN_PROGRESS (e.g. the timer already auto-submitted it server-side,
  // and this query refetched before the stage had advanced), the API returns a result shape instead —
  // no paper/assessment/answers. Both optional here so that case renders a loading state, not a crash.
  assessment?: { title: string; timeLimitMin: number | null };
  paper?: Section[];
  answers?: Answers;
}

const countWords = (t: string) => (t.match(/[A-Za-z’'-]+/g) ?? []).length;

export default function FreeTestPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data: exam, isLoading, isError, refetch: refetchExam } = useQuery({
    queryKey: ['free-test-exam', leadId],
    queryFn: () => api<Exam>(`/free-test/${leadId}`),
    refetchInterval: 15_000,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['free-test-exam', leadId] }), [qc, leadId]);

  // A direct/shared deep link (not the normal claim-then-redirect path) should still resume
  // correctly from the landing page on a later visit, so remember this id too.
  useEffect(() => {
    try { localStorage.setItem('freeTestLeadId', leadId); } catch { /* private window etc. */ }
  }, [leadId]);

  async function exitTest() {
    const ok = await confirm({
      message: 'Leaving will stop your free test here. You can come back to this exact link within 7 days to pick up where you left off, but any section you\'ve already submitted can\'t be redone.',
      confirmLabel: 'Exit test', tone: 'danger',
    });
    if (!ok) return;
    // The landing page auto-resumes whatever id is in localStorage — without clearing it first,
    // navigating there would immediately redirect straight back into this same test.
    try { localStorage.removeItem('freeTestLeadId'); } catch { /* private window etc. */ }
    router.push('/free-test');
  }

  // The exam query only refetches every 15s, so its cached stageRevision can be stale by the time the
  // student actually advances (a scheduled server-side sweep, or a second tab, can bump it first).
  // Get a fresh revision right before the call, and if the server still rejects it as stale, refetch
  // once more and retry exactly once rather than leaving the student stuck on a dead-end error.
  async function advance() {
    if (!exam) return;
    setBusy(true); setError(null);
    const attempt = async (revision: number) => api(`/free-test/${leadId}/advance`, { method: 'POST', body: { expectedRevision: revision } });
    try {
      const fresh = (await refetchExam()).data;
      try {
        await attempt(fresh?.stageRevision ?? exam.stageRevision);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CONFLICT') {
          const retried = (await refetchExam()).data;
          await attempt(retried?.stageRevision ?? exam.stageRevision);
        } else throw e;
      }
      await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (isLoading) return <Loading />;
  if (isError || !exam) return <Alert>Could not load this free test. Your link may have expired.</Alert>;

  const done = exam.status === 'COMPLETED';
  const steps = ORDER.filter((s) => s !== 'SPEAKING' || exam.includeSpeaking).map((s) => STAGE_STEPS[s]);
  const activeIndex = Math.max(0, steps.findIndex((s) => s.key === exam.stage));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-9 lg:px-10 lg:py-12">
      <PageHeader
        title="Your free test"
        subtitle={done ? 'Finished. Scores below are estimates.' : `Stage: ${exam.stage.toLowerCase()}`}
        actions={<div className="flex items-center gap-2">
          <Badge status={exam.status} />
          {!done && <Button variant="secondary" size="sm" onClick={exitTest}>Exit test</Button>}
        </div>}
      />
      {error && <Alert>{error}</Alert>}

      <div className="mb-8">
        <Stepper steps={steps} activeIndex={activeIndex} />
      </div>

      {(exam.stage === 'LISTENING' || exam.stage === 'READING') && <SectionStage leadId={leadId} stage={exam.stage} onAdvance={advance} busy={busy} />}
      {exam.stage === 'WRITING' && <WritingStage leadId={leadId} onAdvance={advance} busy={busy} />}
      {exam.stage === 'SPEAKING' && <SpeakingStage leadId={leadId} onAdvance={advance} busy={busy} />}

      {done && (
        <Card className="max-w-2xl space-y-3">
          <h2 className="font-semibold text-fg">Your results</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="text-sm text-fg-muted">Listening</p><p className="text-2xl font-semibold">{exam.sections.listening?.band ?? '—'}</p></div>
            <div><p className="text-sm text-fg-muted">Reading</p><p className="text-2xl font-semibold">{exam.sections.reading?.band ?? '—'}</p></div>
          </div>
          {exam.overallEstimate ? (
            <p className="font-display text-3xl font-semibold text-fg">Overall estimate: {exam.overallEstimate}</p>
          ) : (
            <p className="text-sm text-fg-muted">
              Writing and Speaking are not scored on the free test — AI evaluation is a feature of our paid plans, so no overall estimate is shown.
            </p>
          )}
          {exam.missingSkills.length > 0 && <p className="text-sm text-fg-muted">Not assessed on this plan: {exam.missingSkills.map((s) => s.toLowerCase()).join(', ')}.</p>}
          <Link href="/pricing"><Button>See plans and register for full feedback</Button></Link>
          <p className="text-xs text-fg-subtle">These are practice estimates, not official IELTS results.</p>
        </Card>
      )}
    </div>
  );
}

function SectionStage({ leadId, stage, onAdvance, busy: parentBusy }: { leadId: string; stage: 'LISTENING' | 'READING'; onAdvance: () => void; busy: boolean }) {
  const confirm = useConfirm();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({ queryKey: ['free-test-section', leadId, stage], queryFn: () => api<SectionPaper>(`/free-test/${leadId}/section`) });
  const [answers, setAnswers] = useState<Answers>({});
  const [status, setStatus] = useState<'saved' | 'saving' | 'offline' | 'conflict'>('saved');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [activePassage, setActivePassage] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [audioPlayed, setAudioPlayed] = useState(false);
  const revision = useRef(0);
  const dirty = useRef(new Set<string>());
  const answersRef = useRef<Answers>({});
  const inFlight = useRef(false);
  const hydrated = useRef(false);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (data?.paper && !hydrated.current) {
      hydrated.current = true; revision.current = data.attempt.revision;
      setAnswers(data.answers ?? {}); setRemaining(data.attempt.remainingSeconds ?? null); setAudioPlayed(data.attempt.audioPlayed);
    }
  }, [data]);
  useEffect(() => { answersRef.current = answers; }, [answers]);

  // One-play enforcement: fires once, the first time the Listening audio actually starts (not on
  // click-to-expand or metadata load) — optimistic locally, with the server call as the real guard
  // against a refresh re-enabling playback.
  const handleFirstPlay = useCallback(() => {
    setAudioPlayed(true);
    api(`/free-test/${leadId}/section/audio-played`, { method: 'PUT' }).catch(() => { /* best-effort; server state is the real source of truth on next load */ });
  }, [leadId]);

  const flush = useCallback(async () => {
    if (inFlight.current || dirty.current.size === 0) return;
    inFlight.current = true; setStatus('saving');
    const ids = [...dirty.current];
    const snapshot = ids.map((qid) => ({ questionVersionId: qid, answer: answersRef.current[qid] ?? null }));
    try {
      const res = await api<{ revision: number }>(`/free-test/${leadId}/answers`, { method: 'PUT', body: { revision: revision.current, answers: snapshot } });
      revision.current = res.revision;
      ids.forEach((qid) => dirty.current.delete(qid));
      setStatus(dirty.current.size ? 'saving' : 'saved');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ANSWER_SAVE_CONFLICT') setStatus('conflict');
      else setStatus('offline');
    } finally { inFlight.current = false; }
  }, [leadId]);

  useEffect(() => { const t = setInterval(flush, 10_000); return () => clearInterval(t); }, [flush]);
  useEffect(() => { const t = setTimeout(flush, 1500); return () => clearTimeout(t); }, [answers, flush]);

  // Tracks which question is actually in view while the student scrolls manually, so the chip strip
  // reflects real reading position rather than only ever showing the last place they clicked/jumped to.
  useEffect(() => {
    const sections = data?.paper;
    if (!sections) return;
    const tabbed = stage === 'READING' && sections.length > 1;
    const visible = tabbed ? [sections[activePassage]] : sections;
    const ids = visible.flatMap((s) => s.questions.map((q) => q.id));
    if (ids.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((e) => e.isIntersecting);
        if (visibleEntries.length === 0) return;
        const center = window.innerHeight / 2;
        const best = visibleEntries.reduce((a, b) => {
          const da = Math.abs(a.boundingClientRect.top + a.boundingClientRect.height / 2 - center);
          const db = Math.abs(b.boundingClientRect.top + b.boundingClientRect.height / 2 - center);
          return db < da ? b : a;
        });
        setActiveId(best.target.id.replace(/^q-/, ''));
      },
      { rootMargin: '-35% 0px -50% 0px', threshold: [0, 1] },
    );
    for (const id of ids) {
      const el = document.getElementById(`q-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [data?.paper, stage, activePassage]);

  const doSubmit = useCallback(async () => {
    setSubmitting(true); setError(null);
    try { await flush(); await api(`/free-test/${leadId}/section/submit`, { method: 'POST' }); onAdvance(); }
    catch (e) { setError(errorMessage(e)); } finally { setSubmitting(false); }
  }, [flush, leadId, onAdvance]);

  // Manual click: confirm first if anything is still unanswered. Auto-submit at zero never asks —
  // time simply ran out, same as the authenticated attempt page's auto-submit.
  async function submitAndContinue() {
    const paperNow = data?.paper;
    if (paperNow) {
      const totalNow = paperNow.reduce((n, s) => n + s.questions.length, 0);
      const answeredNow = Object.keys(answersRef.current).filter((k) => answersRef.current[k] !== null && answersRef.current[k] !== undefined).length;
      if (answeredNow < totalNow) {
        const ok = await confirm({ message: `You have answered ${answeredNow} of ${totalNow} questions. Submit anyway?`, confirmLabel: 'Submit' });
        if (!ok) return;
      }
    }
    await doSubmit();
  }

  // Countdown; auto-submit at zero, mirroring the authenticated attempt page.
  useEffect(() => {
    if (remaining === null || submitting) return;
    if (remaining <= 0) { doSubmit(); return; }
    const t = setTimeout(() => setRemaining((r) => (r === null ? r : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining, submitting, doSubmit]);

  function jumpTo(id: string) {
    // Reading shows one passage at a time — switch to whichever passage owns this question before
    // scrolling, so a chip from another passage doesn't try to scroll to a hidden element.
    const sIdx = data?.paper?.findIndex((s) => s.questions.some((q) => q.id === id));
    if (sIdx !== undefined && sIdx >= 0) setActivePassage(sIdx);
    const scroll = () => {
      document.getElementById(`q-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      chipRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      setFocusedId(id);
      setActiveId(id);
      window.setTimeout(() => setFocusedId((cur) => (cur === id ? null : cur)), 1500);
    };
    // Give the tab switch a tick to render before scrolling to the (possibly now-mounted) element.
    if (sIdx !== undefined && sIdx >= 0 && sIdx !== activePassage) window.setTimeout(scroll, 50);
    else scroll();
  }

  // The section was already submitted server-side (e.g. the countdown auto-submitted it just before
  // this query refetched) — the API then returns a result, not a paper. Resync the stage instead of
  // rendering a paper that no longer exists.
  useEffect(() => {
    if (data && !data.paper) onAdvance();
  }, [data, onAdvance]);

  if (isError) {
    return (
      <Alert>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Could not load this section. The connection may be slow — please try again.</span>
          <Button variant="secondary" size="sm" onClick={() => refetch()} busy={isRefetching}>Try again</Button>
        </div>
      </Alert>
    );
  }
  if (isLoading || !data || !data.paper || !data.assessment) return <Loading />;
  const paper = data.paper;
  const assessment = data.assessment;

  const total = paper.reduce((n, s) => n + s.questions.length, 0);
  const answered = Object.keys(answers).filter((k) => answers[k] !== null && answers[k] !== undefined).length;
  const mm = remaining !== null ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : null;
  const low = remaining !== null && remaining < 300;
  // Reading shows one passage at a time via tabs (closer to the real test and easier to navigate on
  // mobile); Listening keeps every part on one scrolling page so its single audio track stays mounted
  // and playing without interruption while the student works through later parts.
  const isTabbedReading = stage === 'READING' && paper.length > 1;
  const visibleSections = isTabbedReading ? [paper[activePassage]] : paper;
  let runningIndex = 0;

  return (
    <div className="space-y-8">
      <div className="sticky top-0 z-10 -mx-4 space-y-4 border-b border-border bg-surface/95 px-4 py-4 shadow-sm backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-semibold text-fg">{assessment.title}</h2>
            <p className="mt-0.5 text-xs text-fg-muted">{answered}/{total} answered</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span aria-live="polite" className={status === 'offline' || status === 'conflict' ? 'text-danger' : 'text-fg-muted'}>
              {status === 'saved' ? 'All changes saved' : status === 'saving' ? 'Saving…' : status === 'offline' ? 'Offline — will retry' : 'Changed elsewhere'}
            </span>
            {mm && <span role="timer" aria-label="Time remaining" className={cx('rounded-md px-2.5 py-1 font-mono text-base font-semibold tabular-nums', low ? 'bg-danger-soft text-danger' : 'bg-surface-muted text-fg')}>{mm}</span>}
            <Button onClick={submitAndContinue} busy={submitting || parentBusy}>Submit section and continue</Button>
          </div>
        </div>
        <ProgressBar value={total ? (answered / total) * 100 : 0} />
        <div className="no-scrollbar flex gap-5 overflow-x-auto rounded-xl bg-surface-muted/60 px-3 py-2.5">
          {paper.map((s, sIdx) => (
            <div key={s.id} className="flex shrink-0 items-center gap-2">
              <span className={cx('text-[11px] font-medium whitespace-nowrap', isTabbedReading && sIdx === activePassage ? 'text-primary' : 'text-fg-subtle')}>
                {s.title.replace(/^(Part|Reading Passage)\s*/i, '')}
              </span>
              <div className="flex gap-1">
                {s.questions.map((q) => {
                  const num = ++runningIndex;
                  const isAnswered = answers[q.id] !== null && answers[q.id] !== undefined;
                  const isActive = activeId === q.id;
                  return (
                    <button
                      key={q.id}
                      ref={(el) => { if (el) chipRefs.current.set(q.id, el); else chipRefs.current.delete(q.id); }}
                      type="button"
                      onClick={() => jumpTo(q.id)}
                      aria-label={`Go to question ${num}`}
                      aria-current={isActive ? 'true' : undefined}
                      className={cx(
                        'grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums ring-1 ring-inset transition-colors',
                        isAnswered ? 'bg-primary text-primary-fg ring-primary hover:bg-primary-hover' : 'bg-surface text-fg-subtle ring-border-strong hover:bg-surface-muted',
                        isActive && 'ring-2 ring-offset-1 ring-offset-surface-muted',
                      )}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {isTabbedReading && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Reading passages">
          {paper.map((s, i) => (
            <button
              key={s.id} type="button" role="tab" aria-selected={i === activePassage}
              onClick={() => setActivePassage(i)}
              className={cx(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                i === activePassage ? 'bg-primary text-primary-fg' : 'bg-surface-muted text-fg-subtle hover:bg-surface-muted/70 hover:text-fg',
              )}
            >
              Passage {i + 1}
            </button>
          ))}
        </div>
      )}
      {visibleSections.map((s) => {
        const sIdx = paper.indexOf(s);
        const offset = paper.slice(0, sIdx).reduce((n, p) => n + p.questions.length, 0);
        return (
          <section key={s.id} aria-labelledby={`s-${s.id}`} className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">Part {sIdx + 1} of {paper.length}</span>
              <h3 id={`s-${s.id}`} className="text-lg font-semibold text-fg">{s.title}</h3>
            </div>
            {!s.content.instructionGroups && s.content.instructions && (
              <div className="rounded-lg bg-info-soft px-4 py-2.5 text-base text-sky-800">{s.content.instructions}</div>
            )}
            {s.content.audioUrl && (
              <Card className="!p-4">
                <AudioPlayer src={s.content.audioUrl} label="🎧 Listen to the recording" playable={!audioPlayed} onFirstPlay={handleFirstPlay} />
              </Card>
            )}
            {s.content.contentBlocks ? (
              <RichContent
                blocks={s.content.contentBlocks}
                questions={s.questions}
                offset={offset}
                answers={answers}
                onChange={(qId, v) => { dirty.current.add(qId); setAnswers((a) => ({ ...a, [qId]: v })); }}
                images={s.content.images}
                focusedId={focusedId}
              />
            ) : (
              <div className={s.content.passage ? 'grid gap-6 lg:grid-cols-2' : ''}>
                {s.content.passage && (
                  <Card className="max-h-[70vh] overflow-auto bg-surface-muted/40 text-sm leading-relaxed whitespace-pre-wrap lg:sticky lg:top-48">
                    {s.content.passage}
                  </Card>
                )}
                {s.content.instructionGroups ? (
                  <div className="space-y-5">
                    {(() => {
                      let consumed = 0;
                      return s.content.instructionGroups.map((g, gi) => {
                        const slice = s.questions.slice(consumed, consumed + g.count);
                        const startIndex = consumed;
                        consumed += g.count;
                        return (
                          <div key={gi} className="space-y-4">
                            <div className="rounded-lg bg-info-soft px-4 py-2.5 text-base text-sky-800">{g.text}</div>
                            <ol className="space-y-4">
                              {slice.map((q, i) => (
                                <li key={q.id} id={`q-${q.id}`} className="scroll-mt-48">
                                  <Card className={cx('transition-shadow duration-300', focusedId === q.id && 'shadow-lg ring-2 ring-primary ring-offset-2 ring-offset-surface')}>
                                    <p className="mb-3 flex items-start gap-2.5 text-base font-medium text-fg">
                                      <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-fg-muted tabular-nums">{offset + startIndex + i + 1}</span>
                                      <span>{q.prompt.text}</span>
                                    </p>
                                    <QuestionImages images={q.images} />
                                    <QuestionInput q={q} value={answers[q.id]} onChange={(v) => { dirty.current.add(q.id); setAnswers((a) => ({ ...a, [q.id]: v })); }} />
                                  </Card>
                                </li>
                              ))}
                            </ol>
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  <ol className="space-y-4">
                    {s.questions.map((q, i) => (
                      <li key={q.id} id={`q-${q.id}`} className="scroll-mt-48">
                        <Card className={cx('transition-shadow duration-300', focusedId === q.id && 'shadow-lg ring-2 ring-primary ring-offset-2 ring-offset-surface')}>
                          <p className="mb-3 flex items-start gap-2.5 text-base font-medium text-fg">
                            <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-fg-muted tabular-nums">{offset + i + 1}</span>
                            <span>{q.prompt.text}</span>
                          </p>
                          <QuestionImages images={q.images} />
                          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => { dirty.current.add(q.id); setAnswers((a) => ({ ...a, [q.id]: v })); }} />
                        </Card>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function WritingStage({ leadId, onAdvance, busy: parentBusy }: { leadId: string; onAdvance: () => void; busy: boolean }) {
  const { data, refetch, isError, isRefetching } = useQuery({ queryKey: ['free-test-writing', leadId], queryFn: () => api<{ body: string; revision: number; promptText: string; status: string }>(`/free-test/${leadId}/writing`) });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && text === null) setText(data.body); }, [data, text]);
  if (isError) {
    return (
      <Alert>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Could not load the writing task. The connection may be slow — please try again.</span>
          <Button variant="secondary" size="sm" onClick={() => refetch()} busy={isRefetching}>Try again</Button>
        </div>
      </Alert>
    );
  }
  if (!data || text === null) return <Loading />;
  const editable = data.status === 'DRAFT';

  /** Returns whether the save actually succeeded — callers that chain into a submit must check this
   *  rather than assume it, since a failed autosave must never be followed by submitting stale text. */
  async function save(): Promise<boolean> {
    setBusy(true); setError(null);
    try { await api(`/free-test/${leadId}/writing`, { method: 'PUT', body: { revision: data!.revision, body: text } }); await refetch(); return true; }
    catch (e) { setError(errorMessage(e)); return false; }
    finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError(null);
    const saved = await save();
    if (!saved) { setBusy(false); return; }
    try { await api(`/free-test/${leadId}/writing/submit`, { method: 'POST' }); await refetch(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Card className="max-w-3xl space-y-4">
      <p className="font-medium text-fg">{data.promptText}</p>
      <Alert kind="info">Writing is saved and kept with your free test, but AI feedback requires the Advanced or Premium plan.</Alert>
      {error && <Alert>{error}</Alert>}
      <Textarea aria-label="Essay" rows={16} value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap justify-between gap-3">
        <span className="text-sm text-fg-muted">{countWords(text)} words</span>
        {editable
          ? <Button onClick={submit} busy={busy || parentBusy}>Submit essay and continue</Button>
          : <Button onClick={onAdvance} busy={parentBusy}>Continue</Button>}
      </div>
    </Card>
  );
}

type Part = 'PART1' | 'PART2' | 'PART3';
interface SpeakingQuestion { id: string; part: Part; prompt: string }
const PART_LABEL: Record<Part, string> = { PART1: 'Part 1 · everyday questions', PART2: 'Part 2 · long turn (about 2 minutes)', PART3: 'Part 3 · discussion' };
const MAX_SECONDS: Record<Part, number> = { PART1: 60, PART2: 150, PART3: 90 };

function SpeakingStage({ leadId, onAdvance, busy: parentBusy }: { leadId: string; onAdvance: () => void; busy: boolean }) {
  const [part, setPart] = useState<Part>('PART1');
  const [question, setQuestion] = useState<SpeakingQuestion | null>(null);
  const [response, setResponse] = useState<{ id: string; status: string } | null>(null);
  const [answered, setAnswered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which question ids this part has already asked in this session — picking at pure random with no
  // exclusion let a small pool (sometimes just 1-2 questions per part) repeat the exact same prompt,
  // including the very first one, on "Next question".
  const [askedIds, setAskedIds] = useState<Set<string>>(new Set());
  const questions = useQuery({ queryKey: ['free-test-speaking-questions', part], queryFn: () => api<SpeakingQuestion[]>(`/free-test/speaking-questions?part=${part}`) });
  const rec = useRecorder({ maxSeconds: MAX_SECONDS[part] });

  async function nextQuestion() {
    const pool = questions.data ?? [];
    const unused = pool.filter((p) => !askedIds.has(p.id));
    // Every question in the pool has been asked already — start a fresh cycle through the same pool
    // rather than getting stuck with nothing left to pick from.
    const candidates = unused.length ? unused : pool;
    const q = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : { id: '', part, prompt: 'Describe something you do to relax.' };
    if (q.id) setAskedIds((prev) => (unused.length ? new Set(prev).add(q.id) : new Set([q.id])));
    setQuestion(q);
    setResponse(null);
    rec.reset();
    setError(null);
    try {
      const r = await api<{ id: string; part: Part; promptText: string; status: string }>(`/free-test/${leadId}/speaking-responses`, {
        method: 'POST', body: { part, ...(q.id ? { questionId: q.id } : { promptText: q.prompt }) },
      });
      setResponse({ id: r.id, status: r.status });
    } catch (e) { setError(errorMessage(e)); }
  }

  async function upload() {
    if (!response || rec.state.kind !== 'ready') return;
    const blob = rec.state.blob;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', blob, `answer.${extensionFor(blob.type)}`);
      await api(`/free-test/${leadId}/speaking-responses/${response.id}/audio`, { method: 'POST', form: fd });
      setResponse({ ...response, status: 'UPLOADED' });
      setAnswered((n) => n + 1);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Card className="max-w-2xl space-y-4">
      {error && <Alert>{error}</Alert>}
      <Alert kind="info">Record a few speaking answers — AI transcript and feedback require the Advanced or Premium plan.</Alert>
      <Field label="Part">{(p) => <Select {...p} value={part} onChange={(e) => setPart(e.target.value as Part)}>{(['PART1', 'PART2', 'PART3'] as Part[]).map((x) => <option key={x} value={x}>{PART_LABEL[x]}</option>)}</Select>}</Field>

      {!question && <Button onClick={nextQuestion} busy={busy}>Start speaking</Button>}

      {question && (
        <div className="space-y-3">
          <p className="font-display text-lg text-fg">{question.prompt}</p>
          <p className="text-sm text-fg-muted">Time limit: {Math.round(MAX_SECONDS[part] / 60 * 10) / 10} min</p>
          {response?.status !== 'UPLOADED' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {rec.state.kind !== 'recording'
                  ? <Button variant="secondary" onClick={() => rec.start()}>● Record answer</Button>
                  : <Button variant="danger" onClick={rec.stop}>■ Stop ({Math.floor(rec.elapsed / 60)}:{String(rec.elapsed % 60).padStart(2, '0')})</Button>}
              </div>
              {rec.state.kind === 'ready' && <audio controls src={rec.state.url} className="w-full" />}
              {rec.state.kind === 'error' && <Alert>{rec.state.message}</Alert>}
              <Button onClick={upload} busy={busy} disabled={rec.state.kind !== 'ready'}>Submit answer</Button>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Answer saved.</p>
          )}
          {response?.status === 'UPLOADED' && <Button variant="secondary" onClick={nextQuestion}>Next question</Button>}
        </div>
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={onAdvance} busy={parentBusy} disabled={answered === 0}>Finish free test</Button>
      </div>
    </Card>
  );
}

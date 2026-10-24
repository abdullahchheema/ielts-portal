'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useContinuousRecorder } from '@/lib/use-continuous-recorder';

interface SpeakingQuestion { id: string; part: string; prompt: string }
interface AnswerMarker { part: string; questionId: string; promptText: string; startSec: number; endSec: number }

type Phase =
  | { name: 'INTRO'; part: 'PART1' | 'PART2' | 'PART3' }
  | { name: 'COUNTDOWN'; part: 'PART1' | 'PART3'; remaining: number }
  | { name: 'PREP'; remaining: number }
  | { name: 'RECORDING'; part: 'PART1' | 'PART2' | 'PART3'; qIndex: number; prepDone: boolean }
  | { name: 'UPLOADING' }
  | { name: 'DONE' };

const PART1_COUNT = 3;
const PART2_PREP_SEC = 60;
const PART2_MAX_SEC = 120;
const PART3_COUNT = 3;
const COUNTDOWN_SEC = 5;

export function SimulatorSpeaking({ attemptId, onFinish }: { attemptId: string; onFinish: () => void }) {
  const rec = useContinuousRecorder();
  const [phase, setPhase] = useState<Phase>({ name: 'INTRO', part: 'PART1' });
  const [answers, setAnswers] = useState<AnswerMarker[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const p1q = useQuery({ queryKey: ['speaking-q-part1'], queryFn: () => api<SpeakingQuestion[]>('/speaking/questions?part=PART1') });
  const p2q = useQuery({ queryKey: ['speaking-q-part2'], queryFn: () => api<SpeakingQuestion[]>('/speaking/questions?part=PART2') });
  const p3q = useQuery({ queryKey: ['speaking-q-part3'], queryFn: () => api<SpeakingQuestion[]>('/speaking/questions?part=PART3') });

  const part1Qs = (p1q.data ?? []).slice(0, PART1_COUNT);
  const part2Q = (p2q.data ?? [])[0] ?? null;
  const part3Qs = (p3q.data ?? []).slice(0, PART3_COUNT);

  const answerStartRef = useRef<number>(0);

  // Countdown tick
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    if (phase.name !== 'COUNTDOWN' && !(phase.name === 'PREP')) return;
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase.name, countdown]);

  // Countdown finished → begin recording
  useEffect(() => {
    if (countdown !== 0) return;
    if (phase.name === 'COUNTDOWN') {
      answerStartRef.current = rec.elapsedSec;
      if (rec.state === 'paused') rec.resume();
      setPhase({ name: 'RECORDING', part: phase.part, qIndex: 0, prepDone: true });
    } else if (phase.name === 'PREP') {
      answerStartRef.current = rec.elapsedSec;
      if (rec.state === 'paused') rec.resume();
      setPhase((p) => p.name === 'PREP' ? { name: 'RECORDING', part: 'PART2', qIndex: 0, prepDone: true } : p);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  // Part 2 max time limit
  useEffect(() => {
    if (phase.name !== 'RECORDING' || phase.part !== 'PART2') return;
    const t = setTimeout(() => advancePart2(), PART2_MAX_SEC * 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.name === 'RECORDING' && (phase as { part: string }).part === 'PART2' ? 'active' : 'inactive']);

  function beginCountdown(part: 'PART1' | 'PART3') {
    if (rec.state === 'recording') rec.pause();
    setCountdown(COUNTDOWN_SEC);
    setPhase({ name: 'COUNTDOWN', part, remaining: COUNTDOWN_SEC });
  }

  async function startPart1() {
    await rec.start();
    if (rec.state !== 'recording' && rec.state !== 'requesting') return; // mic denied, error shown
    beginCountdown('PART1');
  }

  function nextQuestion(part: 'PART1' | 'PART3', currentQIndex: number, questions: SpeakingQuestion[]) {
    const q = questions[currentQIndex];
    if (q) {
      setAnswers((a) => [...a, { part: `PART${part === 'PART1' ? 1 : 3}`, questionId: q.id, promptText: q.prompt, startSec: answerStartRef.current, endSec: rec.elapsedSec }]);
    }
    const nextIdx = currentQIndex + 1;
    if (nextIdx < questions.length) {
      rec.pause();
      beginCountdown(part);
      setTimeout(() => setPhase({ name: 'RECORDING', part, qIndex: nextIdx, prepDone: false }), 0);
    } else {
      rec.pause();
      setPhase({ name: 'INTRO', part: part === 'PART1' ? 'PART2' : 'PART3' });
    }
  }

  function startPart2() {
    rec.resume();
    setCountdown(PART2_PREP_SEC);
    setPhase({ name: 'PREP', remaining: PART2_PREP_SEC });
  }

  function advancePart2() {
    if (part2Q) {
      setAnswers((a) => [...a, { part: 'PART2', questionId: part2Q.id, promptText: part2Q.prompt, startSec: answerStartRef.current, endSec: rec.elapsedSec }]);
    }
    rec.pause();
    setPhase({ name: 'INTRO', part: 'PART3' });
  }

  function startPart3() {
    beginCountdown('PART3');
  }

  function nextQuestionPart3(currentQIndex: number) {
    nextQuestion('PART3', currentQIndex, part3Qs);
  }

  async function finishTest(lastQIndex: number) {
    const q = part3Qs[lastQIndex];
    if (q) {
      setAnswers((a) => [...a, { part: 'PART3', questionId: q.id, promptText: q.prompt, startSec: answerStartRef.current, endSec: rec.elapsedSec }]);
    }
    rec.stop();
    setPhase({ name: 'UPLOADING' });
  }

  // Upload when blob becomes ready after stop()
  useEffect(() => {
    if (phase.name !== 'UPLOADING' || rec.state !== 'ready' || !rec.blob) return;
    (async () => {
      setUploadError(null);
      try {
        const form = new FormData();
        form.append('file', rec.blob!, 'speaking.webm');
        form.append('answers', JSON.stringify(answers));
        await fetch(`/api/speaking/attempts/${attemptId}/full-recording`, { method: 'POST', body: form });
        setPhase({ name: 'DONE' });
      } catch (e) {
        setUploadError(errorMessage(e));
        setPhase({ name: 'INTRO', part: 'PART1' });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.name, rec.state, rec.blob]);

  if (p1q.isLoading || p2q.isLoading || p3q.isLoading) return <Loading />;
  if (uploadError) return <Alert>{uploadError}</Alert>;
  if (rec.error) return <Alert>Microphone error: {rec.error}</Alert>;

  if (phase.name === 'DONE') {
    return (
      <Card className="max-w-2xl space-y-4">
        <p className="font-semibold text-fg">Speaking test complete!</p>
        <p className="text-sm text-fg-muted">Your recording has been uploaded and will be evaluated shortly.</p>
        <Button onClick={onFinish}>Finish simulator</Button>
      </Card>
    );
  }

  if (phase.name === 'UPLOADING') {
    return <Card className="max-w-2xl space-y-3"><Loading /><p className="text-sm text-fg-muted">Uploading your recording…</p></Card>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      <RecordingBar elapsedSec={rec.elapsedSec} state={rec.state} />

      {phase.name === 'INTRO' && phase.part === 'PART1' && (
        <PartIntro
          title="Part 1 — Introduction and interview"
          description={`You will answer ${PART1_COUNT} questions about familiar topics. For each question, you have ${COUNTDOWN_SEC} seconds to prepare, then recording starts automatically.`}
          button="Start Part 1"
          onStart={startPart1}
        />
      )}

      {phase.name === 'INTRO' && phase.part === 'PART2' && (
        <PartIntro
          title="Part 2 — Individual long turn"
          description={`You will have ${PART2_PREP_SEC} seconds to prepare, then up to ${PART2_MAX_SEC / 60} minutes to speak on the topic below. Click "Start Part 2" when ready.`}
          subContent={part2Q ? <p className="mt-2 rounded-md bg-surface-muted p-3 text-sm font-medium text-fg">{part2Q.prompt}</p> : undefined}
          button="Start Part 2"
          onStart={startPart2}
        />
      )}

      {phase.name === 'INTRO' && phase.part === 'PART3' && (
        <PartIntro
          title="Part 3 — Two-way discussion"
          description={`You will answer ${PART3_COUNT} more questions. Same format as Part 1 — ${COUNTDOWN_SEC} seconds prep, then automatic recording.`}
          button="Start Part 3"
          onStart={startPart3}
        />
      )}

      {phase.name === 'COUNTDOWN' && (
        <Card className="space-y-3">
          <p className="text-sm text-fg-muted">Get ready to answer…</p>
          <p className="font-display text-5xl font-bold text-primary">{countdown}</p>
          <p className="text-xs text-fg-subtle">Recording begins automatically when countdown ends.</p>
        </Card>
      )}

      {phase.name === 'PREP' && (
        <Card className="space-y-3">
          <p className="text-sm font-medium text-fg-muted">Preparation time</p>
          <p className="font-display text-5xl font-bold text-primary">{countdown}</p>
          {part2Q && <p className="text-sm text-fg">{part2Q.prompt}</p>}
          <p className="text-xs text-fg-subtle">Recording begins automatically when preparation time ends.</p>
        </Card>
      )}

      {phase.name === 'RECORDING' && phase.part === 'PART1' && (() => {
        const q = part1Qs[phase.qIndex];
        return q ? (
          <Card className="space-y-4">
            <p className="text-xs text-fg-muted uppercase tracking-wide">Part 1 · Question {phase.qIndex + 1} of {PART1_COUNT}</p>
            <p className="text-base font-medium text-fg">{q.prompt}</p>
            <div className="flex justify-end">
              {phase.qIndex < PART1_COUNT - 1
                ? <Button onClick={() => nextQuestion('PART1', phase.qIndex, part1Qs)}>Next question</Button>
                : <Button onClick={() => nextQuestion('PART1', phase.qIndex, part1Qs)}>Next part →</Button>}
            </div>
          </Card>
        ) : null;
      })()}

      {phase.name === 'RECORDING' && phase.part === 'PART2' && (() => {
        return part2Q ? (
          <Card className="space-y-4">
            <p className="text-xs text-fg-muted uppercase tracking-wide">Part 2 — speak for up to 2 minutes</p>
            <p className="text-base font-medium text-fg">{part2Q.prompt}</p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={advancePart2}>Finish speaking →</Button>
            </div>
          </Card>
        ) : null;
      })()}

      {phase.name === 'RECORDING' && phase.part === 'PART3' && (() => {
        const q = part3Qs[phase.qIndex];
        return q ? (
          <Card className="space-y-4">
            <p className="text-xs text-fg-muted uppercase tracking-wide">Part 3 · Question {phase.qIndex + 1} of {PART3_COUNT}</p>
            <p className="text-base font-medium text-fg">{q.prompt}</p>
            <div className="flex justify-end">
              {phase.qIndex < PART3_COUNT - 1
                ? <Button onClick={() => nextQuestionPart3(phase.qIndex)}>Next question</Button>
                : <Button onClick={() => finishTest(phase.qIndex)}>Finish test</Button>}
            </div>
          </Card>
        ) : null;
      })()}
    </div>
  );
}

function PartIntro({ title, description, subContent, button, onStart }: { title: string; description: string; subContent?: React.ReactNode; button: string; onStart: () => void }) {
  return (
    <Card className="space-y-3">
      <h3 className="font-semibold text-fg">{title}</h3>
      <p className="text-sm text-fg-muted">{description}</p>
      {subContent}
      <div className="flex justify-end"><Button onClick={onStart}>{button}</Button></div>
    </Card>
  );
}

function RecordingBar({ elapsedSec, state }: { elapsedSec: number; state: string }) {
  if (state === 'idle' || state === 'requesting') return null;
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return (
    <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${state === 'recording' ? 'bg-danger-soft text-danger' : 'bg-surface-muted text-fg-muted'}`}>
      <span className={`h-2 w-2 rounded-full ${state === 'recording' ? 'animate-pulse bg-danger' : 'bg-fg-muted'}`} />
      <span>{state === 'recording' ? 'Recording' : 'Paused'} — {m}:{String(s).padStart(2, '0')}</span>
    </div>
  );
}

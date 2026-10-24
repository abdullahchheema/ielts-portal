import { useCallback, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'paused' | 'ready' | 'error';

export interface ContinuousRecorder {
  state: RecorderState;
  error: string | null;
  elapsedSec: number;
  blob: Blob | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
}

/** Pause/resume MediaRecorder that produces a single blob at stop(). Elapsed time excludes paused periods. */
export function useContinuousRecorder(): ContinuousRecorder {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef<number | null>(null);
  const pausedAt = useRef<number | null>(null);
  const accumulatedMs = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const tickTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      if (startedAt.current === null) return;
      const now = Date.now();
      setElapsedSec(Math.floor((accumulatedMs.current + (now - startedAt.current)) / 1000));
    }, 500);
  }, []);

  const start = useCallback(async () => {
    setState('requesting'); setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: getSupportedMime() });
      mr.current = rec;
      chunks.current = [];
      accumulatedMs.current = 0;
      startedAt.current = Date.now();
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const final = new Blob(chunks.current, { type: rec.mimeType });
        setBlob(final);
        setState('ready');
        clearTimer();
      };
      rec.start(1000);
      setState('recording');
      tickTimer();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not access microphone.');
      setState('error');
    }
  }, [tickTimer]);

  const pause = useCallback(() => {
    if (mr.current?.state === 'recording') {
      mr.current.pause();
      pausedAt.current = Date.now();
      if (startedAt.current) { accumulatedMs.current += Date.now() - startedAt.current; startedAt.current = null; }
      clearTimer();
      setState('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (mr.current?.state === 'paused') {
      mr.current.resume();
      pausedAt.current = null;
      startedAt.current = Date.now();
      tickTimer();
      setState('recording');
    }
  }, [tickTimer]);

  const stop = useCallback(() => {
    if (mr.current && mr.current.state !== 'inactive') {
      if (startedAt.current) { accumulatedMs.current += Date.now() - startedAt.current; startedAt.current = null; }
      mr.current.stop();
      clearTimer();
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    if (mr.current && mr.current.state !== 'inactive') {
      mr.current.stream?.getTracks().forEach((t) => t.stop());
      mr.current.stop();
    }
    mr.current = null; chunks.current = []; accumulatedMs.current = 0; startedAt.current = null; pausedAt.current = null;
    setBlob(null); setElapsedSec(0); setState('idle'); setError(null);
  }, []);

  return { state, error, elapsedSec, blob, start, pause, resume, stop, reset };
}

function getSupportedMime(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

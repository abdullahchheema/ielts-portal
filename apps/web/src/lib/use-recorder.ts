'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

/**
 * Browser audio recorder. The state machine is a pure reducer so its transitions can be tested
 * without a microphone. The hook owns the MediaStream and always releases its tracks.
 */
export type RecorderState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'ready'; blob: Blob; url: string; durationSec: number }
  | { kind: 'error'; message: string };

export type RecorderEvent =
  | { type: 'REQUEST' }
  | { type: 'STARTED'; startedAt: number }
  | { type: 'STOPPED'; blob: Blob; url: string; durationSec: number }
  | { type: 'FAILED'; message: string }
  | { type: 'RESET' }
  | { type: 'FILE_CHOSEN'; blob: Blob; url: string };

export const initialRecorderState: RecorderState = { kind: 'idle' };

/** Only these transitions are allowed; anything else leaves the state unchanged. */
export function recorderReducer(state: RecorderState, event: RecorderEvent): RecorderState {
  switch (event.type) {
    case 'REQUEST':
      return state.kind === 'recording' || state.kind === 'requesting' ? state : { kind: 'requesting' };
    case 'STARTED':
      return state.kind === 'requesting' ? { kind: 'recording', startedAt: event.startedAt } : state;
    case 'STOPPED':
      return state.kind === 'recording' ? { kind: 'ready', blob: event.blob, url: event.url, durationSec: event.durationSec } : state;
    case 'FILE_CHOSEN':
      return state.kind === 'recording' || state.kind === 'requesting' ? state : { kind: 'ready', blob: event.blob, url: event.url, durationSec: 0 };
    case 'FAILED':
      return { kind: 'error', message: event.message };
    case 'RESET':
      return { kind: 'idle' };
  }
}

/** Elapsed whole seconds since the recording started. */
export const elapsedSeconds = (startedAt: number, now: number) => Math.max(0, Math.floor((now - startedAt) / 1000));

/** File extension for an audio MIME type, as the grading endpoint expects. */
export function extensionFor(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

export function useRecorder(opts: { maxSeconds?: number } = {}) {
  const [state, dispatch] = useReducer(recorderReducer, initialRecorderState);
  const [now, setNow] = useState(Date.now());
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const urlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  // Revoke object URLs and release the microphone when the component goes away.
  useEffect(() => () => {
    release();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, [release]);

  // Tick once a second while recording, for the timer display.
  useEffect(() => {
    if (state.kind !== 'recording') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  const keep = useCallback((blob: Blob, durationSec: number) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    return { blob, url, durationSec };
  }, []);

  const start = useCallback(async () => {
    dispatch({ type: 'REQUEST' });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mr = new MediaRecorder(s);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      const startedAt = Date.now();
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
        const kept = keep(blob, elapsedSeconds(startedAt, Date.now()));
        release();
        dispatch({ type: 'STOPPED', ...kept });
      };
      recorder.current = mr;
      mr.start();
      dispatch({ type: 'STARTED', startedAt });
      setNow(startedAt);
    } catch {
      release();
      dispatch({ type: 'FAILED', message: 'We could not access your microphone. Allow microphone access, or upload a recording instead.' });
    }
  }, [keep, release]);

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }, []);

  const chooseFile = useCallback((file: File) => {
    const kept = keep(file, 0);
    dispatch({ type: 'FILE_CHOSEN', blob: kept.blob, url: kept.url });
  }, [keep]);

  const reset = useCallback(() => {
    release();
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    dispatch({ type: 'RESET' });
  }, [release]);

  const elapsed = state.kind === 'recording' ? elapsedSeconds(state.startedAt, now) : 0;
  const atLimit = opts.maxSeconds !== undefined && state.kind === 'recording' && elapsed >= opts.maxSeconds;
  useEffect(() => { if (atLimit) stop(); }, [atLimit, stop]);

  return { state, elapsed, start, stop, chooseFile, reset };
}

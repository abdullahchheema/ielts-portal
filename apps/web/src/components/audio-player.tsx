'use client';

import { Play, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * A one-play listening player, matching the real IELTS rule: once started, the recording just plays
 * straight through — no pause, rewind, fast-forward, seek, or replay, in-app or after a refresh.
 * `playable=false` (the attempt's `audioPlayedAt` is already set server-side) renders a locked state
 * with no play control at all, covering the "refresh to replay" hole a client-only flag couldn't.
 */
export function AudioPlayer({ src, label, playable, onFirstPlay }: { src: string; label?: string; playable: boolean; onFirstPlay?: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => setDuration(el.duration || 0);
    const onEnd = () => setEnded(true);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, []);

  function start() {
    const el = ref.current;
    if (!el || started || !playable) return;
    setStarted(true);
    if (!firedRef.current) { firedRef.current = true; onFirstPlay?.(); }
    void el.play();
  }

  const locked = !playable || ended;

  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-medium text-fg-muted">{label}</p>}
      <audio ref={ref} src={src} preload="metadata" className="hidden" />
      <div className="flex items-center gap-3">
        {!started ? (
          <button
            type="button" onClick={start} disabled={locked}
            aria-label="Play — it plays once, start to finish, with no pause or rewind"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-fg hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle"
          >
            <Play className="size-5 translate-x-0.5" />
          </button>
        ) : (
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary" aria-hidden>
            <Volume2 className="size-5" />
          </span>
        )}
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-fg-muted">{fmt(current)}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: duration ? `${Math.min(100, (current / duration) * 100)}%` : '0%' }} />
        </div>
        <span className="w-10 shrink-0 text-xs tabular-nums text-fg-muted">{duration ? fmt(duration) : '--:--'}</span>
      </div>
      <p className="text-xs text-fg-subtle">
        {locked && !started ? 'Already played — it only plays once, just like the real test.'
          : started && !ended ? 'Playing — no pause, rewind or skip, just like the real test.'
          : ended ? 'Finished playing.'
          : 'Plays once, start to finish — no pause, rewind or skip once started.'}
      </p>
    </div>
  );
}

'use client';

import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/cx';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * A custom-controlled player wrapping the native <audio> element. Built after student feedback that
 * the bare native controls felt unresponsive on mobile ("doesn't go forward, backward, or stop") —
 * explicit, larger play/pause and ±10s skip buttons plus a seek bar give more reliable control than
 * relying on the browser's own (small, platform-inconsistent) scrubber.
 */
export function AudioPlayer({ src, label }: { src: string; label?: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => setDuration(el.duration || 0);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
    };
  }, []);

  const skip = (delta: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, el.currentTime + delta), duration || el.currentTime + delta);
  };
  const seek = (t: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = t;
    setCurrent(t);
  };

  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-medium text-fg-muted">{label}</p>}
      <audio ref={ref} src={src} preload="metadata" className="hidden" />
      <div className="flex items-center gap-3">
        <button
          type="button" onClick={() => skip(-10)} aria-label="Back 10 seconds"
          className="grid size-9 shrink-0 place-items-center rounded-full ring-1 ring-inset ring-border-strong text-fg-muted hover:bg-surface-muted"
        >
          <RotateCcw className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => { const el = ref.current; if (!el) return; if (playing) el.pause(); else void el.play(); }}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-fg hover:bg-primary-hover"
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-0.5" />}
        </button>
        <button
          type="button" onClick={() => skip(10)} aria-label="Forward 10 seconds"
          className="grid size-9 shrink-0 place-items-center rounded-full ring-1 ring-inset ring-border-strong text-fg-muted hover:bg-surface-muted"
        >
          <RotateCw className="size-4" />
        </button>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-fg-muted">{fmt(current)}</span>
        <input
          type="range" min={0} max={duration || 0} step={0.1} value={Math.min(current, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          className={cx('h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-muted accent-primary')}
        />
        <span className="w-10 shrink-0 text-xs tabular-nums text-fg-muted">{duration ? fmt(duration) : '--:--'}</span>
      </div>
    </div>
  );
}

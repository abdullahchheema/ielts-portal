'use client';

import { useState } from 'react';
import { Field, Input } from '@/components/ui';
import { listeningBand, readingBand } from '@/lib/bandScore';

function parseRaw(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(40, n));
}

/** Free, no-signup raw-score → band converter for Listening and Reading. */
export function BandScoreCalculator() {
  const [listening, setListening] = useState('');
  const [reading, setReading] = useState('');

  const lRaw = parseRaw(listening);
  const rRaw = parseRaw(reading);
  const lBand = lRaw !== null ? listeningBand(lRaw) : null;
  const rBand = rRaw !== null ? readingBand(rRaw) : null;
  const avg = lBand !== null && rBand !== null ? Math.round(((lBand + rBand) / 2) * 2) / 2 : null;

  return (
    <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-border sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Listening raw score (0–40)">
          {(p) => <Input {...p} type="number" min={0} max={40} inputMode="numeric" placeholder="e.g. 32" value={listening} onChange={(e) => setListening(e.target.value)} />}
        </Field>
        <Field label="Reading raw score (0–40)">
          {(p) => <Input {...p} type="number" min={0} max={40} inputMode="numeric" placeholder="e.g. 28" value={reading} onChange={(e) => setReading(e.target.value)} />}
        </Field>
      </div>

      <div className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-3">
        <div className="rounded-lg bg-canvas p-4 text-center ring-1 ring-border">
          <p className="text-xs font-medium text-fg-subtle">Listening band</p>
          <p className="mt-1 font-display text-2xl font-bold text-fg">{lBand ?? '—'}</p>
        </div>
        <div className="rounded-lg bg-canvas p-4 text-center ring-1 ring-border">
          <p className="text-xs font-medium text-fg-subtle">Reading band</p>
          <p className="mt-1 font-display text-2xl font-bold text-fg">{rBand ?? '—'}</p>
        </div>
        <div className="rounded-lg bg-primary-soft p-4 text-center ring-1 ring-primary/20">
          <p className="text-xs font-medium text-primary">Average of the two</p>
          <p className="mt-1 font-display text-2xl font-bold text-primary">{avg ?? '—'}</p>
        </div>
      </div>
      <p className="mt-4 text-xs text-fg-subtle">
        Estimates only, from a commonly published conversion table. Your actual overall band also includes Writing and Speaking, and official scoring can vary slightly between test versions.
      </p>
    </div>
  );
}

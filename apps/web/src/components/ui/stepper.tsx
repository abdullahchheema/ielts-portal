'use client';

import { Check } from 'lucide-react';
import { cx } from '@/lib/cx';

export interface StepDef { key: string; label: string }

/** Horizontal progress stepper: done steps get a check, the current step is emphasised, future steps are dimmed. */
export function Stepper({ steps, activeIndex }: { steps: StepDef[]; activeIndex: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {steps.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-1.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cx(
                  'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-inset transition-colors duration-150 ease-out-soft',
                  done ? 'bg-primary text-primary-fg ring-primary' : active ? 'bg-primary-soft text-primary ring-primary' : 'bg-surface text-fg-subtle ring-border-strong',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={2.25} /> : i + 1}
              </span>
              <span className={cx('hidden text-sm font-medium sm:inline', active ? 'text-fg' : done ? 'text-fg-muted' : 'text-fg-subtle')}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <span aria-hidden className={cx('h-px flex-1', done ? 'bg-primary' : 'bg-border')} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Linear progress bar variant of the same idea, for the one-question-per-screen survey flow. */
export function StepProgress({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-medium text-fg-muted">
        <span>Question {current} of {total}</span>
        <span>{pct}%</span>
      </div>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out-soft" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

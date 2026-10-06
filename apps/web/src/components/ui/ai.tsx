import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Alert } from './feedback';
import { Card } from './display';

/**
 * Every AI-produced number and paragraph goes through these. The label is fixed: an AI estimate must never
 * look like an official IELTS result or a teacher's grade.
 */
export const AI_ESTIMATE_LABEL = 'AI Estimated Score';
export const AI_DISCLAIMER = 'AI estimates are guidance only. They are not an official IELTS result, and they never change your teacher’s grade.';
export const AI_UNAVAILABLE_TEXT = 'AI analysis is temporarily unavailable. Your submission has been saved.';

export function AIInsightCard({ title, children, estimate, footer }: {
  title: string; children: ReactNode; estimate?: string | number | null; footer?: ReactNode;
}) {
  return (
    <Card className="space-y-3 border-accent/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" aria-hidden />
          <h3 className="font-semibold text-fg">{title}</h3>
        </div>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">AI</span>
      </div>
      {estimate !== undefined && estimate !== null && (
        <p className="text-sm text-fg-muted">
          {AI_ESTIMATE_LABEL}: <span className="font-display text-lg font-semibold tabular-nums text-fg">{estimate}</span>
        </p>
      )}
      <div className="text-sm text-fg">{children}</div>
      <p className="text-xs text-fg-subtle">{AI_DISCLAIMER}</p>
      {footer}
    </Card>
  );
}

/** Shown in place of an AI card when the feature is off or failed. The surrounding page keeps working. */
export function AiUnavailable() {
  return <Alert kind="info">{AI_UNAVAILABLE_TEXT}</Alert>;
}

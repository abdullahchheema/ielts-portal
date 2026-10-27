'use client';

import type { ReactNode } from 'react';
import { Card } from '@/components/ui';
import { cx } from '@/lib/cx';
import { Q, QuestionImages, QuestionInput } from './question-input';

export type ContentBlock =
  | { type: 'heading'; value: string; level?: 2 | 3 | 4 }
  | { type: 'text'; value: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'image'; index: number; alt?: string }
  | { type: 'questions'; from: number; to: number }
  | { type: 'svg'; value: string; alt?: string };

export interface RichImage { url: string; alt?: string }

const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;

/** Splits text on {{N}} placeholders, rendering each as an inline input/select for questions[N-1].
 *  {{N}} is 1-based WITHIN this section; `offset` (the running count of questions in prior sections)
 *  is added only to the displayed number, so a Part 2 {{1}} correctly shows as "11", not "1". */
function InlineSpans({ text, questions, offset, answers, onChange, focusedId }: {
  text: string; questions: Q[]; offset: number; answers: Record<string, unknown>; onChange: (qId: string, v: unknown) => void; focusedId: string | null;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const n = Number(m[1]);
    const q = questions[n - 1];
    if (q) {
      parts.push(
        <span key={`${q.id}-${m.index}`} id={`q-${q.id}`} className={cx('inline-flex scroll-mt-48 items-center gap-1 align-middle', focusedId === q.id && 'rounded-md ring-2 ring-primary ring-offset-1 ring-offset-surface')}>
          <span className="text-xs font-semibold tabular-nums text-fg-muted">{offset + n}</span>
          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => onChange(q.id, v)} compact />
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function RichContent({ blocks, questions, offset, answers, onChange, images, focusedId }: {
  blocks: ContentBlock[]; questions: Q[]; offset: number; answers: Record<string, unknown>;
  onChange: (qId: string, v: unknown) => void; images?: RichImage[]; focusedId: string | null;
}) {
  return (
    <div className="space-y-5">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const Tag = (`h${b.level ?? 3}`) as 'h2' | 'h3' | 'h4';
          return <Tag key={i} className="font-semibold text-fg">{b.value}</Tag>;
        }
        if (b.type === 'text') {
          return <p key={i} className="text-base leading-relaxed text-fg"><InlineSpans text={b.value} questions={questions} offset={offset} answers={answers} onChange={onChange} focusedId={focusedId} /></p>;
        }
        if (b.type === 'table') {
          return (
            <div key={i} className="overflow-x-auto rounded-lg ring-1 ring-border">
              <table className="w-full border-collapse text-base">
                <tbody>
                  {b.rows.map((row, ri) => (
                    <tr key={ri} className={ri > 0 ? 'border-t border-border' : undefined}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-4 py-2.5 align-top">
                          <InlineSpans text={cell} questions={questions} offset={offset} answers={answers} onChange={onChange} focusedId={focusedId} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.type === 'image') {
          const img = images?.[b.index];
          if (!img) return <p key={i} className="text-xs text-fg-muted">Image unavailable.</p>;
          // eslint-disable-next-line @next/next/no-img-element
          return <img key={i} src={img.url} alt={b.alt ?? img.alt ?? ''} className="mx-auto max-h-[70vh] w-full rounded-lg object-contain ring-1 ring-border" />;
        }
        if (b.type === 'svg') {
          return (
            <div key={i} role="img" aria-label={b.alt ?? 'Diagram'}
              className="mx-auto max-w-full overflow-x-auto rounded-lg ring-1 ring-border p-3 [&_svg]:max-h-[70vh] [&_svg]:w-full"
              // SVG content originates from admin-imported files; only admins can import content.
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: b.value }}
            />
          );
        }
        // 'questions': standard interactive cards for MCQ/TFNG/etc. ranges not suited to inline rendering.
        return (
          <ol key={i} className="space-y-4">
            {questions.slice(b.from - 1, b.to).map((q, qi) => (
              <li key={q.id} id={`q-${q.id}`} className="scroll-mt-48">
                <Card className={cx('transition-shadow duration-300', focusedId === q.id && 'shadow-lg ring-2 ring-primary ring-offset-2 ring-offset-surface')}>
                  <p className="mb-3 flex items-start gap-2.5 text-base font-medium text-fg">
                    <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-fg-muted tabular-nums">{offset + b.from + qi}</span>
                    <span>{q.prompt.text}</span>
                  </p>
                  <QuestionImages images={q.images} />
                  <QuestionInput q={q} value={answers[q.id]} onChange={(v) => onChange(q.id, v)} />
                </Card>
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}

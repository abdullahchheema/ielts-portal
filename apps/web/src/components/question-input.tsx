'use client';

export interface QOption { id: string; label: string }
export interface Q { id: string; type: string; prompt: { text: string }; marks: number; options?: QOption[] }
export type QAnswer = { optionIds?: string[]; value?: string; text?: string; blanks?: Record<string, string> };

const TFNG = [['TRUE', 'True'], ['FALSE', 'False'], ['NOT_GIVEN', 'Not given']];
const YNNG = [['YES', 'Yes'], ['NO', 'No'], ['NOT_GIVEN', 'Not given']];

/** Renders the right input for a question's grader type. Shared between the free-test and
 *  authenticated attempt pages, and reused inline (compact variant) by RichContent. */
export function QuestionInput({ q, value, onChange, disabled, compact }: { q: Q; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; compact?: boolean }) {
  const v = (value ?? {}) as QAnswer;

  if (q.type === 'TFNG' || q.type === 'YNNG') {
    return (
      <div role="radiogroup" aria-label={q.prompt.text} className="flex flex-wrap gap-2">
        {(q.type === 'TFNG' ? TFNG : YNNG).map(([val, text]) => (
          <label key={val} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ring-1 ${v.value === val ? 'bg-primary-soft ring-2 ring-primary' : 'ring-border-strong'}`}>
            <input type="radio" className="sr-only" name={q.id} disabled={disabled} checked={v.value === val} onChange={() => onChange({ value: val })} />{text}
          </label>
        ))}
      </div>
    );
  }

  if (q.type === 'COMPLETION') {
    return (
      <input
        aria-label={q.prompt.text} disabled={disabled} maxLength={500} autoComplete="off"
        placeholder={compact ? 'Your answer' : undefined}
        className={compact
          ? 'w-36 rounded-full border-0 bg-surface px-3 py-1 text-sm ring-1 ring-inset ring-border-strong focus:ring-2 focus:ring-primary'
          : 'w-full max-w-sm rounded-md px-3 py-2 text-base ring-1 ring-inset ring-border-strong focus:ring-2 focus:ring-primary'}
        value={v.text ?? ''} onChange={(e) => onChange({ text: e.target.value })}
      />
    );
  }

  // MATCHING with options (e.g. map labelling, matching headings) renders as a dropdown when compact
  // (embedded inline in a table/paragraph) and as a radio-card list otherwise.
  if (q.type === 'MATCHING' && q.options?.length && compact) {
    const chosen = v.optionIds ?? [];
    return (
      <select
        aria-label={q.prompt.text} disabled={disabled} value={chosen[0] ?? ''}
        className="w-28 rounded-full border-0 bg-surface px-2 py-1 text-sm ring-1 ring-inset ring-border-strong focus:ring-2 focus:ring-primary"
        onChange={(e) => onChange({ optionIds: e.target.value ? [e.target.value] : [] })}
      >
        <option value="">—</option>
        {q.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    );
  }

  if (q.options?.length) {
    const multi = q.type === 'MCQ_MULTI';
    const chosen = v.optionIds ?? [];
    return (
      <ul className="space-y-1.5">
        {q.options.map((o) => (
          <li key={o.id}>
            <label className={`flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm ring-1 ${chosen.includes(o.id) ? 'bg-primary-soft ring-2 ring-primary' : 'ring-border'}`}>
              <input type={multi ? 'checkbox' : 'radio'} name={q.id} disabled={disabled} className="mt-0.5" checked={chosen.includes(o.id)}
                onChange={(e) => onChange({ optionIds: multi ? (e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id)) : [o.id] })} />
              {o.label}
            </label>
          </li>
        ))}
        {multi && <li className="text-xs text-fg-muted">Choose all that apply.</li>}
      </ul>
    );
  }

  return <p className="text-xs text-fg-muted">This question type is not supported in this view.</p>;
}

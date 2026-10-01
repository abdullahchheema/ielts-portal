'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui';
import { band, date } from '@/lib/format';

export interface IeltsSummaryLike {
  status?: 'NOT_TAKEN' | 'TAKEN';
  overall?: number | string | null;
  listening?: number | string | null;
  reading?: number | string | null;
  writing?: number | string | null;
  speaking?: number | string | null;
  testDate?: string | Date | null;
  attempts?: number | null;
}

const SKILLS = [
  ['listening', 'Listening'],
  ['reading', 'Reading'],
  ['writing', 'Writing'],
  ['speaking', 'Speaking'],
] as const;

/** Compact badge for table cells: "Not taken" or the overall band. */
export function IeltsBadge({ ielts }: { ielts?: IeltsSummaryLike | null }) {
  if (!ielts || ielts.status !== 'TAKEN') {
    return <Badge status="NOT_TAKEN" tone="slate" text="Not taken" />;
  }
  return <Badge status="TAKEN" tone="blue" text={`Band ${band(ielts.overall)}`} />;
}

/** Fuller summary: badge plus an expandable per-skill breakdown, for detail views. */
export function IeltsSummary({ ielts }: { ielts?: IeltsSummaryLike | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!ielts || ielts.status !== 'TAKEN') {
    return (
      <div>
        <Badge status="NOT_TAKEN" tone="slate" text="Not taken" />
        <p className="mt-1 text-xs text-slate-500">First-time test taker.</p>
      </div>
    );
  }
  const hasSkills = SKILLS.some(([k]) => ielts[k] !== null && ielts[k] !== undefined);
  return (
    <div>
      <div className="flex items-center gap-2">
        <Badge status="TAKEN" tone="blue" text={`Overall band ${band(ielts.overall)}`} />
        {hasSkills && (
          <button type="button" className="text-xs font-medium text-indigo-700 underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide breakdown' : 'Show breakdown'}
          </button>
        )}
      </div>
      {expanded && hasSkills && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {SKILLS.map(([k, label]) => (
            <div key={k}><dt className="text-xs text-slate-500">{label}</dt><dd className="font-medium">{band(ielts[k])}</dd></div>
          ))}
        </dl>
      )}
      <p className="mt-1 text-xs text-slate-500">
        {ielts.testDate ? `Tested ${date(ielts.testDate)}` : 'Test date not provided'}
        {ielts.attempts ? ` · Attempt #${ielts.attempts}` : ''}
      </p>
    </div>
  );
}

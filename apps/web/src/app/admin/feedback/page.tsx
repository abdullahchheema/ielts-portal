'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Card, Empty, Loading, PageHeader, Section, Select, StatCard, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { date, label } from '@/lib/format';

interface Themes { text: string; source: 'AI' | 'RULES' }

interface Npsish { responses: number; promoters: number; passives: number; detractors: number; nps: number | null; responseRate?: number | null; suppressed: boolean }
interface Summary {
  days: number;
  minimumResponses: number;
  overall: Npsish & { responseRate: number | null };
  triggers: (Npsish & { trigger: string })[];
  byBatch: (Npsish & { batchName: string })[];
  trend: { month: string; responses: number; nps: number | null }[];
  themes: { word: string; count: number }[];
  anonymousShare: number | null;
  recent: { score: number; trigger: string; at: string; anonymous: boolean; comments: string[] }[];
}

const WINDOWS = [30, 90, 180, 365] as const;

/** Feedback and NPS. Figures below the minimum sample are withheld, so no one can be identified from a small group. */
export default function FeedbackPage() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(90);
  const q = useQuery({ queryKey: ['admin-feedback', days], queryFn: () => api<Summary>(`/admin/feedback?days=${days}`) });
  const s = q.data;

  return (
    <>
      <PageHeader
        title="Student feedback"
        subtitle="How students rate the academy, and what they say. Scores are withheld below the minimum sample."
        actions={
          <Select aria-label="Time window" value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof WINDOWS)[number])}>
            {WINDOWS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </Select>
        }
      />
      {q.isLoading && <Loading />}
      {q.isError && <Alert>Could not load feedback.</Alert>}
      {s && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="NPS" value={s.overall.nps ?? 'Not enough responses'} />
            <StatCard label="Responses" value={s.overall.responses} />
            <StatCard label="Response rate" value={s.overall.responseRate === null ? '—' : `${s.overall.responseRate}%`} />
            <StatCard label="Sent anonymously" value={s.anonymousShare === null ? '—' : `${s.anonymousShare}%`} />
          </div>
          {s.overall.suppressed && <p className="mt-2 text-xs text-fg-subtle">A score appears once there are {s.minimumResponses} responses in the period.</p>}

          <Section title="By survey">
            <Table head={['Survey', 'Responses', 'Promoters', 'Detractors', 'NPS']}>
              {s.triggers.map((t) => (
                <tr key={t.trigger}>
                  <Td>{label(t.trigger)}</Td>
                  <Td>{t.responses}</Td>
                  <Td>{t.suppressed ? '—' : t.promoters}</Td>
                  <Td>{t.suppressed ? '—' : t.detractors}</Td>
                  <Td>{t.nps ?? '—'}</Td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="By batch">
            {s.byBatch.length === 0 ? <Empty title="No batch responses in this period" /> : (
              <Table head={['Batch', 'Responses', 'NPS']}>
                {s.byBatch.map((b) => (
                  <tr key={b.batchName}>
                    <Td>{b.batchName}</Td>
                    <Td>{b.responses}</Td>
                    <Td>{b.nps ?? 'Too few to show'}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>

          <Section title="Trend by month">
            {s.trend.length === 0 ? <Empty title="No responses yet" /> : (
              <Table head={['Month', 'Responses', 'NPS']}>
                {s.trend.map((m) => (
                  <tr key={m.month}>
                    <Td>{m.month}</Td>
                    <Td>{m.responses}</Td>
                    <Td>{m.nps ?? 'Too few to show'}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>

          <Section title="Recurring words" description="Words that come up in more than one comment. Filler words are left out.">
            {s.themes.length === 0 ? <Empty title="Not enough comments to show themes" /> : (
              <div className="flex flex-wrap gap-2">
                {s.themes.map((t) => <span key={t.word} className="rounded-full bg-surface-muted px-3 py-1 text-sm text-fg ring-1 ring-border">{t.word} · {t.count}</span>)}
              </div>
            )}
          </Section>

          <ThemesPanel days={days} />

          <Section title="Recent responses">
            {s.recent.length === 0 ? <Empty title="No responses in this period" /> : (
              <ul className="space-y-3">
                {s.recent.map((r, i) => (
                  <li key={i}>
                    <Card className="space-y-1">
                      <p className="text-sm text-fg-muted">
                        Score <span className="font-medium text-fg">{r.score}</span> · {label(r.trigger)} · {date(r.at)}{r.anonymous ? ' · anonymous' : ''}
                      </p>
                      {r.comments.length === 0 ? <p className="text-sm text-fg-subtle">No comment</p> : r.comments.map((c, j) => <p key={j} className="text-sm text-fg">{c}</p>)}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </>
  );
}

/** A plain-language summary of the comment themes. Written by the AI when available; otherwise the recurring words. */
function ThemesPanel({ days }: { days: number }) {
  const [enabled, setEnabled] = useState(false);
  const themes = useQuery({ queryKey: ['admin-feedback-themes', days], queryFn: () => api<Themes>(`/admin/feedback/themes?days=${days}`), enabled });
  return (
    <Section title="Summary of themes" description="Written from the comments, without names. Check it against the responses before acting on it.">
      <Card className="space-y-3">
        {!enabled && <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setEnabled(true)}>Summarise the comments</button>}
        {themes.isLoading && <Loading />}
        {themes.isError && <Alert>Could not summarise the comments.</Alert>}
        {themes.data && (
          <>
            <p className="text-sm text-fg">{themes.data.text}</p>
            <p className="text-xs text-fg-subtle">{themes.data.source === 'AI' ? 'Written by the AI.' : 'Recurring words, because the AI is not available.'}</p>
          </>
        )}
      </Card>
    </Section>
  );
}

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Card_ {
  id: string; status: string; nextReviewAt: string | null; reviewCount: number; correctCount: number; correctRate: number | null;
  item: { word: string; definition: string; partOfSpeech: string | null; example: string | null; synonyms: string[] };
}
interface Mine { due: number; cards: Card_[] }

/** Vocabulary you have saved. Words come back for review on a spacing schedule, so they stick. */
export default function VocabularyPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['vocabulary'], queryFn: () => api<Mine>('/me/vocabulary') });
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const due = data?.cards.filter((c) => c.nextReviewAt && new Date(c.nextReviewAt).getTime() <= Date.now()) ?? [];
  const current = due[0];

  async function answer(correct: boolean) {
    if (!current) return;
    setBusy(true); setError(null);
    try {
      await api(`/me/vocabulary/cards/${current.id}/review`, { method: 'POST', body: { correct } });
      setRevealed(null);
      await qc.invalidateQueries({ queryKey: ['vocabulary'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Vocabulary" subtitle="Words you saved come back for review on a schedule. Save words from your writing feedback and lessons." />
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load your vocabulary.</Alert>}

      {data && (
        <div className="space-y-8">
          <Section title={`Review${data.due ? ` (${data.due} due)` : ''}`}>
            {!current ? <Empty title="Nothing due right now">Come back later, or save more words.</Empty> : (
              <Card className="max-w-xl space-y-4">
                <p className="font-display text-3xl font-semibold text-fg">{current.item.word}</p>
                {revealed === current.id ? (
                  <div className="space-y-2 text-sm">
                    <p className="text-fg">{current.item.definition}</p>
                    {current.item.example && <p className="italic text-fg-muted">“{current.item.example}”</p>}
                    {current.item.synonyms.length > 0 && <p className="text-fg-muted">Synonyms: {current.item.synonyms.join(', ')}</p>}
                    <div className="flex gap-3 pt-2">
                      <Button onClick={() => answer(true)} busy={busy}>I knew it</Button>
                      <Button variant="secondary" onClick={() => answer(false)} busy={busy}>Not yet</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => setRevealed(current.id)}>Show meaning</Button>
                )}
              </Card>
            )}
          </Section>

          <Section title="Your words">
            {data.cards.length === 0 ? <Empty title="No saved words yet">Words suggested from your essays appear here when you save them.</Empty> : (
              <ul className="space-y-2">
                {data.cards.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-fg">{c.item.word}{c.item.partOfSpeech ? <span className="ml-2 text-xs font-normal text-fg-muted">{c.item.partOfSpeech}</span> : null}</p>
                      <p className="text-sm text-fg-muted">{c.item.definition}</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-fg-muted">
                      <Badge status={c.status} />
                      <span>{c.correctRate === null ? 'Not reviewed' : `${Math.round(c.correctRate * 100)}% correct`}</span>
                      <span>Next {date(c.nextReviewAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </>
  );
}

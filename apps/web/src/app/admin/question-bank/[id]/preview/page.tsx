'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Alert, Card, Loading, PageHeader } from '@/components/ui';
import { ContentBlock } from '@/components/rich-content';
import { api } from '@/lib/api';

interface Option { label: string; isCorrect: boolean }
interface QImage { id: string; url: string; altText: string | null }
interface Question {
  id: string; ieltsType: string | null; questionType: string; bankSectionIndex: number | null;
  versions: { prompt: { text: string }; marks: string; answerKey: { value?: string; accepted?: string[] } | null; options: Option[]; images: QImage[] }[];
}
interface StimulusSection { title: string; instructions?: string; passage?: string; audioUrl?: string; images?: QImage[]; contentBlocks?: ContentBlock[] }
interface SetDetail {
  id: string; title: string; skill: string; status: string;
  stimulus: { passage?: string; instructions?: string; audioUrl?: string; sections?: StimulusSection[] } | null;
  images: QImage[]; questions: Question[];
}

const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;

/** Admin-only read-only answer badge for a {{N}} placeholder — shows the correct answer instead of an input. */
function AnswerBadge({ q, n }: { q: Question | undefined; n: number }) {
  const v = q?.versions[0];
  const text = v?.answerKey?.value || (v?.answerKey?.accepted ?? []).join(' / ') || v?.options.find((o) => o.isCorrect)?.label || '—';
  return (
    <span className="inline-flex items-center gap-1 align-middle rounded-md bg-success-soft px-2 py-0.5 text-sm font-medium text-success">
      <span className="text-xs font-semibold tabular-nums">{n}</span>{text}
    </span>
  );
}

function withInlineAnswers(text: string, questions: Question[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const n = Number(m[1]);
    parts.push(<AnswerBadge key={`${n}-${m.index}`} q={questions[n - 1]} n={n} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function ContentBlocksPreview({ blocks, questions }: { blocks: ContentBlock[]; questions: Question[]; images?: QImage[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const Tag = (`h${b.level ?? 3}`) as 'h2' | 'h3' | 'h4';
          return <Tag key={i} className="font-semibold text-fg">{b.value}</Tag>;
        }
        if (b.type === 'text') return <p key={i} className="text-base leading-relaxed">{withInlineAnswers(b.value, questions)}</p>;
        if (b.type === 'table') {
          return (
            <div key={i} className="overflow-x-auto rounded-lg ring-1 ring-border">
              <table className="w-full border-collapse text-base">
                <tbody>
                  {b.rows.map((row, ri) => (
                    <tr key={ri} className={ri > 0 ? 'border-t border-border' : undefined}>
                      {row.map((cell, ci) => <td key={ci} className="px-4 py-2.5 align-top">{withInlineAnswers(cell, questions)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        // 'image' blocks are already rendered as a flat list above the section (same as before contentBlocks existed).
        if (b.type === 'questions') return <ol key={i} className="space-y-4">{questions.slice(b.from - 1, b.to).map((q, qi) => <li key={q.id}><QuestionPreview q={q} index={b.from - 1 + qi} /></li>)}</ol>;
        return null;
      })}
    </div>
  );
}

const TIME_LIMIT: Record<string, string> = { LISTENING: '30 minutes', READING: '60 minutes', WRITING: '60 minutes', SPEAKING: '11-14 minutes' };

function QuestionPreview({ q, index }: { q: Question; index: number }) {
  const v = q.versions[0];
  return (
    <Card className="space-y-2">
      <p className="text-sm font-medium"><span className="mr-2 text-fg-subtle">{index + 1}.</span>{v?.prompt.text}</p>
      {v?.images.map((img) => <img key={img.id} src={img.url} alt={img.altText ?? ''} className="max-h-96 rounded-md ring-1 ring-border" />)}
      {v?.options.length > 0 && (
        <ul className="space-y-1 text-sm">
          {v.options.map((o) => (
            <li key={o.label} className={`rounded-md px-2 py-1 ${o.isCorrect ? 'bg-success-soft font-medium text-success' : 'text-fg-muted'}`}>
              {o.isCorrect ? '✓ ' : '• '}{o.label}
            </li>
          ))}
        </ul>
      )}
      {v?.answerKey && (
        <p className="text-xs text-fg-muted">Answer: {v.answerKey.value ?? (v.answerKey.accepted ?? []).join(' / ')}</p>
      )}
    </Card>
  );
}

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({ queryKey: ['question-set', id], queryFn: () => api<SetDetail>(`/admin/question-sets/${id}`) });

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load this set.</Alert>;

  const sections: (StimulusSection & { questions: Question[] })[] = data.stimulus?.sections?.length
    ? data.stimulus.sections.map((s, i) => ({ ...s, questions: data.questions.filter((q) => q.bankSectionIndex === i) }))
    : [{ title: data.title, passage: data.stimulus?.passage, audioUrl: data.stimulus?.audioUrl, images: data.images, contentBlocks: undefined, questions: data.questions }];

  return (
    <>
      <PageHeader
        title={`Preview — ${data.title}`}
        subtitle="Exactly what a student sees: passage, instructions and audio directly above that passage's own questions, section by section. Correct answers are shown here only — never to students."
        breadcrumbs={[{ href: '/admin/question-bank', label: 'Question bank' }, { href: `/admin/question-bank/${id}`, label: data.title }, { label: 'Preview' }]}
      />
      <Alert kind="info">Status: {data.status} · {data.skill.toLowerCase()} · time limit {TIME_LIMIT[data.skill] ?? 'untimed'}</Alert>

      <div className="mt-6 space-y-8">
        {sections.map((s, i) => (
          <section key={i} aria-labelledby={`s-${i}`}>
            <h2 id={`s-${i}`} className="mb-2 text-lg font-semibold">{s.title}</h2>
            {s.instructions && <p className="mb-3 text-base text-fg-muted">{s.instructions}</p>}
            {s.audioUrl && <audio controls className="mb-4 w-full" src={s.audioUrl} />}
            {s.images?.map((img) => <img key={img.id} src={img.url} alt={img.altText ?? ''} className="mb-4 max-h-96 rounded-md ring-1 ring-border" />)}
            {s.contentBlocks ? (
              <ContentBlocksPreview blocks={s.contentBlocks} questions={s.questions} images={s.images} />
            ) : (
              <div className={s.passage ? 'grid gap-6 lg:grid-cols-2' : ''}>
                {s.passage && <Card className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed lg:sticky lg:top-24">{s.passage}</Card>}
                <ol className="space-y-4">
                  {s.questions.map((q, qi) => <li key={q.id}><QuestionPreview q={q} index={qi} /></li>)}
                </ol>
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

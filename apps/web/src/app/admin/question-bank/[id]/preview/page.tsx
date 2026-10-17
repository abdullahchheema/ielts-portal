'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Alert, Card, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

interface Option { label: string; isCorrect: boolean }
interface QImage { id: string; url: string; altText: string | null }
interface Question {
  id: string; ieltsType: string | null; questionType: string; bankSectionIndex: number | null;
  versions: { prompt: { text: string }; marks: string; answerKey: { value?: string; accepted?: string[] } | null; options: Option[]; images: QImage[] }[];
}
interface StimulusSection { title: string; instructions?: string; passage?: string; audioUrl?: string; images?: QImage[] }
interface SetDetail {
  id: string; title: string; skill: string; status: string;
  stimulus: { passage?: string; instructions?: string; audioUrl?: string; sections?: StimulusSection[] } | null;
  images: QImage[]; questions: Question[];
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
    : [{ title: data.title, passage: data.stimulus?.passage, audioUrl: data.stimulus?.audioUrl, images: data.images, questions: data.questions }];

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
            {s.instructions && <p className="mb-3 text-sm text-fg-muted">{s.instructions}</p>}
            {s.audioUrl && <audio controls className="mb-4 w-full" src={s.audioUrl} />}
            {s.images?.map((img) => <img key={img.id} src={img.url} alt={img.altText ?? ''} className="mb-4 max-h-96 rounded-md ring-1 ring-border" />)}
            <div className={s.passage ? 'grid gap-6 lg:grid-cols-2' : ''}>
              {s.passage && <Card className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed lg:sticky lg:top-24">{s.passage}</Card>}
              <ol className="space-y-4">
                {s.questions.map((q, qi) => <li key={q.id}><QuestionPreview q={q} index={qi} /></li>)}
              </ol>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

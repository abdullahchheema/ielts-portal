'use client';

import { Badge, Card, PageHeader } from '@/components/ui';

const FEATURES = [
  { title: 'Writing feedback', text: 'Instant AI feedback on your Task 1 and Task 2 drafts, before your teacher grades the final version.' },
  { title: 'Speaking practice', text: 'Practise Part 1, 2 and 3 questions and get pronunciation and fluency hints.' },
  { title: 'Personalised revision', text: 'Extra questions chosen from the mistakes you make most often.' },
];

export default function AiPracticePage() {
  return (
    <>
      <PageHeader title="AI Practice" subtitle="AI-powered practice will sit alongside your teacher-led classes." actions={<Badge status="DRAFT" tone="purple" text="Coming soon" />} />
      <div className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((f) => <Card key={f.title}><h2 className="mb-1 font-semibold text-slate-900">{f.title}</h2><p className="text-sm text-slate-600">{f.text}</p></Card>)}
      </div>
      <p className="mt-6 text-sm text-slate-500">This area is a placeholder for now. Teacher-graded Writing and Speaking tasks are already available in their own sections.</p>
    </>
  );
}

'use client';

import { Badge, Card, PageHeader } from '@/components/ui';

const FEATURES = [
  { title: 'Organised by class', text: 'Recordings grouped by batch, class date, module and topic, with search and filters.' },
  { title: 'Linked to the lesson', text: 'Each recording will connect back to the related lesson and any homework set after that class.' },
  { title: 'Only what you are authorised to see', text: 'Published recordings for the batches and classes you were enrolled in — nothing else.' },
];

export default function RecordingsPage() {
  return (
    <>
      <PageHeader title="Class Recordings" subtitle="Previously recorded classes, once your teacher has published them." actions={<Badge status="DRAFT" tone="purple" text="Coming soon" />} />
      <div className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((f) => <Card key={f.title}><h2 className="mb-1 font-semibold text-slate-900">{f.title}</h2><p className="text-sm text-slate-600">{f.text}</p></Card>)}
      </div>
      <p className="mt-6 text-sm text-slate-500">This area is a placeholder for now. Your Class Schedule already links to a recording once one is available for a past class.</p>
    </>
  );
}

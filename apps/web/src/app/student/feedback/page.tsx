'use client';

import Link from 'next/link';
import { Badge, Card, PageHeader } from '@/components/ui';

const FEATURES = [
  { title: 'Writing history', text: 'Every essay and letter you have submitted, its criterion-level feedback, and how your rewrite compared to the original.' },
  { title: 'Speaking history', text: 'Your recordings, transcripts where available, and mentor comments against each criterion.' },
  { title: 'One place for mentor feedback', text: 'All of your teacher’s comments, across both modules, searchable and linked back to the related lesson.' },
];

export default function FeedbackHistoryPage() {
  return (
    <>
      <PageHeader title="Feedback & History" subtitle="Your writing and speaking submissions and the feedback they received, in one place." actions={<Badge status="DRAFT" tone="purple" text="Coming soon" />} />
      <div className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((f) => <Card key={f.title}><h2 className="mb-1 font-semibold text-slate-900">{f.title}</h2><p className="text-sm text-slate-600">{f.text}</p></Card>)}
      </div>
      <p className="mt-6 text-sm text-slate-500">
        This consolidated view is a placeholder for now. Your actual writing submissions and feedback are already available from <Link href="/student/writing" className="text-indigo-700 hover:underline">Writing</Link> and <Link href="/student/speaking" className="text-indigo-700 hover:underline">Speaking</Link>, or by opening a submission directly from Progress.
      </p>
    </>
  );
}

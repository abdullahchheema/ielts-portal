'use client';

import { Badge, Card, PageHeader } from '@/components/ui';

const FEATURES = [
  { title: 'Why am I struggling?', text: 'Patterns drawn from your real attempts — for example, accuracy dropping on later reading passages, or one question type producing repeated errors.' },
  { title: 'Evidence, not guesses', text: 'Every insight will link to the attempts and time period behind it, with an action to practise the exact weak spot.' },
  { title: 'Honest when data is thin', text: 'With too little history to support a finding, this page will say so plainly rather than inventing a pattern.' },
];

export default function InsightsPage() {
  return (
    <>
      <PageHeader title="Insights" subtitle="Progress shows where you are. Insights explains why, and what to do next." actions={<Badge status="DRAFT" tone="purple" text="Coming soon" />} />
      <div className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((f) => <Card key={f.title}><h2 className="mb-1 font-semibold text-slate-900">{f.title}</h2><p className="text-sm text-slate-600">{f.text}</p></Card>)}
      </div>
      <p className="mt-6 text-sm text-slate-500">This area is a placeholder for now — in the meantime, see Progress for your real scores and Skill States, and Today for personalised recommendations already drawn from your attempt history.</p>
    </>
  );
}

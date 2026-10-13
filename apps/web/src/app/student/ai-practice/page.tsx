'use client';

import { Sparkles } from 'lucide-react';
import { Badge, CardList, CardListItem, Empty, LinkButton, PageHeader, Section } from '@/components/ui';

const FEATURES = [
  { title: 'Writing feedback', text: 'Instant AI feedback on your Task 1 and Task 2 drafts, before your teacher grades the final version.' },
  { title: 'Speaking practice', text: 'Practise Part 1, 2 and 3 questions and get pronunciation and fluency hints.' },
  { title: 'Personalised revision', text: 'Extra questions chosen from the mistakes you make most often.' },
];

export default function AiPracticePage() {
  return (
    <>
      <PageHeader title="AI Practice" subtitle="AI-powered practice will sit alongside your teacher-led classes." actions={<Badge status="DRAFT" tone="purple" text="Coming soon" />} />

      <Empty icon={Sparkles} title="This area is a placeholder for now" action={
        <div className="flex flex-wrap justify-center gap-2">
          <LinkButton href="/student/writing-ai" variant="secondary">Go to Writing practice</LinkButton>
          <LinkButton href="/student/speaking-ai" variant="secondary">Go to Speaking practice</LinkButton>
        </div>
      }>
        Teacher-graded Writing and Speaking tasks, each with AI feedback, are already available in their own sections.
      </Empty>

      <Section title="What's coming" className="mt-8">
        <CardList>
          {FEATURES.map((f) => (
            <CardListItem key={f.title}
              left={<span className="font-medium text-fg">{f.title}</span>}
              right={<span className="text-sm text-fg-muted">{f.text}</span>}
            />
          ))}
        </CardList>
      </Section>
    </>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHero } from '@/components/public/page-hero';
import { BatchCard, PublicBatch } from '@/components/BatchCard';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { Alert, Empty, Loading, Section } from '@/components/ui';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const batches = useQuery({ queryKey: ['public-batches'], queryFn: () => api<PublicBatch[]>('/public/batches') });
  return (
    <>
      <PublicHeader />
      <main>
        <PageHero
          size="compact"
          eyebrow="Enroll"
          title="Select your batch"
          subtitle={<>Choose the batch you want to join. Next you will create your account and verify your email, then fill in a short form and upload your payment receipt. The academy verifies it and enrolls you. Already applied? <Link href="/login" className="font-bold text-primary underline underline-offset-2">Log in</Link>.</>}
        />
        <div className="mx-auto max-w-6xl px-5 pb-20 sm:px-8 sm:pb-24">
          <Section title="Open batches" description="Every batch teaches the same complete course — pick the schedule that fits your week.">
            {batches.isLoading ? <Loading /> : batches.isError ? <Alert>Could not load the batches. Please refresh the page.</Alert> : !batches.data?.length ? (
              <Empty>No batch is open for enrollment right now. Please check back soon.</Empty>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{batches.data.map((b) => <BatchCard key={b.id} batch={b} />)}</div>
            )}
          </Section>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

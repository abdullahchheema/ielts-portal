'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { BatchCard, PublicBatch } from '@/components/BatchCard';
import { PublicHeader } from '@/components/PublicHeader';
import { Alert, Empty, Loading } from '@/components/ui';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const batches = useQuery({ queryKey: ['public-batches'], queryFn: () => api<PublicBatch[]>('/public/batches') });
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">Select your batch</h1>
        <p className="mb-10 mt-3 max-w-2xl text-base leading-relaxed text-fg-muted">Choose the batch you want to join. Next you will fill in a short form and upload your payment receipt. The academy verifies it and enrolls you. Already applied? <Link href="/login" className="font-medium text-primary underline underline-offset-2">Log in</Link>.</p>
        {batches.isLoading ? <Loading /> : batches.isError ? <Alert>Could not load the batches. Please refresh the page.</Alert> : !batches.data?.length ? (
          <Empty>No batch is open for enrollment right now. Please check back soon.</Empty>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{batches.data.map((b) => <BatchCard key={b.id} batch={b} />)}</div>
        )}
      </main>
    </>
  );
}

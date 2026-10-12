'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui';

/** Shared body for every segment's loading.tsx: a centred spinner-free skeleton band, so route changes never flash a blank page. */
export function PageLoading() {
  return (
    <div className="flex min-h-[50vh] flex-col gap-4 p-6">
      <div className="h-7 w-48 animate-pulse rounded-md bg-surface-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-surface-muted" />)}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface-muted" />
    </div>
  );
}

/** Shared body for every segment's error.tsx. Next requires each boundary to accept (error, reset). */
export function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <span aria-hidden className="grid size-12 place-items-center rounded-full bg-danger-soft text-danger"><TriangleAlert className="size-6" /></span>
      <div>
        <p className="font-display text-lg font-semibold text-fg">Something went wrong</p>
        <p className="mt-1 max-w-sm text-sm text-fg-muted">This page hit an unexpected error. You can try again, or come back later if it keeps happening.</p>
      </div>
      <Button onClick={reset} variant="secondary"><RotateCcw className="size-4" aria-hidden />Try again</Button>
    </div>
  );
}

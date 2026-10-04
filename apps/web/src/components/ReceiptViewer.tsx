'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

export interface Receipt {
  fileUrl?: string | null;
  fileMime?: string | null;
}

/** Shows a payment proof: image preview, embedded PDF, or a friendly fallback with retry. */
export function ReceiptViewer({ fileUrl, fileMime, alt, onRetry }: Receipt & { alt?: string; onRetry?: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  if (!fileUrl || failed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-surface-muted p-8 text-center text-sm text-fg-muted ring-1 ring-border">
        <p>Receipt not available{failed ? ' — the file could not be loaded.' : '.'}</p>
        {failed && <Button variant="secondary" className="!py-1" onClick={() => { setFailed(false); setAttempt((a) => a + 1); onRetry?.(); }}>Retry</Button>}
        {failed && fileUrl && <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline underline-offset-2">Open the file in a new tab</a>}
      </div>
    );
  }

  const isPdf = fileMime === 'application/pdf';
  if (isPdf) {
    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-lg ring-1 ring-border">
          <iframe key={attempt} src={fileUrl} title={alt ?? 'Payment receipt'} className="h-96 w-full bg-surface" />
        </div>
        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline">Open in new tab ↗</a>
      </div>
    );
  }

  return (
    <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg bg-surface-muted ring-1 ring-border" aria-label="Open receipt in a new tab">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={attempt} src={fileUrl} alt={alt ?? 'Payment receipt'} className="max-h-96 w-full object-contain" onError={() => setFailed(true)} />
    </a>
  );
}

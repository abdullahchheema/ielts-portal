'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

export interface Receipt {
  fileUrl?: string | null;
  fileMime?: string | null;
}

/** Shows a payment proof: image preview, embedded PDF, or a friendly fallback with retry. */
export function ReceiptViewer({ fileUrl, fileMime, alt }: Receipt & { alt?: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  if (!fileUrl || failed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-slate-100 p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
        <p>Receipt not available{failed ? ' — the file could not be loaded.' : '.'}</p>
        {failed && <Button variant="secondary" className="!py-1" onClick={() => { setFailed(false); setAttempt((a) => a + 1); }}>Retry</Button>}
      </div>
    );
  }

  const isPdf = fileMime === 'application/pdf';
  if (isPdf) {
    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
          <iframe key={attempt} src={fileUrl} title={alt ?? 'Payment receipt'} className="h-96 w-full bg-white" />
        </div>
        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-700 underline">Open in new tab ↗</a>
      </div>
    );
  }

  return (
    <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200" aria-label="Open receipt in a new tab">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={attempt} src={fileUrl} alt={alt ?? 'Payment receipt'} className="max-h-96 w-full object-contain" onError={() => setFailed(true)} />
    </a>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const LEAD_STORAGE_KEY = 'freeTestLeadId';

export default function FreeTestLandingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedStorage, setCheckedStorage] = useState(false);

  useEffect(() => {
    // Not auto-firing a claim on load: a stray crawler hit on this page must not spawn a ghost
    // student + exam for nothing. We only resume an id the browser already has.
    let existing: string | null = null;
    try { existing = localStorage.getItem(LEAD_STORAGE_KEY); } catch { /* private window etc. */ }
    if (existing) router.replace(`/free-test/${existing}`);
    else setCheckedStorage(true);
  }, [router]);

  async function claim() {
    setBusy(true); setError(null);
    try {
      const res = await api<{ leadId: string }>('/free-test/claim', { method: 'POST' });
      try { localStorage.setItem(LEAD_STORAGE_KEY, res.leadId); } catch { /* private window etc. */ }
      router.push(`/free-test/${res.leadId}`);
    } catch (e) {
      const genericFailure = e instanceof ApiError && (e.code === 'INTERNAL_ERROR' || e.status >= 500);
      setError(genericFailure ? 'That took too long to respond. Please try again.' : errorMessage(e));
    } finally { setBusy(false); }
  }

  if (!checkedStorage) return null;

  return (
    <div className="mx-auto max-w-lg py-16">
      <h1 className="mb-2 font-display text-2xl font-semibold">Take a free IELTS mock test</h1>
      <p className="mb-6 text-sm text-fg-muted">
        No account, no email, no phone number. Start instantly and get your overall score. For a full
        question-by-question breakdown, answer keys, and unlimited practice, register for a paid plan afterward.
      </p>
      <Card>
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Button onClick={claim} busy={busy} className="w-full">Start the free test</Button>
          {busy && <p aria-live="polite" className="text-xs text-fg-muted">Setting up your test — this can take a few seconds the first time.</p>}
          <p className="text-xs text-fg-muted">Your progress is remembered on this device only, for up to 7 days. Starting again on another device begins a new test.</p>
        </div>
      </Card>
    </div>
  );
}

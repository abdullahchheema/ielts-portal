'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function FreeTestLandingPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setBusy(true); setError(null);
    try {
      const res = await api<{ leadId: string }>('/free-test/claim', { method: 'POST', body: { email, phone } });
      router.push(`/free-test/${res.leadId}`);
    } catch (e) {
      // A slow connection can time out before the response arrives even when the claim itself
      // succeeded server-side — claiming again with the same email+phone is safe either way: it
      // resumes the same test instead of starting a second one.
      const genericFailure = e instanceof ApiError && (e.code === 'INTERNAL_ERROR' || e.status >= 500);
      setError(genericFailure ? 'That took too long to respond. Please try again — if your test was already set up, trying again will resume it, not start a new one.' : errorMessage(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-lg py-16">
      <h1 className="mb-2 font-display text-2xl font-semibold">Take a free IELTS mock test</h1>
      <p className="mb-6 text-sm text-fg-muted">
        No account needed. Enter your email and phone to get your overall score instantly. For a full
        question-by-question breakdown, answer keys, and unlimited practice, register for a paid plan afterward.
      </p>
      <Card>
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Email">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />}</Field>
          <Field label="Phone">{(p) => <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03XXXXXXXXX" />}</Field>
          <Button onClick={claim} busy={busy} disabled={!email.trim() || !phone.trim()} className="w-full">Start the free test</Button>
          {busy && <p aria-live="polite" className="text-xs text-fg-muted">Setting up your test — this can take a few seconds the first time.</p>}
          <p className="text-xs text-fg-muted">One free test per person. We use this only to save your progress and prevent duplicate attempts.</p>
        </div>
      </Card>
    </div>
  );
}

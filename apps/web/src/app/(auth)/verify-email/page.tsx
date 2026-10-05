'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

function Verify() {
  const params = useSearchParams();
  const token = params.get('token');
  const next = params.get('next');
  const loginHref = `/login?verified=1${next && next.startsWith('/') && !next.startsWith('//') ? `&next=${encodeURIComponent(next)}` : ''}`;
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  const ran = useRef(false); // strict-mode double effect must not spend the one-time token twice

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) { setState('error'); setMessage('This link is missing its token.'); return; }
    api('/auth/verify-email', { method: 'POST', body: { token }, noRefresh: true })
      .then(() => setState('ok'))
      .catch((e) => { setState('error'); setMessage(errorMessage(e)); });
  }, [token]);

  if (state === 'working') return <Loading />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{state === 'ok' ? 'Email verified' : 'Could not verify'}</h1>
      {state === 'ok' ? <Alert kind="success">Your account is active.</Alert> : <Alert>{message}</Alert>}
      <Link href={loginHref} className="text-sm text-primary hover:underline">Go to log in</Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return <Suspense fallback={<Loading />}><Verify /></Suspense>;
}

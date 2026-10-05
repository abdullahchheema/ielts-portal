'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { RegisterInput, registerSchema } from '@ielts/validation';
import { GoogleSignInButton } from '@/components/AccountGate';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : null);

function CreateAccount() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/register', { method: 'POST', body: { ...values, phone: values.phone || undefined }, noRefresh: true });
      setSentTo(values.email);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_ALREADY_REGISTERED') setError('An account with this email already exists. Log in instead.');
      else setError(errorMessage(e));
    }
  });

  async function resend() {
    if (!sentTo) return;
    await api('/auth/resend-verification', { method: 'POST', body: { email: sentTo }, noRefresh: true }).catch(() => {});
    setResent(true);
  }

  if (sentTo) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-sm text-fg-muted">
          We sent a verification link to <span className="font-medium text-fg">{sentTo}</span>. Open it to activate your account, then log in
          {next ? ' to continue your application' : ''}.
        </p>
        {resent && <Alert kind="success">A new link is on its way.</Alert>}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link href={loginHref} className="font-medium text-primary hover:underline">Go to log in</Link>
          <button type="button" onClick={resend} className="text-primary hover:underline">Resend the link</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="text-sm text-fg-muted">Your account is where you apply, track your application and open your portal.</p>
      {error && <Alert>{error}</Alert>}
      <GoogleSignInButton next={next ?? undefined} />
      <div className="flex items-center gap-3 text-xs text-fg-muted" aria-hidden><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName?.message}>{(p) => <Input {...p} autoComplete="given-name" {...register('firstName')} />}</Field>
        <Field label="Last name" error={errors.lastName?.message}>{(p) => <Input {...p} autoComplete="family-name" {...register('lastName')} />}</Field>
      </div>
      <Field label="Email" error={errors.email?.message}>{(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}</Field>
      <Field label="Phone / WhatsApp" hint="Optional" error={errors.phone?.message}>{(p) => <Input {...p} type="tel" autoComplete="tel" {...register('phone')} />}</Field>
      <Field label="Password" hint="At least 10 characters, with a letter and a number." error={errors.password?.message}>{(p) => <Input {...p} type="password" autoComplete="new-password" {...register('password')} />}</Field>
      <Button type="submit" busy={isSubmitting} className="w-full">Create account</Button>
      <p className="text-sm text-fg-muted">
        Already have an account? <Link href={loginHref} className="font-medium text-primary underline underline-offset-2">Log in</Link>
      </p>
    </form>
  );
}

export default function CreateAccountPage() {
  return <Suspense><CreateAccount /></Suspense>;
}

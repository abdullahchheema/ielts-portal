'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { Me, homeFor } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
  mfaCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code').optional().or(z.literal('')),
});
type Form = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [needMfa, setNeedMfa] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<{ user: Me }>('/auth/login', { method: 'POST', body: { ...values, mfaCode: values.mfaCode || undefined }, noRefresh: true });
      qc.setQueryData(['me'], res.user);
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(res.user));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MFA_REQUIRED') { setNeedMfa(true); setError(null); return; }
      setError(errorMessage(e));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <h1 className="text-xl font-semibold">Log in</h1>
      {error && <Alert>{error}</Alert>}
      {params.get('verified') && <Alert kind="success">Email verified — you can log in now.</Alert>}
      {params.get('reset') && <Alert kind="success">Password updated — log in with your new password.</Alert>}
      <Field label="Email" error={errors.email?.message}>{(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}</Field>
      <Field label="Password" error={errors.password?.message}>{(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}</Field>
      {needMfa && (
        <Field label="Authentication code" hint="From your authenticator app" error={errors.mfaCode?.message}>
          {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus {...register('mfaCode')} />}
        </Field>
      )}
      <Button type="submit" busy={isSubmitting} className="w-full">{needMfa ? 'Verify and log in' : 'Log in'}</Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">Forgot password?</Link>
        <Link href="/register" className="text-primary hover:underline">Join the next batch</Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}

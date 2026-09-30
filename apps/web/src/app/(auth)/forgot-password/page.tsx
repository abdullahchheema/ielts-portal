'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const schema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email') });

export default function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try { await api('/auth/forgot-password', { method: 'POST', body: v, noRefresh: true }); setDone(true); }
    catch (e) { setError(errorMessage(e)); }
  });

  if (done) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-sm text-slate-600">If an account exists for that address, we have sent a link to reset your password.</p>
        <Link href="/login" className="text-sm text-indigo-700 hover:underline">Back to log in</Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      {error && <Alert>{error}</Alert>}
      <Field label="Email" error={errors.email?.message}>{(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}</Field>
      <Button type="submit" busy={isSubmitting} className="w-full">Send reset link</Button>
      <Link href="/login" className="block text-center text-sm text-indigo-700 hover:underline">Back to log in</Link>
    </form>
  );
}

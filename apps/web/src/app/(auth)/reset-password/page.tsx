'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { passwordSchema } from '@ielts/validation';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password: v.password }, noRefresh: true });
      router.replace('/login?reset=1');
    } catch (e) { setError(errorMessage(e)); }
  });

  if (!token) return <Alert>This reset link is missing its token.</Alert>;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {error && <Alert>{error}</Alert>}
      <Field label="New password" hint="At least 10 characters, with a letter and a number" error={errors.password?.message}>{(p) => <Input {...p} type="password" autoComplete="new-password" {...register('password')} />}</Field>
      <Field label="Confirm password" error={errors.confirm?.message}>{(p) => <Input {...p} type="password" autoComplete="new-password" {...register('confirm')} />}</Field>
      <Button type="submit" busy={isSubmitting} className="w-full">Update password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetForm /></Suspense>;
}

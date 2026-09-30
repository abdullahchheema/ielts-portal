'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { NotificationPrefs } from '@/components/NotificationPrefs';

interface Profile { firstName: string; lastName: string; email: string; phone: string | null; city: string | null; currentBand: string | null; targetBand: string | null; ieltsExamDate: string | null; academicOrGeneral: string | null; country: string | null; timezone: string | null }

// Bands are chosen from a list, so the 0.5-step rule can't be broken from the UI.
const BANDS = Array.from({ length: 19 }, (_, i) => (i * 0.5).toFixed(1));
const schema = z.object({
  currentBand: z.string().optional(), targetBand: z.string().optional(), ieltsExamDate: z.string().optional(),
  academicOrGeneral: z.string().optional(), country: z.string().max(80).optional(), city: z.string().max(80).optional(), phone: z.string().max(20).optional(),
});
type Form = z.infer<typeof schema>;

export default function ProfilePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/me/profile') });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (data) reset({
      currentBand: data.currentBand ? Number(data.currentBand).toFixed(1) : '', targetBand: data.targetBand ? Number(data.targetBand).toFixed(1) : '',
      ieltsExamDate: data.ieltsExamDate?.slice(0, 10) ?? '', academicOrGeneral: data.academicOrGeneral ?? '', country: data.country ?? '', city: data.city ?? '', phone: data.phone ?? '',
    });
  }, [data, reset]);

  const save = useMutation({
    mutationFn: (v: Form) => api('/me/profile', {
      method: 'PATCH',
      body: {
        currentBand: v.currentBand ? Number(v.currentBand) : undefined, targetBand: v.targetBand ? Number(v.targetBand) : undefined,
        ieltsExamDate: v.ieltsExamDate || undefined, academicOrGeneral: v.academicOrGeneral || undefined, country: v.country || undefined, city: v.city || undefined, phone: v.phone || undefined,
      },
    }),
    onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: ['profile'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });

  if (isLoading) return <Loading />;
  const onSubmit = handleSubmit(async (v) => {
    setSaved(false); setError(null);
    try { await save.mutateAsync(v); } catch (e) {
      for (const [k, m] of Object.entries(fieldErrors(e))) setFieldError(k as keyof Form, { message: m });
      setError(errorMessage(e));
    }
  });

  return (
    <>
      <PageHeader title="Your profile" subtitle="Keep your details up to date so your teacher can support you." />
      <Card className="max-w-xl">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <Alert>{error}</Alert>}
          {saved && <Alert kind="success">Profile saved.</Alert>}
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700"><p className="font-medium">{data?.firstName} {data?.lastName}</p><p className="text-slate-500">{data?.email}</p></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" error={errors.phone?.message}>{(p) => <Input {...p} type="tel" autoComplete="tel" {...register('phone')} />}</Field>
            <Field label="City" error={errors.city?.message}>{(p) => <Input {...p} autoComplete="address-level2" {...register('city')} />}</Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current band" error={errors.currentBand?.message}>{(p) => <Select {...p} {...register('currentBand')}><option value="">Not sure</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
            <Field label="Target band" error={errors.targetBand?.message}>{(p) => <Select {...p} {...register('targetBand')}><option value="">Select</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
          </div>
          <Field label="IELTS exam date" error={errors.ieltsExamDate?.message}>{(p) => <Input {...p} type="date" {...register('ieltsExamDate')} />}</Field>
          <Field label="Test type" error={errors.academicOrGeneral?.message}>{(p) => <Select {...p} {...register('academicOrGeneral')}><option value="">Select</option><option value="ACADEMIC">Academic</option><option value="GENERAL">General Training</option></Select>}</Field>
          <Field label="Country" error={errors.country?.message}>{(p) => <Input {...p} autoComplete="country-name" {...register('country')} />}</Field>
          <Button type="submit" busy={isSubmitting}>Save profile</Button>
        </form>
      </Card>
      <div className="mt-6"><NotificationPrefs /></div>
    </>
  );
}

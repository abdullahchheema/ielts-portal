'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { IeltsSummaryLike } from '@/components/IeltsSummary';
import { NotificationPrefs } from '@/components/NotificationPrefs';

interface Profile {
  firstName: string; lastName: string; email: string; phone: string | null; city: string | null; currentBand: string | null; targetBand: string | null;
  ieltsExamDate: string | null; academicOrGeneral: string | null; country: string | null; timezone: string | null;
  fatherName: string | null; dateOfBirth: string | null; gender: string | null; notes: string | null;
  ieltsHistory: string | null; ieltsOverall: string | null; ieltsListening: string | null; ieltsReading: string | null; ieltsWriting: string | null; ieltsSpeaking: string | null;
  ieltsTestDate: string | null; ieltsAttempts: number | null; ielts?: IeltsSummaryLike;
}

// Bands are chosen from a list, so the 0.5-step rule can't be broken from the UI.
const BANDS = Array.from({ length: 19 }, (_, i) => (i * 0.5).toFixed(1));
const schema = z.object({
  currentBand: z.string().optional(), targetBand: z.string().optional(), ieltsExamDate: z.string().optional(),
  academicOrGeneral: z.string().optional(), country: z.string().max(80).optional(), city: z.string().max(80).optional(), phone: z.string().max(20).optional(),
  fatherName: z.string().max(120).optional(), dateOfBirth: z.string().optional(), gender: z.string().max(40).optional(), notes: z.string().max(2000).optional(),
  ieltsHistory: z.enum(['NEVER', 'TAKEN']).optional().or(z.literal('')),
  ieltsOverall: z.string().optional(), ieltsListening: z.string().optional(), ieltsReading: z.string().optional(), ieltsWriting: z.string().optional(), ieltsSpeaking: z.string().optional(),
  ieltsTestDate: z.string().optional(), ieltsAttempts: z.string().optional(),
});
type Form = z.infer<typeof schema>;

export default function ProfilePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/me/profile') });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset, watch, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) });
  const taken = watch('ieltsHistory') === 'TAKEN';

  useEffect(() => {
    if (data) reset({
      currentBand: data.currentBand ? Number(data.currentBand).toFixed(1) : '', targetBand: data.targetBand ? Number(data.targetBand).toFixed(1) : '',
      ieltsExamDate: data.ieltsExamDate?.slice(0, 10) ?? '', academicOrGeneral: data.academicOrGeneral ?? '', country: data.country ?? '', city: data.city ?? '', phone: data.phone ?? '',
      fatherName: data.fatherName ?? '', dateOfBirth: data.dateOfBirth?.slice(0, 10) ?? '', gender: data.gender ?? '', notes: data.notes ?? '',
      ieltsHistory: (data.ielts?.status === 'TAKEN' ? 'TAKEN' : data.ieltsHistory === 'TAKEN' ? 'TAKEN' : data.ieltsHistory === 'NEVER' ? 'NEVER' : '') as Form['ieltsHistory'],
      ieltsOverall: data.ieltsOverall ? Number(data.ieltsOverall).toFixed(1) : '', ieltsListening: data.ieltsListening ? Number(data.ieltsListening).toFixed(1) : '',
      ieltsReading: data.ieltsReading ? Number(data.ieltsReading).toFixed(1) : '', ieltsWriting: data.ieltsWriting ? Number(data.ieltsWriting).toFixed(1) : '',
      ieltsSpeaking: data.ieltsSpeaking ? Number(data.ieltsSpeaking).toFixed(1) : '', ieltsTestDate: data.ieltsTestDate?.slice(0, 10) ?? '', ieltsAttempts: data.ieltsAttempts ? String(data.ieltsAttempts) : '',
    });
  }, [data, reset]);

  const save = useMutation({
    mutationFn: (v: Form) => api('/me/profile', {
      method: 'PATCH',
      body: {
        currentBand: v.currentBand ? Number(v.currentBand) : undefined, targetBand: v.targetBand ? Number(v.targetBand) : undefined,
        ieltsExamDate: v.ieltsExamDate || undefined, academicOrGeneral: v.academicOrGeneral || undefined, country: v.country || undefined, city: v.city || undefined, phone: v.phone || undefined,
        fatherName: v.fatherName || undefined, dateOfBirth: v.dateOfBirth || undefined, gender: v.gender || undefined, notes: v.notes || undefined,
        ieltsHistory: v.ieltsHistory || undefined,
        ...(v.ieltsHistory === 'NEVER'
          ? { ieltsOverall: undefined, ieltsListening: undefined, ieltsReading: undefined, ieltsWriting: undefined, ieltsSpeaking: undefined, ieltsTestDate: undefined, ieltsAttempts: undefined }
          : v.ieltsHistory === 'TAKEN'
            ? {
                ieltsOverall: v.ieltsOverall ? Number(v.ieltsOverall) : undefined, ieltsListening: v.ieltsListening ? Number(v.ieltsListening) : undefined,
                ieltsReading: v.ieltsReading ? Number(v.ieltsReading) : undefined, ieltsWriting: v.ieltsWriting ? Number(v.ieltsWriting) : undefined,
                ieltsSpeaking: v.ieltsSpeaking ? Number(v.ieltsSpeaking) : undefined, ieltsTestDate: v.ieltsTestDate || undefined,
                ieltsAttempts: v.ieltsAttempts ? Number(v.ieltsAttempts) : undefined,
              }
            : {}),
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Father's name" error={errors.fatherName?.message}>{(p) => <Input {...p} {...register('fatherName')} />}</Field>
            <Field label="Date of birth" error={errors.dateOfBirth?.message}>{(p) => <Input {...p} type="date" {...register('dateOfBirth')} />}</Field>
          </div>
          <Field label="Gender" error={errors.gender?.message}>{(p) => <Select {...p} {...register('gender')}><option value="">Select</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select>}</Field>

          <fieldset className="rounded-md bg-slate-50 p-4">
            <legend className="px-1 text-sm font-medium text-slate-700">IELTS background</legend>
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" value="NEVER" {...register('ieltsHistory')} /> Never taken IELTS</label>
                <label className="flex items-center gap-2"><input type="radio" value="TAKEN" {...register('ieltsHistory')} /> I have taken IELTS before</label>
              </div>
              {errors.ieltsHistory && <p className="text-xs text-red-600">{errors.ieltsHistory.message}</p>}
              {taken && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <Field label="Overall" error={errors.ieltsOverall?.message}>{(p) => <Select {...p} {...register('ieltsOverall')}><option value="">Select</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                    <Field label="Listening">{(p) => <Select {...p} {...register('ieltsListening')}><option value="">—</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                    <Field label="Reading">{(p) => <Select {...p} {...register('ieltsReading')}><option value="">—</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                    <Field label="Writing">{(p) => <Select {...p} {...register('ieltsWriting')}><option value="">—</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                    <Field label="Speaking">{(p) => <Select {...p} {...register('ieltsSpeaking')}><option value="">—</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Test date" error={errors.ieltsTestDate?.message}>{(p) => <Input {...p} type="date" {...register('ieltsTestDate')} />}</Field>
                    <Field label="Attempts" error={errors.ieltsAttempts?.message}>{(p) => <Input {...p} type="number" min={1} {...register('ieltsAttempts')} />}</Field>
                  </div>
                </>
              )}
            </div>
          </fieldset>

          <Field label="Notes (optional)" error={errors.notes?.message}>{(p) => <Textarea {...p} rows={3} {...register('notes')} />}</Field>

          <Button type="submit" busy={isSubmitting}>Save profile</Button>
        </form>
      </Card>
      <div className="mt-6"><NotificationPrefs /></div>
    </>
  );
}

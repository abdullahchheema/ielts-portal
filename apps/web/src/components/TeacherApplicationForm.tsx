'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, FieldErrors, Resolver, useFieldArray, useForm } from 'react-hook-form';
import { TeacherApplicationInput, teacherApplicationSchema } from '@ielts/validation';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MODULES = ['ACADEMIC', 'GENERAL'];

type Form = TeacherApplicationInput;

const TABS = [
  { key: 'personal', label: 'Personal', fields: ['fullName', 'fatherName', 'dateOfBirth', 'gender', 'nationality', 'idNumber', 'maritalStatus'] },
  { key: 'contact', label: 'Contact', fields: ['phone', 'email', 'currentAddress', 'permanentAddress', 'city', 'emergencyName', 'emergencyRelation', 'emergencyPhone'] },
  { key: 'education', label: 'Education', fields: ['educations'] },
  { key: 'experience', label: 'Experience', fields: ['experiences'] },
  { key: 'teaching', label: 'Teaching', fields: ['subjects', 'ieltsModules', 'teachingYears', 'ieltsYears', 'otherEnglishYears', 'levelsTaught', 'onlineExperience', 'inPersonExperience', 'preferredMode', 'languages', 'skills'] },
  { key: 'certifications', label: 'Certifications', fields: ['certifications'] },
  { key: 'availability', label: 'Availability', fields: ['availableDays', 'availableTime', 'employmentType', 'workingHours', 'joiningDate', 'noticePeriod'] },
  { key: 'compensation', label: 'Compensation', fields: ['expectedSalary', 'expectedHourlyRate'] },
  { key: 'references', label: 'References', fields: ['references'] },
  { key: 'additional', label: 'Additional', fields: ['achievements', 'publications', 'memberships', 'personalStatement', 'notes'] },
] as const;

const csv = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

function errorCount(errors: FieldErrors<Form>, fields: readonly string[]): number {
  return fields.reduce((n, f) => {
    const e = (errors as Record<string, unknown>)[f];
    if (!e) return n;
    if (Array.isArray(e)) return n + e.filter(Boolean).length;
    return n + 1;
  }, 0);
}

export function TeacherApplicationForm({
  defaultValues, onSubmit, submitLabel = 'Submit', busy, serverError,
}: {
  defaultValues?: Partial<Form>;
  onSubmit: (values: Form) => void | Promise<void>;
  submitLabel?: string;
  busy?: boolean;
  serverError?: string | null;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('personal');
  const { register, control, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(teacherApplicationSchema) as unknown as Resolver<Form>,
    defaultValues: {
      subjects: [], ieltsModules: [], languages: [], skills: [], availableDays: [],
      educations: [], experiences: [], certifications: [], references: [],
      ...defaultValues,
    },
  });
  const educations = useFieldArray({ control, name: 'educations' });
  const experiences = useFieldArray({ control, name: 'experiences' });
  const certifications = useFieldArray({ control, name: 'certifications' });
  const references = useFieldArray({ control, name: 'references' });

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, errorCount(errors, t.fields)])), [errors]);

  const submit = handleSubmit((v) => onSubmit(v));

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {serverError && <Alert>{serverError}</Alert>}
      <div role="tablist" aria-label="Application sections" className="flex flex-wrap gap-1 border-b border-slate-100 pb-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'}`}>
            {t.label}{counts[t.key] > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-white">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab === 'personal' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.fullName?.message}>{(p) => <Input {...p} {...register('fullName')} />}</Field>
          <Field label="Father's name" error={errors.fatherName?.message}>{(p) => <Input {...p} {...register('fatherName')} />}</Field>
          <Field label="Date of birth" error={errors.dateOfBirth?.message}>{(p) => <Input {...p} type="date" {...register('dateOfBirth')} />}</Field>
          <Field label="Gender" error={errors.gender?.message}>{(p) => <Select {...p} {...register('gender')}><option value="">Select</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select>}</Field>
          <Field label="Nationality" error={errors.nationality?.message}>{(p) => <Input {...p} {...register('nationality')} />}</Field>
          <Field label="ID / CNIC number" error={errors.idNumber?.message}>{(p) => <Input {...p} {...register('idNumber')} />}</Field>
          <Field label="Marital status" error={errors.maritalStatus?.message}>{(p) => <Input {...p} {...register('maritalStatus')} />}</Field>
        </div>
      )}

      {tab === 'contact' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" error={errors.phone?.message}>{(p) => <Input {...p} type="tel" {...register('phone')} />}</Field>
          <Field label="Email" error={errors.email?.message}>{(p) => <Input {...p} type="email" {...register('email')} />}</Field>
          <Field label="City" error={errors.city?.message}>{(p) => <Input {...p} {...register('city')} />}</Field>
          <div />
          <Field label="Current address" error={errors.currentAddress?.message}>{(p) => <Textarea {...p} rows={2} {...register('currentAddress')} />}</Field>
          <Field label="Permanent address" error={errors.permanentAddress?.message}>{(p) => <Textarea {...p} rows={2} {...register('permanentAddress')} />}</Field>
          <Field label="Emergency contact name" error={errors.emergencyName?.message}>{(p) => <Input {...p} {...register('emergencyName')} />}</Field>
          <Field label="Relationship" error={errors.emergencyRelation?.message}>{(p) => <Input {...p} {...register('emergencyRelation')} />}</Field>
          <Field label="Emergency phone" error={errors.emergencyPhone?.message}>{(p) => <Input {...p} type="tel" {...register('emergencyPhone')} />}</Field>
        </div>
      )}

      {tab === 'education' && (
        <div className="space-y-4">
          {educations.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-6">
              <Field label="Degree" error={errors.educations?.[i]?.degree?.message}>{(p) => <Input {...p} {...register(`educations.${i}.degree`)} />}</Field>
              <Field label="Field">{(p) => <Input {...p} {...register(`educations.${i}.field`)} />}</Field>
              <Field label="Institution" error={errors.educations?.[i]?.institution?.message}>{(p) => <Input {...p} {...register(`educations.${i}.institution`)} />}</Field>
              <Field label="Country">{(p) => <Input {...p} {...register(`educations.${i}.country`)} />}</Field>
              <Field label="Start year">{(p) => <Input {...p} type="number" {...register(`educations.${i}.startYear`)} />}</Field>
              <Field label="End year">{(p) => <Input {...p} type="number" {...register(`educations.${i}.endYear`)} />}</Field>
              <Field label="Grade">{(p) => <Input {...p} {...register(`educations.${i}.grade`)} />}</Field>
              <div className="flex items-end"><Button type="button" variant="danger" className="!py-1.5" onClick={() => educations.remove(i)}>Remove</Button></div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => educations.append({ degree: '', institution: '' })}>Add education</Button>
        </div>
      )}

      {tab === 'experience' && (
        <div className="space-y-4">
          {experiences.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-3">
              <Field label="Organization" error={errors.experiences?.[i]?.organization?.message}>{(p) => <Input {...p} {...register(`experiences.${i}.organization`)} />}</Field>
              <Field label="Job title" error={errors.experiences?.[i]?.jobTitle?.message}>{(p) => <Input {...p} {...register(`experiences.${i}.jobTitle`)} />}</Field>
              <Field label="Employment type">{(p) => <Input {...p} {...register(`experiences.${i}.employmentType`)} />}</Field>
              <Field label="Start date">{(p) => <Input {...p} type="date" {...register(`experiences.${i}.startDate`)} />}</Field>
              <Field label="End date">{(p) => <Input {...p} type="date" {...register(`experiences.${i}.endDate`)} />}</Field>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" {...register(`experiences.${i}.current`)} /> Current role</label>
              <div className="sm:col-span-3"><Field label="Responsibilities">{(p) => <Textarea {...p} rows={2} {...register(`experiences.${i}.responsibilities`)} />}</Field></div>
              <div className="sm:col-span-2"><Field label="Reason for leaving">{(p) => <Input {...p} {...register(`experiences.${i}.reasonForLeaving`)} />}</Field></div>
              <div className="flex items-end"><Button type="button" variant="danger" className="!py-1.5" onClick={() => experiences.remove(i)}>Remove</Button></div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => experiences.append({ organization: '', jobTitle: '', current: false })}>Add experience</Button>
        </div>
      )}

      {tab === 'teaching' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Subjects (comma separated)" error={errors.subjects?.message}>
            {(p) => <Controller control={control} name="subjects" render={({ field }) => <Input {...p} defaultValue={(field.value ?? []).join(', ')} onChange={(e) => field.onChange(csv(e.target.value))} />} />}
          </Field>
          <Field label="IELTS modules taught">{(p) => <div {...p} className="flex gap-4 pt-2 text-sm">{MODULES.map((m) => <label key={m} className="flex items-center gap-2"><input type="checkbox" value={m} {...register('ieltsModules')} /> {m}</label>)}</div>}</Field>
          <Field label="Years teaching (general)">{(p) => <Input {...p} type="number" step="0.5" {...register('teachingYears')} />}</Field>
          <Field label="Years teaching IELTS">{(p) => <Input {...p} type="number" step="0.5" {...register('ieltsYears')} />}</Field>
          <Field label="Other English teaching years">{(p) => <Input {...p} type="number" step="0.5" {...register('otherEnglishYears')} />}</Field>
          <Field label="Levels taught">{(p) => <Input {...p} {...register('levelsTaught')} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('onlineExperience')} /> Online teaching experience</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('inPersonExperience')} /> In-person teaching experience</label>
          <Field label="Preferred mode">{(p) => <Select {...p} {...register('preferredMode')}><option value="">Select</option><option value="ONLINE">Online</option><option value="IN_PERSON">In-person</option><option value="HYBRID">Hybrid</option></Select>}</Field>
          <Field label="Languages (comma separated)">
            {(p) => <Controller control={control} name="languages" render={({ field }) => <Input {...p} defaultValue={(field.value ?? []).join(', ')} onChange={(e) => field.onChange(csv(e.target.value))} />} />}
          </Field>
          <Field label="Other skills (comma separated)">
            {(p) => <Controller control={control} name="skills" render={({ field }) => <Input {...p} defaultValue={(field.value ?? []).join(', ')} onChange={(e) => field.onChange(csv(e.target.value))} />} />}
          </Field>
        </div>
      )}

      {tab === 'certifications' && (
        <div className="space-y-4">
          {certifications.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-4">
              <Field label="Name" error={errors.certifications?.[i]?.name?.message}>{(p) => <Input {...p} {...register(`certifications.${i}.name`)} />}</Field>
              <Field label="Issuer">{(p) => <Input {...p} {...register(`certifications.${i}.issuer`)} />}</Field>
              <Field label="Issued">{(p) => <Input {...p} type="date" {...register(`certifications.${i}.issuedAt`)} />}</Field>
              <Field label="Expires">{(p) => <Input {...p} type="date" {...register(`certifications.${i}.expiresAt`)} />}</Field>
              <div className="flex items-end"><Button type="button" variant="danger" className="!py-1.5" onClick={() => certifications.remove(i)}>Remove</Button></div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => certifications.append({ name: '' })}>Add certification</Button>
        </div>
      )}

      {tab === 'availability' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Available days">{(p) => <div {...p} className="flex flex-wrap gap-3 pt-2 text-sm">{DAYS.map((d) => <label key={d} className="flex items-center gap-1"><input type="checkbox" value={d} {...register('availableDays')} /> {d}</label>)}</div>}</Field>
          <Field label="Available time">{(p) => <Input {...p} placeholder="e.g. 5pm–9pm" {...register('availableTime')} />}</Field>
          <Field label="Employment type">{(p) => <Select {...p} {...register('employmentType')}><option value="">Select</option><option value="FULL_TIME">Full-time</option><option value="PART_TIME">Part-time</option><option value="CONTRACT">Contract</option></Select>}</Field>
          <Field label="Working hours">{(p) => <Input {...p} {...register('workingHours')} />}</Field>
          <Field label="Preferred joining date">{(p) => <Input {...p} type="date" {...register('joiningDate')} />}</Field>
          <Field label="Notice period">{(p) => <Input {...p} {...register('noticePeriod')} />}</Field>
        </div>
      )}

      {tab === 'compensation' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expected monthly salary" error={errors.expectedSalary?.message}>{(p) => <Input {...p} type="number" {...register('expectedSalary')} />}</Field>
          <Field label="Expected hourly rate" error={errors.expectedHourlyRate?.message}>{(p) => <Input {...p} type="number" {...register('expectedHourlyRate')} />}</Field>
        </div>
      )}

      {tab === 'references' && (
        <div className="space-y-4">
          {references.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-5">
              <Field label="Name" error={errors.references?.[i]?.name?.message}>{(p) => <Input {...p} {...register(`references.${i}.name`)} />}</Field>
              <Field label="Organization">{(p) => <Input {...p} {...register(`references.${i}.organization`)} />}</Field>
              <Field label="Position">{(p) => <Input {...p} {...register(`references.${i}.position`)} />}</Field>
              <Field label="Relationship">{(p) => <Input {...p} {...register(`references.${i}.relationship`)} />}</Field>
              <Field label="Phone">{(p) => <Input {...p} type="tel" {...register(`references.${i}.phone`)} />}</Field>
              <Field label="Email" error={errors.references?.[i]?.email?.message}>{(p) => <Input {...p} type="email" {...register(`references.${i}.email`)} />}</Field>
              <div className="flex items-end"><Button type="button" variant="danger" className="!py-1.5" onClick={() => references.remove(i)}>Remove</Button></div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => references.append({ name: '' })}>Add reference</Button>
        </div>
      )}

      {tab === 'additional' && (
        <div className="grid gap-4">
          <Field label="Achievements">{(p) => <Textarea {...p} rows={3} {...register('achievements')} />}</Field>
          <Field label="Publications">{(p) => <Textarea {...p} rows={2} {...register('publications')} />}</Field>
          <Field label="Memberships">{(p) => <Textarea {...p} rows={2} {...register('memberships')} />}</Field>
          <Field label="Personal statement">{(p) => <Textarea {...p} rows={4} {...register('personalStatement')} />}</Field>
          <Field label="Internal notes">{(p) => <Textarea {...p} rows={2} {...register('notes')} />}</Field>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="submit" busy={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}

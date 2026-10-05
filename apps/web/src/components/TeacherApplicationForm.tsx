'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { FieldErrors, Resolver, useFieldArray, useForm } from 'react-hook-form';
import {
  DEGREES, EMERGENCY_RELATIONS, EMPLOYMENT_TYPES, GENDERS, IELTS_MODULES, LANGUAGES, MARITAL_STATUSES, NATIONALITIES, PAKISTAN_CITIES,
  REFERENCE_RELATIONSHIPS, TEACHER_CERTIFICATIONS, TEACHER_DAYS, TEACHER_SUBJECTS, TEACHING_MODES, TEACHING_YEARS, TIME_SLOTS,
  TeacherApplicationInput, teacherApplicationSchema,
} from '@ielts/validation';
import { Alert, Button, Field, Input, Select } from '@/components/ui';

type Form = TeacherApplicationInput;

const TABS = [
  { key: 'personal', label: 'Personal', fields: ['fullName', 'dateOfBirth', 'gender', 'nationality', 'idNumber', 'maritalStatus'] },
  { key: 'contact', label: 'Contact', fields: ['phone', 'email', 'city', 'currentAddress', 'emergencyName', 'emergencyRelation', 'emergencyPhone'] },
  { key: 'teaching', label: 'Teaching', fields: ['subjects', 'ieltsModules', 'teachingYears', 'languages', 'preferredMode'] },
  { key: 'education', label: 'Education', fields: ['educations'] },
  { key: 'experience', label: 'Experience', fields: ['experiences'] },
  { key: 'certifications', label: 'Certifications', fields: ['certifications'] },
  { key: 'availability', label: 'Availability & pay', fields: ['availableDays', 'availableTime', 'employmentType', 'joiningDate', 'expectedSalary'] },
  { key: 'references', label: 'References', fields: ['references'] },
] as const;

function errorCount(errors: FieldErrors<Form>, fields: readonly string[]): number {
  return fields.reduce((n, f) => {
    const e = (errors as Record<string, unknown>)[f];
    if (!e) return n;
    if (Array.isArray(e)) return n + e.filter(Boolean).length;
    return n + 1;
  }, 0);
}

const options = (values: readonly string[]) => values.map((v) => <option key={v} value={v}>{v}</option>);
const YEARS = Array.from({ length: new Date().getFullYear() + 1 - 1950 + 1 }, (_, k) => String(new Date().getFullYear() + 1 - k));

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
      subjects: [], ieltsModules: [], languages: [], availableDays: [], certifications: [],
      educations: [{ degree: undefined as unknown as Form['educations'][number]['degree'], institution: '', endYear: undefined as unknown as number }],
      experiences: [{ organization: '', jobTitle: '', startDate: '', current: false, endDate: '' }],
      references: [{ name: '', organization: '', relationship: undefined as unknown as Form['references'][number]['relationship'], phone: '' }, { name: '', organization: '', relationship: undefined as unknown as Form['references'][number]['relationship'], phone: '' }],
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
      <div role="tablist" aria-label="Application sections" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-primary text-white' : 'bg-surface text-fg ring-1 ring-border-strong hover:bg-canvas'}`}>
            {t.label}{counts[t.key] > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-white">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab === 'personal' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name (as on your CNIC)" error={errors.fullName?.message}>{(p) => <Input {...p} autoComplete="name" {...register('fullName')} />}</Field>
          <Field label="Date of birth" error={errors.dateOfBirth?.message}>{(p) => <Input {...p} type="date" {...register('dateOfBirth')} />}</Field>
          <Field label="Gender" error={errors.gender?.message}>{(p) => <Select {...p} {...register('gender')}><option value="">Select</option>{options(GENDERS)}</Select>}</Field>
          <Field label="Nationality" error={errors.nationality?.message}>{(p) => <Select {...p} {...register('nationality')}><option value="">Select</option>{options(NATIONALITIES)}</Select>}</Field>
          <Field label="CNIC number" hint="Format: 00000-0000000-0" error={errors.idNumber?.message}>{(p) => <Input {...p} inputMode="numeric" placeholder="00000-0000000-0" {...register('idNumber')} />}</Field>
          <Field label="Marital status" error={errors.maritalStatus?.message}>{(p) => <Select {...p} {...register('maritalStatus')}><option value="">Select</option>{options(MARITAL_STATUSES)}</Select>}</Field>
        </div>
      )}

      {tab === 'contact' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone / WhatsApp" error={errors.phone?.message}>{(p) => <Input {...p} type="tel" {...register('phone')} />}</Field>
          <Field label="Email" hint="This is the email on your account." error={errors.email?.message}>{(p) => <Input {...p} type="email" readOnly={!!defaultValues?.email} {...register('email')} />}</Field>
          <Field label="City" error={errors.city?.message}>{(p) => <Select {...p} {...register('city')}><option value="">Select</option>{options(PAKISTAN_CITIES)}</Select>}</Field>
          <Field label="Current address" error={errors.currentAddress?.message}>{(p) => <Input {...p} autoComplete="street-address" {...register('currentAddress')} />}</Field>
          <Field label="Emergency contact name" error={errors.emergencyName?.message}>{(p) => <Input {...p} {...register('emergencyName')} />}</Field>
          <Field label="Relationship" error={errors.emergencyRelation?.message}>{(p) => <Select {...p} {...register('emergencyRelation')}><option value="">Select</option>{options(EMERGENCY_RELATIONS)}</Select>}</Field>
          <Field label="Emergency contact phone" error={errors.emergencyPhone?.message}>{(p) => <Input {...p} type="tel" {...register('emergencyPhone')} />}</Field>
        </div>
      )}

      {tab === 'teaching' && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Subjects you teach" error={errors.subjects?.message}>
            {() => <CheckGroup values={TEACHER_SUBJECTS} name="subjects" register={register} />}
          </Field>
          <Field label="IELTS modules you teach" error={errors.ieltsModules?.message}>
            {() => <CheckGroup values={IELTS_MODULES} name="ieltsModules" register={register} />}
          </Field>
          <Field label="Years of teaching experience" error={errors.teachingYears?.message}>{(p) => <Select {...p} {...register('teachingYears')}><option value="">Select</option>{TEACHING_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</Select>}</Field>
          <Field label="Preferred teaching mode" error={errors.preferredMode?.message}>{(p) => <Select {...p} {...register('preferredMode')}><option value="">Select</option>{options(TEACHING_MODES)}</Select>}</Field>
          <div className="sm:col-span-2">
            <Field label="Languages you teach in" error={errors.languages?.message}>
              {() => <CheckGroup values={LANGUAGES} name="languages" register={register} />}
            </Field>
          </div>
        </div>
      )}

      {tab === 'education' && (
        <div className="space-y-4">
          {educations.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-md bg-canvas p-3 sm:grid-cols-4">
              <Field label="Degree" error={errors.educations?.[i]?.degree?.message}>{(p) => <Select {...p} {...register(`educations.${i}.degree`)}><option value="">Select</option>{options(DEGREES)}</Select>}</Field>
              <div className="sm:col-span-2"><Field label="Institution" error={errors.educations?.[i]?.institution?.message}>{(p) => <Input {...p} {...register(`educations.${i}.institution`)} />}</Field></div>
              <Field label="Year completed" error={errors.educations?.[i]?.endYear?.message}>{(p) => <Select {...p} {...register(`educations.${i}.endYear`)}><option value="">Select</option>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</Select>}</Field>
              {educations.fields.length > 1 && <div className="flex items-end sm:col-span-4"><Button type="button" variant="danger" className="!py-1.5" onClick={() => educations.remove(i)}>Remove</Button></div>}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => educations.append({ degree: undefined as unknown as Form['educations'][number]['degree'], institution: '', endYear: undefined as unknown as number })}>Add education</Button>
        </div>
      )}

      {tab === 'experience' && (
        <div className="space-y-4">
          {experiences.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-md bg-canvas p-3 sm:grid-cols-3">
              <Field label="Organization" error={errors.experiences?.[i]?.organization?.message}>{(p) => <Input {...p} {...register(`experiences.${i}.organization`)} />}</Field>
              <Field label="Job title" error={errors.experiences?.[i]?.jobTitle?.message}>{(p) => <Input {...p} {...register(`experiences.${i}.jobTitle`)} />}</Field>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" {...register(`experiences.${i}.current`)} /> Current role</label>
              <Field label="Start date" error={errors.experiences?.[i]?.startDate?.message}>{(p) => <Input {...p} type="date" {...register(`experiences.${i}.startDate`)} />}</Field>
              <Field label="End date" error={errors.experiences?.[i]?.endDate?.message}>{(p) => <Input {...p} type="date" {...register(`experiences.${i}.endDate`)} />}</Field>
              {experiences.fields.length > 1 && <div className="flex items-end"><Button type="button" variant="danger" className="!py-1.5" onClick={() => experiences.remove(i)}>Remove</Button></div>}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => experiences.append({ organization: '', jobTitle: '', startDate: '', current: false, endDate: '' })}>Add work experience</Button>
        </div>
      )}

      {tab === 'certifications' && (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Optional. Add any teaching certificate you hold.</p>
          {certifications.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-md bg-canvas p-3 sm:grid-cols-3">
              <div className="sm:col-span-2"><Field label="Certificate" error={errors.certifications?.[i]?.name?.message}>{(p) => <Select {...p} {...register(`certifications.${i}.name`)}><option value="">Select</option>{options(TEACHER_CERTIFICATIONS)}</Select>}</Field></div>
              <div className="flex items-end"><Button type="button" variant="danger" className="!py-1.5" onClick={() => certifications.remove(i)}>Remove</Button></div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => certifications.append({ name: undefined as unknown as Form['certifications'][number]['name'] })}>Add certificate</Button>
        </div>
      )}

      {tab === 'availability' && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Days you are available" error={errors.availableDays?.message}>
            {() => <CheckGroup values={TEACHER_DAYS} name="availableDays" register={register} />}
          </Field>
          <Field label="Time you are available" error={errors.availableTime?.message}>{(p) => <Select {...p} {...register('availableTime')}><option value="">Select</option>{options(TIME_SLOTS)}</Select>}</Field>
          <Field label="Employment type" error={errors.employmentType?.message}>{(p) => <Select {...p} {...register('employmentType')}><option value="">Select</option>{options(EMPLOYMENT_TYPES)}</Select>}</Field>
          <Field label="Date you can join" error={errors.joiningDate?.message}>{(p) => <Input {...p} type="date" {...register('joiningDate')} />}</Field>
          <Field label="Expected monthly salary (PKR)" error={errors.expectedSalary?.message}>{(p) => <Input {...p} type="number" min={1} {...register('expectedSalary')} />}</Field>
        </div>
      )}

      {tab === 'references' && (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Two people who can vouch for your teaching.</p>
          {references.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-md bg-canvas p-3 sm:grid-cols-2">
              <Field label="Name" error={errors.references?.[i]?.name?.message}>{(p) => <Input {...p} {...register(`references.${i}.name`)} />}</Field>
              <Field label="Organization" error={errors.references?.[i]?.organization?.message}>{(p) => <Input {...p} {...register(`references.${i}.organization`)} />}</Field>
              <Field label="How do you know them?" error={errors.references?.[i]?.relationship?.message}>{(p) => <Select {...p} {...register(`references.${i}.relationship`)}><option value="">Select</option>{options(REFERENCE_RELATIONSHIPS)}</Select>}</Field>
              <Field label="Phone" error={errors.references?.[i]?.phone?.message}>{(p) => <Input {...p} type="tel" {...register(`references.${i}.phone`)} />}</Field>
              {references.fields.length > 2 && <div className="flex items-end"><Button type="button" variant="danger" className="!py-1.5" onClick={() => references.remove(i)}>Remove</Button></div>}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => references.append({ name: '', organization: '', relationship: undefined as unknown as Form['references'][number]['relationship'], phone: '' })}>Add another reference</Button>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="submit" busy={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}

function CheckGroup({ values, name, register }: { values: readonly string[]; name: 'subjects' | 'ieltsModules' | 'languages' | 'availableDays'; register: ReturnType<typeof useForm<Form>>['register'] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2 text-sm">
      {values.map((v) => (
        <label key={v} className="flex items-center gap-2">
          <input type="checkbox" value={v} {...register(name)} /> {v}
        </label>
      ))}
    </div>
  );
}

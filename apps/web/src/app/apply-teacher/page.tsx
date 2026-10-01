'use client';

import { useState } from 'react';
import { TeacherApplicationInput } from '@ielts/validation';
import { PublicHeader } from '@/components/PublicHeader';
import { TeacherApplicationForm } from '@/components/TeacherApplicationForm';
import { TeacherDocumentsUploader } from '@/components/TeacherDocumentsUploader';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

type Stage = 'form' | 'documents' | 'done';

export default function ApplyTeacherPage() {
  const [stage, setStage] = useState<Stage>('form');
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(values: TeacherApplicationInput) {
    setBusy(true); setError(null);
    try {
      const res = await api<{ id: string; status: string }>('/public/teacher-applications', { body: values });
      setApplicationId(res.id);
      setStage('documents');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Apply to teach with us</h1>
        <p className="mb-6 text-sm text-slate-600">Tell us about your teaching background. We will review your application and get back to you by email.</p>
        <Card>
          {stage === 'form' && <TeacherApplicationForm onSubmit={submit} busy={busy} serverError={error} submitLabel="Submit application" />}
          {stage === 'documents' && applicationId && (
            <TeacherDocumentsUploader applicationId={applicationId} onDone={() => setStage('done')} />
          )}
          {stage === 'done' && (
            <div className="py-6 text-center">
              <h2 className="mb-2 text-lg font-semibold text-slate-900">Application submitted</h2>
              <p className="text-sm text-slate-600">Thank you — we have received your application and any documents you uploaded. We will reach out by email once it has been reviewed.</p>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}

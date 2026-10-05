'use client';

import { useState } from 'react';
import { TeacherApplicationInput } from '@ielts/validation';
import { AccountGate } from '@/components/AccountGate';
import { PublicHeader } from '@/components/PublicHeader';
import { TeacherApplicationForm } from '@/components/TeacherApplicationForm';
import { TeacherDocumentsUploader } from '@/components/TeacherDocumentsUploader';
import { Card, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

type Stage = 'form' | 'documents' | 'done';

export default function ApplyTeacherPage() {
  const me = useMe();
  const [stage, setStage] = useState<Stage>('form');
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(values: TeacherApplicationInput) {
    setBusy(true); setError(null);
    try {
      const res = await api<{ id: string; status: string }>('/teacher-applications', { body: values });
      setApplicationId(res.id);
      setStage('documents');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="mb-2 text-2xl font-bold text-fg">Apply to teach with us</h1>
        {me.isLoading ? <Loading /> : !me.data ? (
          <Card>
            <AccountGate
              next="/apply-teacher"
              title="Create your account to apply"
              intro="Your application is tied to your account. We will contact you at the email address you verify, and approve you there."
            />
          </Card>
        ) : (
          <>
            <p className="mb-6 text-sm text-fg-muted">Tell us about your teaching background. Applying as <span className="font-medium text-fg">{me.data.email}</span>. We will review your application and get back to you by email.</p>
            <Card>
              {stage === 'form' && <TeacherApplicationForm onSubmit={submit} busy={busy} serverError={error} submitLabel="Submit application" defaultValues={{ email: me.data.email }} />}
              {stage === 'documents' && applicationId && (
                <TeacherDocumentsUploader applicationId={applicationId} onDone={() => setStage('done')} />
              )}
              {stage === 'done' && (
                <div className="py-6 text-center">
                  <h2 className="mb-2 text-lg font-semibold text-fg">Application submitted</h2>
                  <p className="text-sm text-fg-muted">Thank you. We have received your application and any documents you uploaded. We will reach out by email once it has been reviewed.</p>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </>
  );
}

'use client';

import { useState } from 'react';
import { TeacherApplicationInput } from '@ielts/validation';
import { AccountGate } from '@/components/AccountGate';
import { PageHero } from '@/components/public/page-hero';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { TeacherApplicationForm } from '@/components/TeacherApplicationForm';
import { TeacherDocumentsUploader } from '@/components/TeacherDocumentsUploader';
import { Alert, Card, Loading } from '@/components/ui';
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
      <main>
        <PageHero size="compact" eyebrow="Teach with us" title="Apply to teach with us" />
        <div className="mx-auto max-w-2xl px-5 pb-20 sm:px-8 sm:pb-24">
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
              <p className="mb-7 text-sm text-fg-muted">Tell us about your teaching background. Applying as <span className="font-semibold text-fg">{me.data.email}</span>. We will review your application and get back to you by email.</p>
              <Card>
                {stage === 'form' && <TeacherApplicationForm onSubmit={submit} busy={busy} serverError={error} submitLabel="Submit application" defaultValues={{ email: me.data.email }} />}
                {stage === 'documents' && applicationId && (
                  <TeacherDocumentsUploader applicationId={applicationId} onDone={() => setStage('done')} />
                )}
                {stage === 'done' && (
                  <div className="space-y-3 py-2 text-center">
                    <h2 className="text-lg font-bold text-fg">Application submitted</h2>
                    <Alert kind="success">Thank you. We have received your application and any documents you uploaded. We will reach out by email once it has been reviewed.</Alert>
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

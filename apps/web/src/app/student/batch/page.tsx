'use client';

import { Alert, Card, DefinitionList, Loading, PageHeader } from '@/components/ui';
import { EnrollmentBadge, PaymentPendingNotice, primaryApplication, scheduleText, teacherText, useApplications } from '@/components/student';
import { date, label } from '@/lib/format';

export default function MyBatchPage() {
  const apps = useApplications();
  if (apps.isLoading) return <Loading />;
  if (apps.isError) return <Alert>Could not load your batch.</Alert>;
  const app = primaryApplication(apps.data);
  const b = app?.batch;

  return (
    <>
      <PageHeader title="My Batch" subtitle="The group you study with." actions={app && <EnrollmentBadge status={app.status} />} />
      {!app || !b ? <PaymentPendingNotice app={null} /> : (
        <>
          {app.status !== 'ACTIVE' && app.status !== 'COMPLETED' && <div className="mb-6"><PaymentPendingNotice app={app} /></div>}
          <Card className="max-w-xl">
            <h2 className="mb-3 text-lg font-semibold">{b.name}</h2>
            <DefinitionList
              items={[
                { label: 'Starts', value: date(b.startAt) },
                { label: 'Class days', value: scheduleText(b) },
                { label: 'Delivery', value: label(b.deliveryMode) },
                { label: 'Teacher', value: teacherText(b.mentors) },
                ...(b.mentors.length > 1 ? [{ label: 'Teacher roles', value: b.mentors.map((m) => `${m.name} (${label(m.role)})`).join(', ') }] : []),
              ]}
            />
            {b.mentors.length === 0 && <p className="mt-3 text-sm text-fg-muted">A teacher will be assigned to your batch before it starts. You will be notified.</p>}
          </Card>
        </>
      )}
    </>
  );
}

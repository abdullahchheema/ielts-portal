'use client';

import { Alert, Card, Loading, PageHeader } from '@/components/ui';
import { EnrollmentBadge, PaymentPendingNotice, primaryApplication, scheduleText, teacherText, useApplications } from '@/components/student';
import { date, label } from '@/lib/format';

export default function MyBatchPage() {
  const apps = useApplications();
  if (apps.isLoading) return <Loading />;
  if (apps.isError) return <Alert>Could not load your batch.</Alert>;
  const app = primaryApplication(apps.data);
  const b = app?.batch;
  const row = (k: string, v: string) => <div className="flex justify-between gap-4 border-b border-slate-100 py-2.5 text-sm last:border-0"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-900">{v}</dd></div>;

  return (
    <>
      <PageHeader title="My Batch" subtitle="The group you study with." actions={app && <EnrollmentBadge status={app.status} />} />
      {!app || !b ? <PaymentPendingNotice app={null} /> : (
        <>
          {app.status !== 'ACTIVE' && app.status !== 'COMPLETED' && <div className="mb-6"><PaymentPendingNotice app={app} /></div>}
          <Card className="max-w-xl">
            <h2 className="mb-2 text-lg font-semibold">{b.name}</h2>
            <dl>
              {row('Starts', date(b.startAt))}
              {row('Class days', scheduleText(b))}
              {row('Delivery', label(b.deliveryMode))}
              {row('Teacher', teacherText(b.mentors))}
              {b.mentors.length > 1 && row('Teacher roles', b.mentors.map((m) => `${m.name} (${label(m.role)})`).join(', '))}
            </dl>
            {b.mentors.length === 0 && <p className="mt-3 text-sm text-slate-500">A teacher will be assigned to your batch before it starts. You will be notified.</p>}
          </Card>
        </>
      )}
    </>
  );
}

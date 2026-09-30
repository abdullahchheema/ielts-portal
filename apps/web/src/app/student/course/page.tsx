'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Card, LinkButton, Loading, PageHeader, ProgressBar } from '@/components/ui';
import { EnrollmentBadge, PaymentPendingNotice, primaryApplication, scheduleText, useApplications } from '@/components/student';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';

interface Cert { id: string; code: string; courseTitle: string; issuedAt: string; valid: boolean }
interface PublicCourse { title: string; description: string | null; price: string; currency: string; durationWeeks: number | null; includes: string[]; modules: string[] }

export default function MyCoursePage() {
  const apps = useApplications();
  const course = useQuery({ queryKey: ['public-course'], queryFn: () => api<PublicCourse>('/public/course') });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<{ overallProgressPercent: number }>('/me/dashboard') });
  const certs = useQuery({ queryKey: ['certificates'], queryFn: () => api<Cert[]>('/me/certificates') });
  if (apps.isLoading || course.isLoading) return <Loading />;
  if (apps.isError || !course.data) return <Alert>Could not load your course.</Alert>;
  const app = primaryApplication(apps.data);
  const enrolled = !!app && ['ACTIVE', 'COMPLETED'].includes(app.status);
  const c = course.data;

  return (
    <>
      <PageHeader title={c.title} subtitle="Your teacher-led IELTS preparation course." actions={app && <EnrollmentBadge status={app.status} />} />
      {!enrolled && <div className="mb-6"><PaymentPendingNotice app={app} /></div>}

      {enrolled && app && (
        <Card className="mb-6">
          <ProgressBar value={dash.data?.overallProgressPercent ?? 0} label="Course progress" />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <span>{app.batch.name} · {scheduleText(app.batch)} · access until {date(app.accessEndsAt)}</span>
            <LinkButton href={`/student/learn/${app.id}`}>Open course content</LinkButton>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">What is included</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.includes.map((i) => <li key={i}>{i}</li>)}</ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Modules</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.modules.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="mt-3 text-sm text-slate-500">{c.durationWeeks ? `${c.durationWeeks} weeks · ` : ''}{money(c.price, c.currency)}</p>
        </Card>
      </div>

      {certs.data && certs.data.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">Certificates</h2>
          <ul className="divide-y divide-slate-100 rounded-lg bg-white ring-1 ring-slate-200">
            {certs.data.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span><strong>{x.courseTitle}</strong> <span className="text-slate-500">· issued {date(x.issuedAt)} · {x.code}</span></span>
                {x.valid && <span className="flex gap-3"><a href={'/api/certificates/' + x.code + '/pdf'} className="font-medium text-indigo-700 underline">Download PDF</a><a href={'/verify/' + x.code} className="text-slate-600 underline">Verification page</a></span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

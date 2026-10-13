'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Card, LinkButton, Loading, PageHeader, ProgressBar, Section, SimpleList, SimpleListItem } from '@/components/ui';
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
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted">
            <span>{app.batch.name} · {scheduleText(app.batch)} · access until {date(app.accessEndsAt)}</span>
            <LinkButton href={`/student/learn/${app.id}`}>Open course content</LinkButton>
          </div>
        </Card>
      )}

      <Section title="Course details">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="mb-2 font-semibold text-fg">What is included</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-fg">{c.includes.map((i) => <li key={i}>{i}</li>)}</ul>
          </Card>
          <Card>
            <h3 className="mb-2 font-semibold text-fg">Modules</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-fg">{c.modules.map((m) => <li key={m}>{m}</li>)}</ul>
            <p className="mt-3 text-sm text-fg-muted">{c.durationWeeks ? `${c.durationWeeks} weeks · ` : ''}{money(c.price, c.currency)}</p>
          </Card>
        </div>
      </Section>

      {certs.data && certs.data.length > 0 && (
        <Section title="Certificates">
          <SimpleList>
            {certs.data.map((x) => (
              <SimpleListItem key={x.id}
                left={<span><strong>{x.courseTitle}</strong> <span className="text-fg-muted">· issued {date(x.issuedAt)} · {x.code}</span></span>}
                right={x.valid && <><a href={'/api/certificates/' + x.code + '/pdf'} className="font-medium text-primary underline">Download PDF</a><a href={'/verify/' + x.code} className="text-fg-muted underline">Verification page</a></>}
              />
            ))}
          </SimpleList>
        </Section>
      )}
    </>
  );
}

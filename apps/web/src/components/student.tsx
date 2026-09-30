'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ReactNode } from 'react';
import { Alert, Badge, Card, Empty, LinkButton, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

export interface Application {
  id: string; status: string; displayStatus: string; createdAt: string; enrolledAt: string | null; accessEndsAt: string | null;
  batch: { id: string; name: string; startAt: string; days: string[]; classTime: string | null; timezone: string; deliveryMode: string; mentors: { name: string; role: string }[] };
  order: { id: string; reference: string; total: string; currency: string; status: string } | null;
  payment: { proofId: string; method: string; reference: string; claimedAmount: string; status: string; rejectionReason: string | null; submittedAt: string } | null;
  canResubmit: boolean;
}

export const STATUS_TEXT: Record<string, string> = {
  PENDING_PAYMENT: 'Pending payment verification', ACTIVE: 'Enrolled', REJECTED: 'Rejected',
  PAUSED: 'Paused', COMPLETED: 'Completed', EXPIRED: 'Access expired', CANCELLED: 'Cancelled',
};
export const METHOD_TEXT: Record<string, string> = { BANK_TRANSFER: 'Bank transfer', JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', OTHER: 'Other' };
export const DAY_TEXT: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

export function EnrollmentBadge({ status }: { status: string }) {
  return <Badge status={status} text={STATUS_TEXT[status] ?? label(status)} />;
}

export const scheduleText = (b: { days: string[]; classTime: string | null }) =>
  b.days.length ? `${b.days.map((d) => DAY_TEXT[d] ?? d).join(', ')}${b.classTime ? ` · ${b.classTime}` : ''}` : 'Schedule to be announced';

export const teacherText = (mentors: { name: string; role: string }[]) => (mentors.length ? mentors.map((m) => m.name).join(', ') : 'Not assigned yet');

export function useApplications() {
  return useQuery({ queryKey: ['applications'], queryFn: () => api<Application[]>('/me/applications') });
}

/** The application that matters right now: the active enrollment if any, otherwise the newest one. */
export function primaryApplication(list: Application[] | undefined): Application | null {
  if (!list?.length) return null;
  return list.find((a) => ['ACTIVE', 'COMPLETED', 'PAUSED'].includes(a.status)) ?? list.find((a) => a.status === 'PENDING_PAYMENT') ?? list[0];
}

export function PaymentPendingNotice({ app }: { app: Application | null }) {
  if (!app) {
    return <Empty>You have not applied for a batch yet.<div className="mt-3"><LinkButton href="/register">Join the next batch</LinkButton></div></Empty>;
  }
  if (app.status === 'REJECTED') {
    return <Alert kind="error">Your application for <strong>{app.batch.name}</strong> was not approved{app.payment?.rejectionReason ? `: ${app.payment.rejectionReason}` : '.'} <Link href="/register" className="font-medium underline">Apply for another batch</Link></Alert>;
  }
  return (
    <Alert kind="warning">
      {app.canResubmit
        ? <>Your payment proof was not accepted{app.payment?.rejectionReason ? ` (${app.payment.rejectionReason})` : ''}. <Link href="/student/application" className="font-medium underline">Upload a corrected proof</Link></>
        : <>Your payment is being verified. Course content unlocks as soon as the academy confirms it — usually within one working day. <Link href="/student/application" className="font-medium underline">View my application</Link></>}
    </Alert>
  );
}

interface TreeItem { id: string; title: string; contentType: string; state: string; isRequired: boolean; estimatedMinutes: number | null }
interface TreeSection { id: string; title: string; items: TreeItem[]; children: TreeSection[] }

const flat = (s: TreeSection): TreeItem[] => [...s.items, ...s.children.flatMap(flat)];
const ICON: Record<string, string> = { COMPLETED: '✓', LOCKED: '🔒', IN_PROGRESS: '◐', NOT_STARTED: '○' };

/** One course module (Listening, Reading …): its lessons and tests, straight from the course tree. */
export function ModulePage({ match, title, blurb, extra }: { match: string; title: string; blurb: string; extra?: ReactNode }) {
  const apps = useApplications();
  const app = primaryApplication(apps.data);
  const enrolled = !!app && ['ACTIVE', 'COMPLETED'].includes(app.status);
  const course = useQuery({
    queryKey: ['course', app?.id], enabled: enrolled,
    queryFn: () => api<{ sections: TreeSection[] }>(`/me/courses/${app!.id}`),
  });
  if (apps.isLoading) return <Loading />;

  const sections = (course.data?.sections ?? []).filter((s) => s.title.toLowerCase().startsWith(match));
  return (
    <>
      <PageHeader title={title} subtitle={blurb} />
      {!enrolled ? <PaymentPendingNotice app={app} /> : course.isLoading ? <Loading /> : course.isError ? <Alert>{errorMessage(course.error)}</Alert> : sections.length === 0 ? (
        <Empty>Your teacher has not added {title.toLowerCase()} material yet.</Empty>
      ) : (
        sections.map((s) => (
          <Card key={s.id} className="mb-4">
            <h2 className="mb-3 font-semibold text-slate-900">{s.title}</h2>
            <ul className="divide-y divide-slate-100">
              {flat(s).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2"><span aria-hidden className={i.state === 'COMPLETED' ? 'text-green-600' : 'text-slate-400'}>{ICON[i.state] ?? '○'}</span>{i.title}<span className="text-xs text-slate-400">{label(i.contentType)}{i.estimatedMinutes ? ` · ${i.estimatedMinutes} min` : ''}</span></span>
                  {i.state === 'LOCKED'
                    ? <span className="text-xs text-slate-400">Locked</span>
                    : <Link href={`/student/learn/${app!.id}?item=${i.id}`} className="font-medium text-indigo-700 hover:underline">{i.state === 'COMPLETED' ? 'Review' : i.state === 'IN_PROGRESS' ? 'Continue' : 'Start'}</Link>}
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      {extra}
    </>
  );
}

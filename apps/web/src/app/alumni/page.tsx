'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Button, Card, Empty, Loading, PageHeader, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Home {
  firstName: string;
  certificates: { code: string; certificateNumber: string | null; courseTitle: string; batchName: string | null; issuedAt: string; valid: boolean; revoked: boolean }[];
  completedCourses: { title: string; batchName: string; completedAt: string | null; progressPercent: string }[];
  recordings: { id: string; createdAt: string; session: { topic: string; title: string | null } }[];
}

/** Alumni home: certificates with their verification links, completed courses and the revision library. */
export default function AlumniHomePage() {
  const home = useQuery({ queryKey: ['alumni-home'], queryFn: () => api<Home>('/alumni/home'), retry: false });

  return (
    <>
      <PageHeader title={home.data ? `Welcome back, ${home.data.firstName}` : 'Alumni portal'} subtitle="Your certificates, completed courses and the revision library." />
      {home.isLoading && <Loading />}
      {home.isError && (
        <Card className="space-y-3">
          <Alert>{errorMessage(home.error)}</Alert>
          <Link href="/student"><Button variant="secondary">Back to the student portal</Button></Link>
        </Card>
      )}
      {home.data && (
        <>
          <Section title="Certificates">
            {home.data.certificates.length === 0 ? <Empty title="No certificates yet" /> : (
              <ul className="space-y-3">
                {home.data.certificates.map((c) => (
                  <li key={c.code}>
                    <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-fg">{c.courseTitle}{c.batchName ? ` · ${c.batchName}` : ''}</p>
                        <p className="text-xs text-fg-muted">Issued {date(c.issuedAt)}{c.certificateNumber ? ` · No. ${c.certificateNumber}` : ''}</p>
                        {c.revoked && <p className="text-xs text-danger">Withdrawn by the academy</p>}
                      </div>
                      <Link href={`/verify/${c.code}`} className="text-sm font-medium text-primary hover:underline">Verification page</Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Completed courses">
            {home.data.completedCourses.length === 0 ? <Empty title="No completed courses yet" /> : (
              <ul className="space-y-2 text-sm">
                {home.data.completedCourses.map((e) => (
                  <li key={`${e.title}-${e.batchName}`} className="text-fg">{e.title} · {e.batchName}{e.completedAt ? ` · completed ${date(e.completedAt)}` : ''}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Revision library" actions={<Link href="/alumni/recordings" className="text-sm font-medium text-primary hover:underline">Open library</Link>}>
            {home.data.recordings.length === 0 ? <Empty title="Nothing in the library yet" /> : (
              <p className="text-sm text-fg-muted">{home.data.recordings.length} recording{home.data.recordings.length === 1 ? '' : 's'} available.</p>
            )}
          </Section>
        </>
      )}
    </>
  );
}

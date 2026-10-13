import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { PublicHeader } from '@/components/PublicHeader';
import { publicGet } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Verify certificate', robots: { index: false } };

type Result =
  | { valid: true; status: 'ISSUED'; certificateNumber: string | null; studentName: string; courseTitle: string; batchName: string | null; issuedAt: string }
  | { valid: false; status: 'REVOKED'; certificateNumber: string | null }
  | { valid: false; status: 'NOT_VALID' | 'NOT_FOUND' };

/** Public check of a certificate. It shows only the outcome, the holder's name, the course, the batch and the date. */
export default async function VerifyCertificatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = code.toUpperCase().slice(0, 40);
  const r = await publicGet<Result>(`/certificates/${encodeURIComponent(c)}/verify`, 0);

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-xl px-4 py-16">
        <div className="rounded-lg bg-surface p-8 text-center shadow-xs ring-1 ring-border">
          {r?.valid ? (
            <>
              <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success"><CircleCheck className="size-6" strokeWidth={1.75} /></span>
              <h1 className="mt-3 text-2xl font-semibold text-success">Certificate verified</h1>
              <p className="mt-4 text-fg-muted">This certifies that</p>
              <p className="text-xl font-semibold text-fg">{r.studentName}</p>
              <p className="mt-2 text-fg-muted">completed</p>
              <p className="text-lg font-medium text-fg">{r.courseTitle}</p>
              {r.batchName && <p className="mt-1 text-sm text-fg-muted">{r.batchName}</p>}
              <p className="mt-2 text-sm text-fg-muted">Issued {new Date(r.issuedAt).toLocaleDateString('en-GB', { dateStyle: 'long' })}</p>
              {r.certificateNumber && <p className="mt-1 font-mono text-xs text-fg-subtle">No. {r.certificateNumber}</p>}
            </>
          ) : r?.status === 'REVOKED' ? (
            <>
              <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-warning-soft text-warning"><TriangleAlert className="size-6" strokeWidth={1.75} /></span>
              <h1 className="mt-3 text-2xl font-semibold text-warning">Certificate revoked</h1>
              <p className="mt-3 text-fg-muted">This certificate has been withdrawn by the academy and no longer stands. Contact the academy if you have a question.</p>
            </>
          ) : (
            <>
              <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-danger-soft text-danger"><CircleAlert className="size-6" strokeWidth={1.75} /></span>
              <h1 className="mt-3 text-2xl font-semibold text-danger">Certificate not found</h1>
              <p className="mt-3 text-fg-muted">We could not find a certificate with this ID. Check the ID for typos, or contact the academy.</p>
            </>
          )}
          <p className="mt-6 font-mono text-xs text-fg-subtle">{c}</p>
        </div>
      </main>
    </>
  );
}

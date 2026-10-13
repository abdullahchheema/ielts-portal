import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { PageHero } from '@/components/public/page-hero';
import { PublicFooter } from '@/components/PublicFooter';
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
      <main>
        <PageHero size="compact" eyebrow="Certificates" title="Verify a certificate" />
        <div className="mx-auto max-w-xl px-5 pb-20 sm:px-8 sm:pb-24">
          <div className="rounded-3xl bg-surface p-9 text-center shadow-sm ring-1 ring-border">
            {r?.valid ? (
              <>
                <span aria-hidden className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success"><CircleCheck className="size-7" strokeWidth={1.75} /></span>
                <h2 className="mt-4 text-h3 font-extrabold text-success">Certificate verified</h2>
                <p className="mt-4 text-fg-muted">This certifies that</p>
                <p className="text-xl font-bold text-fg">{r.studentName}</p>
                <p className="mt-2 text-fg-muted">completed</p>
                <p className="text-lg font-semibold text-fg">{r.courseTitle}</p>
                {r.batchName && <p className="mt-1 text-sm text-fg-muted">{r.batchName}</p>}
                <p className="mt-2 text-sm text-fg-muted">Issued {new Date(r.issuedAt).toLocaleDateString('en-GB', { dateStyle: 'long' })}</p>
                {r.certificateNumber && <p className="mt-1 font-mono text-xs text-fg-subtle">No. {r.certificateNumber}</p>}
              </>
            ) : r?.status === 'REVOKED' ? (
              <>
                <span aria-hidden className="mx-auto grid size-14 place-items-center rounded-full bg-warning-soft text-warning"><TriangleAlert className="size-7" strokeWidth={1.75} /></span>
                <h2 className="mt-4 text-h3 font-extrabold text-warning">Certificate revoked</h2>
                <p className="mt-3 text-fg-muted">This certificate has been withdrawn by the academy and no longer stands. Contact the academy if you have a question.</p>
              </>
            ) : (
              <>
                <span aria-hidden className="mx-auto grid size-14 place-items-center rounded-full bg-danger-soft text-danger"><CircleAlert className="size-7" strokeWidth={1.75} /></span>
                <h2 className="mt-4 text-h3 font-extrabold text-danger">Certificate not found</h2>
                <p className="mt-3 text-fg-muted">We could not find a certificate with this ID. Check the ID for typos, or contact the academy.</p>
              </>
            )}
            <p className="mt-7 font-mono text-xs text-fg-subtle">{c}</p>
          </div>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

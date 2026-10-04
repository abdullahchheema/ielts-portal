import type { Metadata } from 'next';
import { PublicHeader } from '@/components/PublicHeader';
import { publicGet } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Verify certificate', robots: { index: false } };

interface Result { valid: boolean; studentName?: string; courseTitle?: string; issuedAt?: string }

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
              <p className="text-4xl" aria-hidden>✓</p>
              <h1 className="mt-2 text-2xl font-semibold text-green-700">Valid certificate</h1>
              <p className="mt-4 text-fg-muted">This certifies that</p>
              <p className="text-xl font-semibold text-fg">{r.studentName}</p>
              <p className="mt-2 text-fg-muted">completed</p>
              <p className="text-lg font-medium text-fg">{r.courseTitle}</p>
              <p className="mt-2 text-sm text-fg-muted">Issued {r.issuedAt ? new Date(r.issuedAt).toLocaleDateString('en-GB', { dateStyle: 'long' }) : ''}</p>
            </>
          ) : (
            <>
              <p className="text-4xl" aria-hidden>✗</p>
              <h1 className="mt-2 text-2xl font-semibold text-danger">Not a valid certificate</h1>
              <p className="mt-3 text-fg-muted">We could not find an active certificate with this ID. It may have been mistyped or withdrawn.</p>
            </>
          )}
          <p className="mt-6 font-mono text-xs text-fg-subtle">{c}</p>
        </div>
      </main>
    </>
  );
}

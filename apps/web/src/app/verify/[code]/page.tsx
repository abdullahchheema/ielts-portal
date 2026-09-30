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
        <div className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          {r?.valid ? (
            <>
              <p className="text-4xl" aria-hidden>✓</p>
              <h1 className="mt-2 text-2xl font-semibold text-green-700">Valid certificate</h1>
              <p className="mt-4 text-slate-600">This certifies that</p>
              <p className="text-xl font-semibold text-slate-900">{r.studentName}</p>
              <p className="mt-2 text-slate-600">completed</p>
              <p className="text-lg font-medium text-slate-900">{r.courseTitle}</p>
              <p className="mt-2 text-sm text-slate-500">Issued {r.issuedAt ? new Date(r.issuedAt).toLocaleDateString('en-GB', { dateStyle: 'long' }) : ''}</p>
            </>
          ) : (
            <>
              <p className="text-4xl" aria-hidden>✗</p>
              <h1 className="mt-2 text-2xl font-semibold text-red-700">Not a valid certificate</h1>
              <p className="mt-3 text-slate-600">We could not find an active certificate with this ID. It may have been mistyped or withdrawn.</p>
            </>
          )}
          <p className="mt-6 font-mono text-xs text-slate-400">{c}</p>
        </div>
      </main>
    </>
  );
}

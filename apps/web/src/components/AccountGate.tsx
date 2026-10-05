'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';

export function useAuthProviders() {
  return useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => api<{ google: boolean }>('/auth/providers', { noRefresh: true }),
    staleTime: 10 * 60_000,
  });
}

/** Rendered only when the server has Google sign-in configured. */
export function GoogleSignInButton({ next }: { next?: string }) {
  const providers = useAuthProviders();
  if (!providers.data?.google) return null;
  const href = `/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <a
      href={href}
      className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      Continue with Google
    </a>
  );
}

const STEPS = ['Create your account', 'Verify your email', 'Apply through the form'];

/** Shown to visitors before they can apply: an account comes first, then email verification, then the form. */
export function AccountGate({ next, title, intro }: { next: string; title: string; intro: string }) {
  const encoded = encodeURIComponent(next);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        <p className="mt-1 text-sm text-fg-muted">{intro}</p>
      </div>
      <ol className="space-y-2 text-sm text-fg-muted">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-fg">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className="space-y-3">
        <Link
          href={`/create-account?next=${encoded}`}
          className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-ring"
        >
          Create account
        </Link>
        <GoogleSignInButton next={next} />
      </div>
      <p className="text-sm text-fg-muted">
        Already have an account? <Link href={`/login?next=${encoded}`} className="font-medium text-primary underline underline-offset-2">Log in</Link>
      </p>
    </div>
  );
}

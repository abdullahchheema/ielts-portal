'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/**
 * Filter and page state kept in the querystring, so a filtered view can be shared, bookmarked, and
 * survives the back button. Empty and default values are dropped from the URL to keep it short.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const state = useMemo(() => {
    const out = { ...defaults } as Record<string, string>;
    for (const key of Object.keys(defaults)) {
      const v = params.get(key);
      if (v !== null && v !== '') out[key] = v;
    }
    return out as T;
  }, [defaults, params]);

  const set = useCallback((patch: Partial<T>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      const fallback = defaults[key as keyof T];
      if (value === undefined || value === '' || value === fallback) next.delete(key);
      else next.set(key, String(value));
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [defaults, params, pathname, router]);

  return [state, set];
}

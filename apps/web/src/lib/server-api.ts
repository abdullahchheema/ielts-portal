import 'server-only';
import { backendFetch } from './backend';

/** Server-side fetch for public data. Returns null when the backend is unavailable so pages degrade gracefully. */
export async function publicGet<T>(path: string, _revalidate = 30): Promise<T | null> {
  try {
    const res = await backendFetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface PublicCourse {
  title: string; description: string | null; price: string; currency: string;
  durationWeeks: number | null; accessDays: number; includes: string[]; modules: string[];
}

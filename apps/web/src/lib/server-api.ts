import 'server-only';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** Server-side fetch for public data (cached briefly). Returns null when the API is down so pages degrade gracefully. */
export async function publicGet<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate } });
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

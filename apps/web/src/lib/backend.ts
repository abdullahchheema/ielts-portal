import 'server-only';

/**
 * Talks to the backend (the NestJS app in apps/api).
 *
 * - If API_URL is set, requests go to that server (used when the API runs separately).
 * - In development without API_URL, requests go to http://localhost:4000 (started by `npm run dev`).
 * - In production without API_URL (the single-project Vercel setup), the NestJS app is started INSIDE this
 *   Next.js server on a private loopback port, once per warm instance, and requests go to it.
 */

interface EmbeddedApp {
  listen(port: number, host: string): Promise<unknown>;
  getUrl(): Promise<string>;
  get<T>(token: unknown, options?: { strict: boolean }): T;
}

interface Embedded { app: EmbeddedApp; url: string }

let embedded: Promise<Embedded> | null = null;

export function embeddedBackend(): Promise<Embedded> {
  embedded ??= (async () => {
    process.env.DISABLE_SWEEPER = 'true'; // no timers on serverless; /api/internal/cron does the periodic work
    const { createApp } = await import('@ielts/api/dist/app');
    const { app } = await createApp(['warn', 'error']);
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    return { app: app as unknown as EmbeddedApp, url };
  })().catch((e) => { embedded = null; throw e; });
  return embedded;
}

async function baseUrl(): Promise<string> {
  if (process.env.API_URL) return process.env.API_URL.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:4000';
  return (await embeddedBackend()).url;
}

/** Calls the backend with a path like "/public/batches". */
export async function backendFetch(path: string, init?: RequestInit & { duplex?: 'half' }): Promise<Response> {
  return fetch(`${await baseUrl()}${path}`, { ...init, redirect: 'manual' });
}

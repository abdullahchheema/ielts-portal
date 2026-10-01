import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AttemptsService } from './assessments/attempts.service';
import { LifecycleService } from './lifecycle/lifecycle.service';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let cached: Promise<{ handler: Handler; lifecycle: LifecycleService; attempts: AttemptsService }> | null = null;

/** Boots Nest once per warm serverless instance and reuses it for later requests. */
function boot() {
  cached ??= (async () => {
    process.env.DISABLE_SWEEPER = 'true'; // no timers in serverless; the cron route below does the periodic work
    const { createApp } = await import('./app');
    const { app } = await createApp(['warn', 'error']);
    await app.init();
    return {
      handler: app.getHttpAdapter().getInstance() as Handler,
      lifecycle: app.get(LifecycleService, { strict: false }),
      attempts: app.get(AttemptsService, { strict: false }),
    };
  })();
  return cached;
}

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Vercel entry point. Also serves /internal/cron, which Vercel Cron calls with `Authorization: Bearer $CRON_SECRET`. */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const { handler: nest, lifecycle, attempts } = await boot();
    if (req.url?.split('?')[0] === '/internal/cron') {
      const secret = process.env.CRON_SECRET ?? '';
      const given = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!secret || !sameSecret(given, secret)) { res.statusCode = 401; res.end('Unauthorized'); return; }
      const [expired, autoSubmitted] = [await lifecycle.sweep(), await attempts.sweepExpired()];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, lifecycle: expired, autoSubmitted }));
      return;
    }
    nest(req, res);
  } catch (e) {
    console.error('API failed to start', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'The server could not start.' } }));
  }
}

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { embeddedBackend } from '@/lib/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Drives the API's task scheduler. Vercel's daily cron calls this as a fallback; an external 5-minute
 * ping (see .github/workflows/cron.yml) makes the time-based tasks run on time. Each task is lease-guarded,
 * so repeated or overlapping calls never run the same task twice.
 */
let warnedMissingSecret = false;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret && !warnedMissingSecret) {
    // Once per warm instance, not once per request: loud enough to find in server logs without
    // flooding them on every 5-minute ping while the secret stays unset.
    warnedMissingSecret = true;
    console.warn('[cron] CRON_SECRET is not set on this deployment — every cron ping will 401 until it is. See docs/DEPLOYMENT.md.');
  }
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!secret || !same(given, secret)) return new NextResponse('Unauthorized', { status: 401 });

  const { app } = await embeddedBackend();
  const { SchedulerService } = await import('@ielts/api/dist/jobs/scheduler.service');
  const scheduler = await app.get<{ tick(budgetMs?: number): Promise<Record<string, unknown>> }>(SchedulerService, { strict: false });
  return NextResponse.json({ ok: true, tasks: await scheduler.tick(45_000) });
}

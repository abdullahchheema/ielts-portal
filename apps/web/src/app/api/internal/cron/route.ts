import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { embeddedBackend } from '@/lib/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Called by Vercel Cron (see vercel.json) with `Authorization: Bearer $CRON_SECRET`: expiry, reminders, timed-test auto-submit. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!secret || !same(given, secret)) return new NextResponse('Unauthorized', { status: 401 });

  const { app } = await embeddedBackend();
  const { LifecycleService } = await import('@ielts/api/dist/lifecycle/lifecycle.service');
  const { AttemptsService } = await import('@ielts/api/dist/assessments/attempts.service');
  const lifecycle = await app.get<{ sweep(): Promise<unknown> }>(LifecycleService, { strict: false });
  const attempts = await app.get<{ sweepExpired(): Promise<number> }>(AttemptsService, { strict: false });
  return NextResponse.json({ ok: true, lifecycle: await lifecycle.sweep(), autoSubmitted: await attempts.sweepExpired() });
}

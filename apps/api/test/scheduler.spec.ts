import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { JobsService } from '../src/jobs/jobs.service';
import { SchedulerService } from '../src/jobs/scheduler.service';

/**
 * The scheduler lease and the job queue, against the real database.
 * These are the guarantees the cron route and the in-process timer both rely on.
 */

let app: NestExpressApplication;
let prisma: PrismaClient;
let scheduler: SchedulerService;
let jobs: JobsService;
const TASK = `test.task.${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  scheduler = app.get(SchedulerService);
  jobs = app.get(JobsService);
  prisma = new PrismaClient();
});
afterAll(async () => {
  await prisma.scheduledTaskRun.deleteMany({ where: { taskName: { startsWith: 'test.task.' } } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.scheduledTaskRun.deleteMany({ where: { taskName: TASK } });
});

describe('SchedulerService', () => {
  it('runs a due task once and records the run', async () => {
    let calls = 0;
    scheduler.register(TASK, 60_000, async () => { calls++; });
    const first = await scheduler.tick(10_000);
    expect(first[TASK].status).toBe('OK');
    expect(calls).toBe(1);
    const row = await prisma.scheduledTaskRun.findUniqueOrThrow({ where: { taskName: TASK } });
    expect(row.lastStatus).toBe('OK');
    expect(row.lockedUntil).toBeNull();
  });

  it('does not run again before the interval has elapsed', async () => {
    let calls = 0;
    scheduler.register(TASK, 60_000, async () => { calls++; });
    await scheduler.tick(10_000);
    const soon = await scheduler.tick(10_000, new Date(Date.now() + 30_000));
    expect(soon[TASK].status).toBe('SKIPPED_NOT_DUE');
    expect(calls).toBe(1);
  });

  it('two overlapping ticks run the task exactly once', async () => {
    let calls = 0;
    scheduler.register(TASK, 60_000, async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 300));
    });
    const [a, b] = await Promise.all([scheduler.tick(10_000), scheduler.tick(10_000)]);
    const statuses = [a[TASK].status, b[TASK].status].sort();
    // The second tick either finds the lease held or, having reached this task after the first finished, finds it not due.
    // What must hold is that the task body ran once.
    expect(statuses[0]).toBe('OK');
    expect(['SKIPPED_LEASED', 'SKIPPED_NOT_DUE']).toContain(statuses[1]);
    expect(calls).toBe(1);
  });

  it('a failing task is recorded and does not block later tasks', async () => {
    const other = `${TASK}.other`;
    scheduler.register(TASK, 60_000, async () => { throw new Error('boom'); });
    scheduler.register(other, 60_000, async () => 'fine');
    try {
      const out = await scheduler.tick(10_000);
      expect(out[TASK]).toEqual({ status: 'FAILED', error: 'boom' });
      expect(out[other].status).toBe('OK');
      const row = await prisma.scheduledTaskRun.findUniqueOrThrow({ where: { taskName: TASK } });
      expect(row.lastStatus).toBe('FAILED');
      expect(row.lastError).toBe('boom');
    } finally {
      await prisma.scheduledTaskRun.deleteMany({ where: { taskName: other } });
    }
  });
});

describe('JobsService', () => {
  it('enqueue is idempotent on the job key', async () => {
    const key = `test-job-${Math.random().toString(36).slice(2, 8)}`;
    const first = await jobs.enqueue('test.noop', key, { n: 1 });
    const second = await jobs.enqueue('test.noop', key, { n: 2 });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await prisma.job.deleteMany({ where: { jobKey: key } });
  });

  it('runs a queued job once and marks it succeeded', async () => {
    const type = `test.run.${Math.random().toString(36).slice(2, 8)}`;
    let seen: unknown = null;
    jobs.handle(type, async (payload) => { seen = payload; });
    const key = `${type}:1`;
    await jobs.enqueue(type, key, { hello: 'world' });
    const r = await jobs.runDue(50);
    expect(r.succeeded).toBeGreaterThanOrEqual(1);
    expect(seen).toEqual({ hello: 'world' });
    const row = await prisma.job.findUniqueOrThrow({ where: { jobKey: key } });
    expect(row.status).toBe('SUCCEEDED');
    await prisma.job.deleteMany({ where: { jobKey: key } });
  });

  it('a failing job is retried with backoff, not run again immediately', async () => {
    const type = `test.fail.${Math.random().toString(36).slice(2, 8)}`;
    jobs.handle(type, async () => { throw new Error('provider down'); });
    const key = `${type}:1`;
    await jobs.enqueue(type, key);
    await jobs.runDue(50);
    const row = await prisma.job.findUniqueOrThrow({ where: { jobKey: key } });
    expect(row.status).toBe('QUEUED');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('provider down');
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now());
    await prisma.job.deleteMany({ where: { jobKey: key } });
  });
});

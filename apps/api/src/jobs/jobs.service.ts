import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService, LEASE_MS } from './scheduler.service';
import { backoffMs, MAX_JOB_ATTEMPTS } from './schedule';

export type JobHandler = (payload: unknown) => Promise<void>;

/**
 * Durable one-off work (AI evaluations, transcriptions, backfills). Rows are claimed with
 * FOR UPDATE SKIP LOCKED, so any number of instances can drain the queue without double-running a job.
 * Jobs are idempotent by `jobKey`: enqueueing the same key twice creates one job.
 */
@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();

  constructor(private readonly prisma: PrismaService, private readonly scheduler: SchedulerService) {}

  onModuleInit() {
    this.scheduler.register('jobs.run', 60_000, () => this.runDue(10));
  }

  handle(type: string, fn: JobHandler) {
    this.handlers.set(type, fn);
  }

  /** Returns the job id, or null when a job with this key already exists. */
  async enqueue(type: string, jobKey: string, payload?: Prisma.InputJsonValue): Promise<string | null> {
    try {
      const job = await this.prisma.job.create({ data: { type, jobKey, payload: payload ?? Prisma.JsonNull }, select: { id: true } });
      return job.id;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return null;
      throw e;
    }
  }

  /** Claims up to `limit` ready jobs (including RUNNING jobs whose lease expired) and runs them. */
  async runDue(limit = 10): Promise<{ ran: number; succeeded: number; failed: number }> {
    const now = new Date();
    const claimed = await this.prisma.$queryRaw<{ id: string; type: string; payload: unknown; attempts: number }[]>`
      UPDATE "jobs" SET "status" = 'RUNNING', "locked_until" = ${new Date(now.getTime() + LEASE_MS)},
             "attempts" = "attempts" + 1, "updated_at" = now()
       WHERE "id" IN (
         SELECT "id" FROM "jobs"
          WHERE ("status" = 'QUEUED' AND "run_after" <= ${now})
             OR ("status" = 'RUNNING' AND "locked_until" < ${now})
          ORDER BY "run_after"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING "id", "type", "payload", "attempts"`;
    let succeeded = 0;
    let failed = 0;
    for (const job of claimed) {
      const ok = await this.execute(job);
      if (ok) succeeded++; else failed++;
    }
    return { ran: claimed.length, succeeded, failed };
  }

  private async execute(job: { id: string; type: string; payload: unknown; attempts: number }): Promise<boolean> {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`no handler registered for ${job.type}`);
      await handler(job.payload);
      await this.prisma.job.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', lockedUntil: null, lastError: null } });
      return true;
    } catch (e) {
      const error = (e as Error).message.slice(0, 500);
      const giveUp = job.attempts >= MAX_JOB_ATTEMPTS || !handler;
      await this.prisma.job.update({
        where: { id: job.id },
        data: giveUp
          ? { status: 'FAILED', lockedUntil: null, lastError: error }
          : { status: 'QUEUED', lockedUntil: null, lastError: error, runAfter: new Date(Date.now() + backoffMs(job.attempts)) },
      });
      this.logger.warn(JSON.stringify({ event: 'job_failed', type: job.type, attempts: job.attempts, retry: !giveUp }));
      return false;
    }
  }
}

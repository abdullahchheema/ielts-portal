import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { isDue } from './schedule';

/** How long a claimed task is locked. A crashed run releases the lease after this, never sooner. */
export const LEASE_MS = 10 * 60_000;
const TICK_EVERY_MS = 60_000;

export type TaskOutcome =
  | { status: 'OK'; result?: unknown }
  | { status: 'FAILED'; error: string }
  | { status: 'SKIPPED_NOT_DUE' | 'SKIPPED_LEASED' | 'SKIPPED_BUDGET' };

interface TaskDef {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
}

/**
 * One in-process timer drives every registered task. Each run is guarded by a row in
 * scheduled_task_runs: a conditional UPDATE takes the lease only when the task is due and unleased,
 * so overlapping ticks (several instances, or an external ping while the timer is running)
 * cannot run the same task twice.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly tasks = new Map<string, TaskDef>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    if (this.config.DISABLE_SWEEPER === 'true' || this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => this.tick().catch((e) => this.logger.error(`scheduler tick failed: ${(e as Error).message}`)), TICK_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Registering the same name again replaces the task, so a module can be re-initialised safely. */
  register(name: string, everyMs: number, run: () => Promise<unknown>) {
    this.tasks.set(name, { name, everyMs, run });
  }

  names(): string[] {
    return [...this.tasks.keys()];
  }

  /**
   * Runs every due task, stopping new starts once `budgetMs` has passed. Safe to call from the
   * timer, the cron route, or several instances at once.
   */
  /**
   * Runs the due tasks within the budget. The most overdue tasks go first (never-run first), so a task that keeps
   * losing its slot to heavier tasks eventually runs. `only` restricts the tick to one named task.
   */
  async tick(budgetMs = 50_000, now = new Date(), only?: string): Promise<Record<string, TaskOutcome>> {
    const started = Date.now();
    const out: Record<string, TaskOutcome> = {};
    const candidates = [...this.tasks.values()].filter((t) => !only || t.name === only);
    const runs = await this.prisma.scheduledTaskRun.findMany({ where: { taskName: { in: candidates.map((t) => t.name) } }, select: { taskName: true, lastRunAt: true } });
    const lastRun = new Map(runs.map((r) => [r.taskName, r.lastRunAt]));
    candidates.sort((a, b) => (lastRun.get(a.name)?.getTime() ?? 0) - (lastRun.get(b.name)?.getTime() ?? 0));
    for (const task of candidates) {
      // Not-due tasks are decided from the read above, so a quiet tick costs one query, not three per task.
      if (!isDue(lastRun.get(task.name) ?? null, task.everyMs, now)) { out[task.name] = { status: 'SKIPPED_NOT_DUE' }; continue; }
      if (Date.now() - started > budgetMs) {
        out[task.name] = { status: 'SKIPPED_BUDGET' };
        continue;
      }
      const lease = await this.claim(task, now);
      if (lease === 'NOT_DUE') { out[task.name] = { status: 'SKIPPED_NOT_DUE' }; continue; }
      if (lease === 'LEASED') { out[task.name] = { status: 'SKIPPED_LEASED' }; continue; }
      try {
        const result = await task.run();
        await this.finish(task.name, now, 'OK', null);
        out[task.name] = { status: 'OK', result };
      } catch (e) {
        const error = (e as Error).message.slice(0, 500);
        this.logger.error(`task ${task.name} failed: ${error}`);
        await this.finish(task.name, now, 'FAILED', error);
        out[task.name] = { status: 'FAILED', error };
      }
    }
    return out;
  }

  private async claim(task: TaskDef, now: Date): Promise<'RUN' | 'NOT_DUE' | 'LEASED'> {
    await this.prisma.scheduledTaskRun.createMany({ data: [{ taskName: task.name }], skipDuplicates: true });
    const row = await this.prisma.scheduledTaskRun.findUnique({ where: { taskName: task.name }, select: { lastRunAt: true } });
    if (!isDue(row?.lastRunAt ?? null, task.everyMs, now)) return 'NOT_DUE';
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const dueBefore = new Date(now.getTime() - task.everyMs);
    const taken = await this.prisma.$executeRaw`
      UPDATE "scheduled_task_runs"
         SET "locked_until" = ${leaseUntil}, "updated_at" = now()
       WHERE "task_name" = ${task.name}
         AND ("locked_until" IS NULL OR "locked_until" < ${now})
         AND ("last_run_at" IS NULL OR "last_run_at" <= ${dueBefore})`;
    return taken === 1 ? 'RUN' : 'LEASED';
  }

  private async finish(name: string, now: Date, status: 'OK' | 'FAILED', error: string | null) {
    await this.prisma.scheduledTaskRun.update({
      where: { taskName: name },
      data: { lastRunAt: now, lockedUntil: null, lastStatus: status, lastError: error },
    });
  }
}

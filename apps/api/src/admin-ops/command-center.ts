import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';
import { TeacherWorkspaceModule, TeacherWorkspaceService } from '../teacher-workspace/teacher-workspace';

const DAY = 86_400_000;

export interface Metric { key: string; label: string; value: number; href: string; attention: boolean }

/**
 * Admin command centre. Every metric links to the screen where it is acted on, and only metrics the caller may see
 * are returned. Alerts describe things that need an operator's attention: stale schedulers, failing jobs and AI calls,
 * and missing configuration.
 */
@Injectable()
export class CommandCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: TeacherWorkspaceService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async overview(perms: Set<string>, now = new Date()) {
    const startToday = new Date(now); startToday.setUTCHours(0, 0, 0, 0);
    const metrics: Metric[] = [];
    const add = (m: Metric) => metrics.push(m);

    if (perms.has('payment.verify')) {
      const n = await this.prisma.paymentProof.count({ where: { status: 'SUBMITTED' } });
      add({ key: 'payments', label: 'Payments to verify', value: n, href: '/admin/applications?tab=payments', attention: n > 0 });
    }
    if (perms.has('payment.view')) {
      const n = await this.prisma.paymentProof.count({ where: { status: 'SUBMITTED', flags: { hasSome: ['AMOUNT_MISMATCH', 'DUPLICATE_TXN_REFERENCE'] } } });
      add({ key: 'flagged', label: 'Flagged payments', value: n, href: '/admin/applications?flag=any', attention: n > 0 });
    }
    if (perms.has('student.view')) {
      const n = await this.prisma.studentEngagement.count({ where: { status: { in: ['AT_RISK', 'INACTIVE'] } } });
      add({ key: 'at-risk', label: 'Students at risk', value: n, href: '/admin/engagement', attention: n > 0 });
    }
    if (perms.has('submission.grade')) {
      const n = await this.prisma.submission.count({ where: { status: 'SUBMITTED' } });
      add({ key: 'grading', label: 'Submissions to grade', value: n, href: '/admin/grading', attention: n > 0 });
    }
    if (perms.has('ticket.manage')) {
      const n = await this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } } });
      const breached = await this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] }, slaDueAt: { lt: now } } });
      add({ key: 'tickets', label: 'Open tickets', value: n, href: '/admin/tickets?status=OPEN', attention: breached > 0 });
    }
    if (perms.has('enrollment.view')) {
      const n = await this.prisma.enrollment.count({ where: { status: 'PENDING_PAYMENT', deletedAt: null } });
      add({ key: 'applications', label: 'Applications pending', value: n, href: '/admin/applications', attention: n > 0 });
    }
    if (perms.has('batch.view')) {
      const n = await this.prisma.liveSession.count({ where: { startsAt: { gte: startToday, lt: new Date(startToday.getTime() + DAY) }, status: { not: 'CANCELLED' } } });
      add({ key: 'classes', label: 'Classes today', value: n, href: '/admin/batches', attention: false });
    }

    const out: Record<string, unknown> = { metrics };
    if (perms.has('batch.view')) {
      const health = await this.workspace.allBatchHealth(20);
      out.batchHealth = health.map((h) => {
        const x = h as unknown as { batch: string; status: string; reasons: string[] };
        return { batch: x.batch, status: x.status, reasons: x.reasons.slice(0, 3) };
      });
    }
    if (perms.has('student.view')) {
      const dist = await this.prisma.studentEngagement.groupBy({ by: ['status'], _count: { _all: true } });
      out.riskDistribution = Object.fromEntries(dist.map((d) => [d.status, d._count._all]));
    }
    if (perms.has('report.academic.view')) {
      const since = new Date(now.getTime() - 42 * DAY);
      const enrolments = await this.prisma.enrollment.findMany({ where: { createdAt: { gte: since }, deletedAt: null }, select: { createdAt: true }, take: 5000 });
      const weeks = new Map<string, number>();
      for (const e of enrolments) {
        const d = new Date(e.createdAt); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
        const k = d.toISOString().slice(0, 10);
        weeks.set(k, (weeks.get(k) ?? 0) + 1);
      }
      out.enrolmentTrend = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count }));
      const bands = await this.prisma.assessmentAttempt.groupBy({
        by: ['assessmentId'], where: { submittedAt: { gte: new Date(now.getTime() - 30 * DAY) }, bandScore: { not: null } }, _avg: { bandScore: true }, _count: { _all: true },
      });
      out.assessmentPerformance = bands.slice(0, 10).map((b) => ({ assessmentId: b.assessmentId, averageBand: b._avg.bandScore === null ? null : Number(b._avg.bandScore), attempts: b._count._all }));
    }
    if (perms.has('audit.view')) {
      out.recentActivity = await this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { action: true, entityType: true, createdAt: true } });
    }
    if (perms.has('settings.edit') || perms.has('admin.manage')) {
      out.alerts = await this.alerts(now);
    }
    return out;
  }

  /** What needs an operator's attention right now. Each alert names the fix. */
  async alerts(now: Date) {
    const alerts: { level: 'RED' | 'YELLOW'; message: string }[] = [];
    const lifecycle = await this.prisma.scheduledTaskRun.findUnique({ where: { taskName: 'lifecycle.sweep' }, select: { lastRunAt: true } });
    if (!lifecycle?.lastRunAt || now.getTime() - lifecycle.lastRunAt.getTime() > 30 * 60_000) {
      alerts.push({ level: 'RED', message: 'The scheduled tasks have not run in 30 minutes. Check the cron ping (see docs/DEPLOYMENT.md).' });
    }
    const failedJobs = await this.prisma.job.count({ where: { status: 'FAILED', updatedAt: { gte: new Date(now.getTime() - DAY) } } });
    if (failedJobs > 0) alerts.push({ level: 'YELLOW', message: `${failedJobs} background job${failedJobs === 1 ? ' has' : 's have'} failed in the last day.` });
    const aiFailures = await this.prisma.aiRequest.count({ where: { status: 'FAILED', createdAt: { gte: new Date(now.getTime() - DAY) } } });
    if (aiFailures > 0) alerts.push({ level: 'YELLOW', message: `${aiFailures} AI call${aiFailures === 1 ? ' has' : 's have'} failed in the last day. Submissions are kept and retried.` });
    if (this.config.AI_PROVIDER === 'openai' && !this.config.AI_API_KEY) alerts.push({ level: 'YELLOW', message: 'AI is set to OpenAI but no API key is configured.' });
    if (!this.config.S3_BUCKET) alerts.push({ level: 'YELLOW', message: 'File storage is local. Set S3 before going live so receipts and recordings survive a redeploy.' });
    if (!this.config.RESEND_API_KEY) alerts.push({ level: 'YELLOW', message: 'Email is not configured, so emails are only logged.' });
    return alerts;
  }
}

@Controller('admin/command-center')
export class CommandCenterController {
  constructor(private readonly center: CommandCenterService, private readonly ctx: UserContextService) {}

  @RequirePermission('dashboard.view') @Get()
  async overview(@CurrentUser() u: AuthUser) {
    return this.center.overview((await this.ctx.get(u.id))!.permissions);
  }
}

@Module({ imports: [TeacherWorkspaceModule], controllers: [CommandCenterController], providers: [CommandCenterService] })
export class CommandCenterModule {}

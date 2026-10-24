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

    const [payments, flagged, atRisk, grading, tickets, applications, classes, batchHealth, riskDistribution, academic, recentActivity, alerts] = await Promise.all([
      perms.has('payment.verify') ? this.prisma.paymentProof.count({ where: { status: 'SUBMITTED' } }) : null,
      perms.has('payment.view') ? this.prisma.paymentProof.count({ where: { status: 'SUBMITTED', flags: { hasSome: ['AMOUNT_MISMATCH', 'DUPLICATE_TXN_REFERENCE'] } } }) : null,
      perms.has('student.view') ? this.prisma.studentEngagement.count({ where: { status: { in: ['AT_RISK', 'INACTIVE'] } } }) : null,
      perms.has('submission.grade') ? this.prisma.submission.count({ where: { status: 'SUBMITTED' } }) : null,
      perms.has('ticket.manage')
        ? Promise.all([
            this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } } }),
            this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] }, slaDueAt: { lt: now } } }),
          ])
        : null,
      perms.has('enrollment.view') ? this.prisma.enrollment.count({ where: { status: 'PENDING_PAYMENT', deletedAt: null } }) : null,
      perms.has('batch.view') ? this.prisma.liveSession.count({ where: { startsAt: { gte: startToday, lt: new Date(startToday.getTime() + DAY) }, status: { not: 'CANCELLED' } } }) : null,
      perms.has('batch.view') ? this.workspace.allBatchHealth(20) : null,
      perms.has('student.view') ? this.prisma.studentEngagement.groupBy({ by: ['status'], _count: { _all: true } }) : null,
      perms.has('report.academic.view') ? this.academicReport(now) : null,
      perms.has('audit.view') ? this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { action: true, entityType: true, createdAt: true } }) : null,
      perms.has('settings.edit') || perms.has('admin.manage') ? this.alerts(now) : null,
    ]);

    const metrics: Metric[] = [];
    if (payments !== null) metrics.push({ key: 'payments', label: 'Payments to verify', value: payments, href: '/admin/applications?tab=payments', attention: payments > 0 });
    if (flagged !== null) metrics.push({ key: 'flagged', label: 'Flagged payments', value: flagged, href: '/admin/applications?flag=any', attention: flagged > 0 });
    if (atRisk !== null) metrics.push({ key: 'at-risk', label: 'Students at risk', value: atRisk, href: '/admin/engagement', attention: atRisk > 0 });
    if (grading !== null) metrics.push({ key: 'grading', label: 'Submissions to grade', value: grading, href: '/admin/grading', attention: grading > 0 });
    if (tickets !== null) {
      const [n, breached] = tickets;
      metrics.push({ key: 'tickets', label: 'Open tickets', value: n, href: '/admin/tickets?status=OPEN', attention: breached > 0 });
    }
    if (applications !== null) metrics.push({ key: 'applications', label: 'Applications pending', value: applications, href: '/admin/applications', attention: applications > 0 });
    if (classes !== null) metrics.push({ key: 'classes', label: 'Classes today', value: classes, href: '/admin/batches', attention: false });

    const out: Record<string, unknown> = { metrics };
    if (batchHealth !== null) {
      out.batchHealth = batchHealth.map((h) => {
        const x = h as unknown as { batch: string; status: string; reasons: string[] };
        return { batch: x.batch, status: x.status, reasons: x.reasons.slice(0, 3) };
      });
    }
    if (riskDistribution !== null) out.riskDistribution = Object.fromEntries(riskDistribution.map((d) => [d.status, d._count._all]));
    if (academic !== null) { out.enrolmentTrend = academic.enrolmentTrend; out.assessmentPerformance = academic.assessmentPerformance; }
    if (recentActivity !== null) out.recentActivity = recentActivity;
    if (alerts !== null) out.alerts = alerts;
    return out;
  }

  private async academicReport(now: Date) {
    const since = new Date(now.getTime() - 42 * DAY);
    const [enrolments, bands] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { createdAt: { gte: since }, deletedAt: null }, select: { createdAt: true }, take: 5000 }),
      this.prisma.assessmentAttempt.groupBy({
        by: ['assessmentId'], where: { submittedAt: { gte: new Date(now.getTime() - 30 * DAY) }, bandScore: { not: null } }, _avg: { bandScore: true }, _count: { _all: true },
      }),
    ]);
    const weeks = new Map<string, number>();
    for (const e of enrolments) {
      const d = new Date(e.createdAt); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const k = d.toISOString().slice(0, 10);
      weeks.set(k, (weeks.get(k) ?? 0) + 1);
    }
    const enrolmentTrend = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count }));
    const assessmentPerformance = bands.slice(0, 10).map((b) => ({ assessmentId: b.assessmentId, averageBand: b._avg.bandScore === null ? null : Number(b._avg.bandScore), attempts: b._count._all }));
    return { enrolmentTrend, assessmentPerformance };
  }

  /** What needs an operator's attention right now. Each alert names the fix. */
  async alerts(now: Date) {
    const alerts: { level: 'RED' | 'YELLOW'; message: string }[] = [];
    const [lifecycle, failedJobs, aiFailures, stubbedEmails] = await Promise.all([
      this.prisma.scheduledTaskRun.findUnique({ where: { taskName: 'lifecycle.sweep' }, select: { lastRunAt: true } }),
      this.prisma.job.count({ where: { status: 'FAILED', updatedAt: { gte: new Date(now.getTime() - DAY) } } }),
      this.prisma.aiRequest.count({ where: { status: 'FAILED', createdAt: { gte: new Date(now.getTime() - DAY) } } }),
      this.prisma.auditLog.count({ where: { action: 'EMAIL_STUBBED', createdAt: { gte: new Date(now.getTime() - DAY) } } }),
    ]);
    if (!lifecycle?.lastRunAt || now.getTime() - lifecycle.lastRunAt.getTime() > 30 * 60_000) {
      alerts.push({ level: 'RED', message: 'The scheduled tasks have not run in 30 minutes. Check the cron ping (see docs/DEPLOYMENT.md).' });
    }
    if (failedJobs > 0) alerts.push({ level: 'YELLOW', message: `${failedJobs} background job${failedJobs === 1 ? ' has' : 's have'} failed in the last day.` });
    if (aiFailures > 0) alerts.push({ level: 'YELLOW', message: `${aiFailures} AI call${aiFailures === 1 ? ' has' : 's have'} failed in the last day. Submissions are kept and retried.` });
    if (this.config.AI_PROVIDER === 'openai' && !this.config.AI_API_KEY) alerts.push({ level: 'YELLOW', message: 'AI is set to OpenAI but no API key is configured.' });
    if (!this.config.S3_BUCKET) alerts.push({ level: 'YELLOW', message: 'File storage is local. Set S3 before going live so receipts and recordings survive a redeploy.' });
    // Reports actual recent impact (how many emails were only logged, last 24h), not just that the
    // provider is unconfigured — a stale "not configured" banner is easy to tune out; a rising count
    // of real emails nobody received is not.
    if (stubbedEmails > 0) alerts.push({ level: 'YELLOW', message: `${stubbedEmails} email${stubbedEmails === 1 ? ' was' : 's were'} only logged (no provider configured), last 24h.` });
    else if (!this.config.RESEND_API_KEY) alerts.push({ level: 'YELLOW', message: 'Email is not configured, so emails are only logged.' });
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

import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (a: number, b: number) => (b > 0 ? round((a / b) * 100, 1) : null);

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Money: PAID orders in range (a refunded order is excluded from revenue and shown under refunds). */
  async finance(from: Date, to: Date) {
    const range = { gte: from, lt: to };
    const [paid, refunds, byStatus, byCourse, daily, coupons] = await Promise.all([
      this.prisma.order.aggregate({ where: { status: 'PAID', createdAt: range }, _sum: { total: true, discount: true }, _count: true }),
      this.prisma.refund.aggregate({ where: { status: 'PROCESSED', processedAt: range }, _sum: { amount: true }, _count: true }),
      this.prisma.order.groupBy({ by: ['status'], where: { createdAt: range }, _count: true }),
      this.prisma.$queryRaw<{ course: string; batch: string; revenue: string; orders: bigint }[]>`
        SELECT c.title AS course, b.name AS batch, SUM(oi.final_price)::text AS revenue, COUNT(*) AS orders
        FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN batches b ON b.id = oi.batch_id JOIN courses c ON c.id = oi.course_id
        WHERE o.status = 'PAID' AND o.created_at >= ${from} AND o.created_at < ${to}
        GROUP BY c.title, b.name ORDER BY SUM(oi.final_price) DESC LIMIT 50`,
      this.prisma.$queryRaw<{ day: Date; revenue: string; orders: bigint }[]>`
        SELECT date_trunc('day', created_at) AS day, SUM(total)::text AS revenue, COUNT(*) AS orders
        FROM orders WHERE status = 'PAID' AND created_at >= ${from} AND created_at < ${to} GROUP BY 1 ORDER BY 1`,
      this.prisma.couponRedemption.count({ where: { status: 'USED', createdAt: range } }),
    ]);
    const revenue = num(paid._sum.total);
    const refunded = num(refunds._sum.amount);
    return {
      revenue, orders: paid._count, discountsGiven: num(paid._sum.discount), refunded, refundCount: refunds._count,
      refundRatePercent: pct(refunded, revenue + refunded), netRevenue: round(revenue - refunded), couponRedemptions: coupons,
      ordersByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byCourse: byCourse.map((r) => ({ course: r.course, batch: r.batch, revenue: num(r.revenue), orders: num(r.orders) })),
      daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), revenue: num(d.revenue), orders: num(d.orders) })),
    };
  }

  async academic(from: Date, to: Date) {
    const range = { gte: from, lt: to };
    const [registrations, buyers, active, completed, expired, progress, turnaround, pending, graded, attempts, attendance] = await Promise.all([
      this.prisma.user.count({ where: { student: { isNot: null }, createdAt: range } }),
      this.prisma.order.findMany({ where: { status: 'PAID', createdAt: range }, distinct: ['studentId'], select: { studentId: true } }),
      this.prisma.enrollment.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.enrollment.count({ where: { status: 'COMPLETED', deletedAt: null } }),
      this.prisma.enrollment.count({ where: { status: 'EXPIRED', deletedAt: null } }),
      this.prisma.enrollment.aggregate({ where: { status: { in: ['ACTIVE', 'COMPLETED'] }, deletedAt: null }, _avg: { progressPercent: true } }),
      this.prisma.$queryRaw<{ hours: string | null }[]>`SELECT AVG(EXTRACT(EPOCH FROM (graded_at - submitted_at)) / 3600)::text AS hours FROM submissions WHERE status = 'GRADED' AND graded_at >= ${from} AND graded_at < ${to}`,
      this.prisma.submission.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.submission.count({ where: { status: 'GRADED', gradedAt: range } }),
      this.prisma.assessmentAttempt.aggregate({ where: { submittedAt: range }, _avg: { percent: true, bandScore: true }, _count: true }),
      this.prisma.attendance.groupBy({ by: ['status'], where: { session: { startsAt: range } }, _count: true }),
    ]);
    const att = (s: string) => attendance.find((a) => a.status === s)?._count ?? 0;
    const attTotal = attendance.reduce((s, a) => s + a._count, 0);
    // Average improvement: first vs latest band per student per skill (needs at least two bands).
    const improvement = await this.prisma.$queryRaw<{ avg_gain: string | null; students: bigint }[]>`
      WITH bands AS (
        SELECT a.student_id, s.skill, a.band_score AS band, a.submitted_at AS at
        FROM assessment_attempts a JOIN assessments s ON s.id = a.assessment_id
        WHERE a.band_score IS NOT NULL AND s.skill IS NOT NULL
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY student_id, skill ORDER BY at ASC) AS first_rn, ROW_NUMBER() OVER (PARTITION BY student_id, skill ORDER BY at DESC) AS last_rn FROM bands
      )
      SELECT AVG(l.band - f.band)::text AS avg_gain, COUNT(DISTINCT l.student_id) AS students
      FROM ranked f JOIN ranked l ON l.student_id = f.student_id AND l.skill = f.skill
      WHERE f.first_rn = 1 AND l.last_rn = 1 AND l.at > f.at`;
    return {
      registrations, purchasingStudents: buyers.length, registrationToPurchasePercent: pct(buyers.length, registrations),
      enrollments: { active, completed, expired }, completionRatePercent: pct(completed, completed + active + expired),
      averageProgressPercent: round(num(progress._avg.progressPercent), 1),
      grading: { pending, gradedInRange: graded, averageTurnaroundHours: turnaround[0]?.hours ? round(Number(turnaround[0].hours), 1) : null },
      assessments: { attempts: attempts._count, averagePercent: round(num(attempts._avg.percent), 1), averageBand: attempts._avg.bandScore === null ? null : round(num(attempts._avg.bandScore), 2) },
      averageBandImprovement: improvement[0]?.avg_gain ? round(Number(improvement[0].avg_gain), 2) : null, studentsWithImprovementData: num(improvement[0]?.students),
      attendance: { records: attTotal, presentPercent: pct(att('PRESENT') + att('LATE'), attTotal) },
    };
  }
}

const rangeQuery = z.object({ from: z.string().date().optional(), to: z.string().date().optional() }).transform((q) => {
  const to = q.to ? new Date(`${q.to}T00:00:00Z`) : new Date(Date.now() + 86_400_000);
  if (q.to) to.setUTCDate(to.getUTCDate() + 1); // inclusive end date
  return { from: q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(Date.now() - 30 * 86_400_000), to };
});

@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly ctx: UserContextService) {}

  @RequirePermission('dashboard.view') @Get('overview')
  async overview(@Query(new ZodPipe(rangeQuery)) q: { from: Date; to: Date }, @CurrentUser() u: AuthUser) {
    const perms = (await this.ctx.get(u.id))!.permissions;
    const [finance, academic] = await Promise.all([
      perms.has('report.finance.view') ? this.reports.finance(q.from, q.to) : null,
      perms.has('report.academic.view') ? this.reports.academic(q.from, q.to) : null,
    ]);
    return { range: { from: q.from, to: q.to }, finance, academic };
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}

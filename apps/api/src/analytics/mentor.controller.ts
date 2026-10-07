import { ScopeService } from '../common/scope.service';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { forbidden, notFound } from '../common/app-error';
import { overseesAllBatches } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { BandService } from './band.service';
import { RiskService } from './risk.service';
import { Student360Service } from './student-360.service';

/** A teacher's view of one batch: each student's risk, with the reasons, and the estimated band. */
@Controller('mentor/batches')
export class MentorBatchAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService, private readonly prisma: PrismaService, private readonly ctx: UserContextService, private readonly scope: ScopeService) {}

  @RequirePermission('teaching.view')
  @Get(':id/analytics')
  async batch(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) batchId: string) {
    const c = (await this.ctx.get(u.id))!;
    await this.scope.assertBatch({ mentorId: u.mentorId, canOverseeAll: overseesAllBatches(c.permissions) }, batchId);
    const { rows, truncated } = await this.analytics.cohort({ batchId });
    const attendance = rows.map((r) => r.attendancePercent).filter((p): p is number => p !== null);
    return {
      batchId,
      truncated,
      summary: {
        students: rows.length,
        atRisk: rows.filter((r) => r.level === 'RED').length,
        needsAttention: rows.filter((r) => r.level === 'YELLOW').length,
        averageAttendance: attendance.length >= 3 ? Math.round(attendance.reduce((s, x) => s + x, 0) / attendance.length) : null,
      },
      items: rows.map(({ studentId, name, level, reasons, estimatedOverall, overallStatus, target, gapToTarget, attendancePercent, daysSinceAcademicActivity }) => ({
        studentId, name, level, reasons, estimatedOverall, overallStatus, target, gapToTarget, attendancePercent, daysSinceAcademicActivity,
      })),
    };
  }
}

/**
 * The teacher\'s restricted Student 360: only students enrolled in one of the teacher\'s batches.
 * Contact, payment and order details are deliberately left out.
 */
@Controller('mentor/students')
export class MentorStudentAnalyticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: UserContextService,
    private readonly scope: ScopeService,
    private readonly bands: BandService,
    private readonly risk: RiskService,
    private readonly detail: Student360Service,
  ) {}

  @RequirePermission('teaching.view')
  @Get(':id/analytics')
  async student(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) studentId: string) {
    const c = (await this.ctx.get(u.id))!;
    // A student outside the teacher's batches gets the same answer as a missing one: no way to probe for others.
    const visibleBatches = await this.scope.visibleBatchIds({ mentorId: u.mentorId, canOverseeAll: overseesAllBatches(c.permissions) });
    if (visibleBatches) {
      const visible = await this.prisma.enrollment.count({ where: { studentId, deletedAt: null, batchId: { in: visibleBatches } } });
      if (!visible) throw notFound('Student');
    }
    const profile = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true, targetBand: true, ieltsExamDate: true } });
    if (!profile) throw notFound('Student');
    const [band, risk, attendance, assessments, assignments] = await Promise.all([
      this.bands.forStudent(studentId),
      this.risk.forStudent(studentId),
      this.detail.attendance(studentId),
      this.detail.assessments(studentId),
      this.detail.assignments(studentId),
    ]);
    return {
      name: `${profile.firstName} ${profile.lastName}`.trim(),
      target: profile.targetBand === null ? null : Number(profile.targetBand),
      examDate: profile.ieltsExamDate,
      band: {
        overall: band.overall, overallTrend: band.overallTrend, overallStatus: band.overallStatus, missingSkills: band.missingSkills,
        skills: Object.fromEntries(Object.entries(band.skills).map(([k, v]) => [k, { estimated: v.estimated, trend: v.trend, pointCount: v.pointCount }])),
      },
      risk: risk ? { level: risk.level, reasons: risk.reasons, positives: risk.positives } : null,
      attendance, assessments, assignments,
    };
  }
}

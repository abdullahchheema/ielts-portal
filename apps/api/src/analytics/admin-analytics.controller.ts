import { Controller, Get, ParseUUIDPipe, Query, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AdminAnalyticsService } from './admin-analytics.service';
import { Student360Service } from './student-360.service';
import { CSV_MAX_ROWS, toCsv } from './csv';

/**
 * Every endpoint here names its permissions explicitly. Names are personal data, so anything that
 * returns them also needs student.view. The KPI endpoint returns no names and needs only the
 * academic report permission.
 */
const cohortQuery = z.object({
  level: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
  batchId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
});
const listQuery = cohortQuery.extend({
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(25),
});

@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @RequirePermission('report.academic.view', 'student.view')
  @Get('students')
  async students(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const { rows, truncated } = await this.analytics.cohort({ level: q.level, batchId: q.batchId, search: q.search });
    return { total: rows.length, truncated, items: rows.slice(q.skip, q.skip + q.take) };
  }

  @RequirePermission('report.academic.view', 'student.view')
  @Get('export/students.csv')
  async exportStudents(@Query(new ZodPipe(cohortQuery)) q: z.infer<typeof cohortQuery>, @Res() res: Response) {
    const { rows, truncated } = await this.analytics.cohort({ level: q.level, batchId: q.batchId, search: q.search });
    if (truncated || rows.length > CSV_MAX_ROWS) {
      throw new AppError('EXPORT_TOO_LARGE', 422, `This export has more than ${CSV_MAX_ROWS} students. Narrow it by batch or status first.`);
    }
    const csv = toCsv(rows.map((r) => ({ ...r, reasons: r.reasons.join('; ') })), [
      'name', 'email', 'batchName', 'level', 'reasons', 'estimatedOverall', 'overallStatus', 'target', 'gapToTarget', 'attendancePercent', 'daysSinceAcademicActivity',
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="students-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }

  @RequirePermission('report.academic.view', 'student.view')
  @Get('needs-attention')
  needsAttention(@Query(new ZodPipe(z.object({ take: z.coerce.number().int().min(1).max(100).default(25) }))) q: { take: number }) {
    return this.analytics.needsAttention(q.take);
  }

  @RequirePermission('report.academic.view')
  @Get('kpis')
  kpis() {
    return this.analytics.kpis();
  }
}

@Controller('admin/students')
export class AdminStudentAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService, private readonly detail: Student360Service) {}

  @RequirePermission('report.academic.view', 'student.view')
  @Get(':id/analytics/attendance')
  attendance(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.detail.attendance(id);
  }

  @RequirePermission('report.academic.view', 'student.view')
  @Get(':id/analytics/assessments')
  assessments(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.detail.assessments(id);
  }

  @RequirePermission('report.academic.view', 'student.view')
  @Get(':id/analytics/assignments')
  assignments(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.detail.assignments(id);
  }

  @RequirePermission('report.academic.view', 'student.view')
  @Get(':id/analytics')
  studentAnalytics(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.analytics.studentAnalytics(id);
  }
}

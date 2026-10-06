import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { InsightsService } from './insights.service';

const uuid = new ParseUUIDPipe();
const sid = (u: AuthUser) => { if (!u.studentId) throw forbidden(); return u.studentId; };

/** The student's own insights. Every method reads only the signed-in student's rows. */
@Controller('me')
export class StudentInsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('home') home(@CurrentUser() u: AuthUser) { return this.insights.home(sid(u)); }
  @Get('weakness') weakness(@CurrentUser() u: AuthUser) { return this.insights.weakness(sid(u)); }
  @Get('readiness') readiness(@CurrentUser() u: AuthUser) { return this.insights.readiness(sid(u)); }
  @Get('target-band') target(@CurrentUser() u: AuthUser) { return this.insights.targetPlan(sid(u)); }
}

/** Staff view of one student's insights. Requires student.view, like the rest of the student record. */
@Controller('admin/students/:id/insights')
export class AdminStudentInsightsController {
  constructor(private readonly insights: InsightsService) {}

  @RequirePermission('student.view') @Get('weakness')
  weakness(@Param('id', uuid) id: string) { return this.insights.weakness(id); }

  @RequirePermission('student.view') @Get('readiness')
  readiness(@Param('id', uuid) id: string) { return this.insights.readiness(id); }
}

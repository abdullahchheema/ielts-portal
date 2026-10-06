import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { StudyPlanService, VIEWS } from './study-plan.service';

const uuid = new ParseUUIDPipe();
const sid = (u: AuthUser) => { if (!u.studentId) throw forbidden(); return u.studentId; };
const viewQuery = z.object({ view: z.enum(VIEWS).default('today') });

@Controller('me/study-plan')
export class StudentStudyPlanController {
  constructor(private readonly plans: StudyPlanService) {}

  /** Recalculates first if the plan is stale, then returns the requested view. */
  @Get()
  view(@Query(new ZodPipe(viewQuery)) q: { view: (typeof VIEWS)[number] }, @CurrentUser() u: AuthUser) {
    return this.plans.recalculate(sid(u)).then(() => this.plans.view(sid(u), q.view));
  }

  @HttpCode(200) @Post('recalculate')
  recalc(@CurrentUser() u: AuthUser) { return this.plans.recalculate(sid(u)); }

  @HttpCode(200) @Post('tasks/:id/complete')
  complete(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.plans.complete(sid(u), id); }
}

@Controller('admin/students/:id/study-plan')
export class AdminStudyPlanController {
  constructor(private readonly plans: StudyPlanService) {}

  @RequirePermission('student.view') @Get()
  view(@Param('id', uuid) id: string, @Query(new ZodPipe(viewQuery)) q: { view: (typeof VIEWS)[number] }) {
    return this.plans.view(id, q.view);
  }
}

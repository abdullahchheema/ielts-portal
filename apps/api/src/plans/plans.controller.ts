import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  AssignStudentPlanInput, ChangePlanInput, PLAN_NAMES, ReplaceEntitlementsInput, UpdatePlanInput,
  assignStudentPlanSchema, changePlanSchema, replaceEntitlementsSchema, updatePlanSchema,
} from '@ielts/validation';
import { AuthUser, CurrentUser, Public, RequirePermission, clientMeta } from '../common/decorators';
import { forbidden } from '../common/app-error';
import { ZodPipe } from '../common/zod.pipe';
import { FreeTestAdminService } from './free-test-admin.service';
import { PlansService } from './plans.service';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request) => ({ userId: u.id, ...clientMeta(req) });

const listQuery = z.object({
  studentId: z.string().uuid().optional(),
  planName: z.enum(PLAN_NAMES).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

const rotationEligibilitySchema = z.object({ eligible: z.boolean() });

/** What visitors see on the pricing page: active plans and their feature comparison. */
@Controller('public')
export class PublicPlansController {
  constructor(private readonly plans: PlansService) {}

  @Public() @Get('plans')
  list() { return this.plans.publicList(); }
}

/** The logged-in student's own plan. */
@Controller('me')
export class StudentPlanController {
  constructor(private readonly plans: PlansService) {}

  @Get('plan')
  mine(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden();
    return this.plans.myPlan(u.studentId);
  }
}

@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

  @RequirePermission('plan.manage') @Get()
  list() { return this.plans.adminList(); }

  @RequirePermission('plan.manage') @Patch(':id')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(updatePlanSchema)) body: UpdatePlanInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.plans.updatePlan(id, body, actor(u, req));
  }

  @RequirePermission('plan.manage') @Get(':id/entitlements')
  entitlements(@Param('id', uuid) id: string) { return this.plans.listEntitlements(id); }

  @RequirePermission('plan.manage') @Put(':id/entitlements')
  replaceEntitlements(@Param('id', uuid) id: string, @Body(new ZodPipe(replaceEntitlementsSchema)) body: ReplaceEntitlementsInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.plans.replaceEntitlements(id, body, actor(u, req));
  }
}

@Controller('admin/student-plans')
export class AdminStudentPlansController {
  constructor(private readonly plans: PlansService) {}

  @RequirePermission('plan.manage') @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.plans.adminStudentPlans(q); }

  @RequirePermission('plan.manage') @Post()
  assign(@Body(new ZodPipe(assignStudentPlanSchema)) body: AssignStudentPlanInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.plans.assignPlan(body, actor(u, req));
  }

  /** Upgrade or downgrade an already-enrolled student's plan (no payment taken here — the academy's
   *  payment rail is manual bank transfer, so staff confirm payment for an upgrade before calling this). */
  @RequirePermission('plan.manage') @Post(':studentId/change')
  change(@Param('studentId', uuid) studentId: string, @Body(new ZodPipe(changePlanSchema)) body: ChangePlanInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.plans.changePlan(studentId, body.planName, actor(u, req));
  }
}

/** Eligibility is otherwise automatic — publish a student-facing bank set for any of the 4 skills
 *  through the plain question-bank import/approve/publish flow and it's in the pool, no separate
 *  "add to pool" action here. The one write this controller exposes is the opt-out: excluding a
 *  specific already-published set from rotation without unpublishing it. */
@Controller('admin/free-test-pool')
export class AdminFreeTestPoolController {
  constructor(private readonly svc: FreeTestAdminService) {}

  @RequirePermission('plan.manage') @Get()
  stats() { return this.svc.poolStats(); }

  @RequirePermission('plan.manage') @Get('modules')
  listModules() { return this.svc.listModules(); }

  @RequirePermission('plan.manage') @Get('analytics')
  moduleStats() { return this.svc.moduleStats(); }

  @RequirePermission('plan.manage') @Patch('modules/:id/rotation-eligibility')
  setRotationEligibility(@Param('id', uuid) id: string, @Body(new ZodPipe(rotationEligibilitySchema)) body: z.infer<typeof rotationEligibilitySchema>) {
    return this.svc.setRotationEligibility(id, body.eligible);
  }
}

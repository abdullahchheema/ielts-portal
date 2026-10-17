import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  AssignStudentPlanInput, BulkImportInput, ChangePlanInput, PLAN_NAMES, ReplaceEntitlementsInput, UpdatePlanInput,
  assignStudentPlanSchema, bulkImportSchema, changePlanSchema, replaceEntitlementsSchema, updatePlanSchema,
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

const leadsQuery = z.object({
  status: z.enum(['CLAIMED', 'COMPLETED', 'EXPIRED']).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

/** Read-only: eligibility is automatic (publish a DIAGNOSTIC Listening/Reading assessment, or a
 *  published + student-facing Writing/Speaking prompt) — there is no "add to pool" action anymore. */
@Controller('admin/free-test-pool')
export class AdminFreeTestPoolController {
  constructor(private readonly svc: FreeTestAdminService) {}

  @RequirePermission('plan.manage') @Get()
  stats() { return this.svc.poolStats(); }

  @RequirePermission('plan.manage') @Get('modules')
  listModules() { return this.svc.listModules(); }

  /** One upload, any mix of skills — each set becomes its own independent rotation module. */
  @RequirePermission('plan.manage') @HttpCode(201) @Post('modules')
  importModules(@Body(new ZodPipe(bulkImportSchema)) body: BulkImportInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.importModules(body, actor(u, req));
  }
}

@Controller('admin/free-test-leads')
export class AdminFreeTestLeadsController {
  constructor(private readonly svc: FreeTestAdminService) {}

  @RequirePermission('plan.manage') @Get()
  list(@Query(new ZodPipe(leadsQuery)) q: z.infer<typeof leadsQuery>) { return this.svc.listLeads(q); }
}

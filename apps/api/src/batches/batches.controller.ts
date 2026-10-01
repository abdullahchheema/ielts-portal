import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  AssignMentorInput, CreateBatchInput, CreateMentorInput, UpdateBatchInput,
  assignMentorSchema, createBatchSchema, createMentorSchema, updateBatchSchema,
} from '@ielts/validation';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { forbidden } from '../common/app-error';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { UserContextService } from '../roles/user-context.service';
import { BatchesService } from './batches.service';

const uuid = new ParseUUIDPipe();
const actor = (user: AuthUser, req: Request): Actor => ({ userId: user.id, ...clientMeta(req) });
const listQuery = z.object({
  status: z.enum(['DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ARCHIVED']).optional(),
  scope: z.enum(['active', 'upcoming', 'completed']).optional(),
});

@Controller('admin')
export class AdminBatchesController {
  constructor(private readonly batches: BatchesService) {}

  @RequirePermission('batch.view') @Get('batches')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.batches.list(q); }

  @RequirePermission('batch.view') @Get('batches/:id')
  get(@Param('id', uuid) id: string) { return this.batches.get(id); }

  @RequirePermission('batch.create') @Post('batches')
  create(@Body(new ZodPipe(createBatchSchema)) body: CreateBatchInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.batches.create(body, actor(u, req));
  }

  @RequirePermission('batch.edit') @Patch('batches/:id')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateBatchSchema)) body: UpdateBatchInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.batches.update(id, body, actor(u, req));
  }

  @RequirePermission('batch.edit') @Delete('batches/:id')
  remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.batches.remove(id, actor(u, req));
  }

  @RequirePermission('mentor.assign') @Post('batches/:id/mentors')
  assign(@Param('id', uuid) id: string, @Body(new ZodPipe(assignMentorSchema)) body: AssignMentorInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.batches.assignMentor(id, body, actor(u, req));
  }

  @RequirePermission('mentor.assign') @HttpCode(204) @Delete('batches/:id/mentors/:mentorId/:role')
  async unassign(
    @Param('id', uuid) id: string, @Param('mentorId', uuid) mentorId: string, @Param('role', new ZodPipe(z.enum(['MAIN', 'WRITING', 'SPEAKING']))) role: 'MAIN' | 'WRITING' | 'SPEAKING',
    @CurrentUser() u: AuthUser, @Req() req: Request,
  ) {
    await this.batches.unassignMentor(id, mentorId, role, actor(u, req));
  }

  @RequirePermission('mentor.assign') @Get('mentors')
  mentors() { return this.batches.listMentors(); }

  @RequirePermission('mentor.assign') @Get('mentors/:id')
  mentorDetail(@Param('id', uuid) id: string) { return this.batches.mentorDetail(id); }

  @RequirePermission('mentor.assign') @Post('mentors')
  createMentor(@Body(new ZodPipe(createMentorSchema)) body: CreateMentorInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.batches.createMentor(body, actor(u, req));
  }
}

@Controller('mentor')
export class MentorPortalController {
  constructor(private readonly batches: BatchesService, private readonly ctx: UserContextService) {}

  @RequirePermission('teaching.view') @Get('batches')
  async mine(@CurrentUser() u: AuthUser) {
    if (!u.mentorId) throw forbidden('This account is not a mentor.');
    return this.batches.mentorBatches(u.mentorId);
  }

  @RequirePermission('teaching.view') @Get('dashboard')
  async dashboard(@CurrentUser() u: AuthUser) {
    if (!u.mentorId) throw forbidden('This account is not a teacher.');
    return this.batches.teacherDashboard(u.mentorId);
  }

  @RequirePermission('teaching.view') @Get('batches/:id/results')
  async results(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    const ctx = await this.ctx.get(u.id);
    return this.batches.batchResults(id, { mentorId: u.mentorId, permissions: ctx!.permissions });
  }

  @RequirePermission('teaching.view') @Get('batches/:id/students')
  async students(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    const ctx = await this.ctx.get(u.id);
    return this.batches.batchStudents(id, { mentorId: u.mentorId, permissions: ctx!.permissions });
  }
}

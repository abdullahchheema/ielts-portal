import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { emailSchema } from '@ielts/validation';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { UserContextService } from '../roles/user-context.service';
import { AdminService } from './admin.service';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

const studentsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'DEACTIVATED']).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(25),
});
const statusBody = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BLOCKED']) });
const staffBody = z.object({ email: emailSchema, roles: z.array(z.string()).min(1).max(6) });
const rolesBody = z.object({ roles: z.array(z.string()).max(6) });
const auditQuery = z.object({
  entityType: z.string().max(60).optional(),
  action: z.string().max(80).optional(),
  userId: z.string().uuid().optional(),
  before: z.string().datetime().optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly ctx: UserContextService) {}

  @RequirePermission('dashboard.view') @Get('dashboard')
  async dashboard(@CurrentUser() u: AuthUser) {
    return this.admin.dashboard((await this.ctx.get(u.id))!.permissions);
  }

  @RequirePermission('student.view') @Get('students')
  students(@Query(new ZodPipe(studentsQuery)) q: z.infer<typeof studentsQuery>) { return this.admin.listStudents(q); }

  @RequirePermission('student.view') @Get('students/:id')
  student(@Param('id', uuid) id: string) { return this.admin.studentDetail(id); }

  @RequirePermission('student.edit') @Patch('students/:userId/status')
  setStatus(@Param('userId', uuid) id: string, @Body(new ZodPipe(statusBody)) body: z.infer<typeof statusBody>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.admin.setStudentStatus(id, body.status, actor(u, req));
  }

  @RequirePermission('admin.manage') @Get('roles')
  roles() { return this.admin.listRoles(); }

  @RequirePermission('admin.manage') @Get('staff')
  staff() { return this.admin.listStaff(); }

  @RequirePermission('admin.manage') @Post('staff')
  createStaff(@Body(new ZodPipe(staffBody)) body: z.infer<typeof staffBody>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.admin.createStaff(body, actor(u, req));
  }

  @RequirePermission('admin.manage') @Put('users/:id/roles')
  setRoles(@Param('id', uuid) id: string, @Body(new ZodPipe(rolesBody)) body: z.infer<typeof rolesBody>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.admin.setRoles(id, body.roles, actor(u, req));
  }

  @RequirePermission('audit.view') @Get('audit-logs')
  audit(@Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) { return this.admin.auditLogs(q); }
}

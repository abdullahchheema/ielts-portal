import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  RejectTeacherApplicationInput, TeacherApplicationAdminUpdateInput, TeacherApplicationInput,
  rejectTeacherApplicationSchema, teacherApplicationAdminUpdateSchema, teacherApplicationSchema,
} from '@ielts/validation';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { DOCUMENT_KINDS, DocumentKind, MAX_DOCUMENT_BYTES, TeachersService } from './teachers.service';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });
const documentUpload = () => FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } });
const documentBodySchema = z.object({ kind: z.enum(DOCUMENT_KINDS), label: z.string().trim().max(120).optional() });
const listQuery = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ALL']).default('PENDING') });
type Upload = { buffer: Buffer; size: number } | undefined;

/** Applicants apply from their own verified account, so every route here needs a signed-in user. */
@Controller('teacher-applications')
export class TeacherApplicationsController {
  constructor(private readonly teachers: TeachersService) {}

  @HttpCode(201) @Post()
  apply(@Body(new ZodPipe(teacherApplicationSchema)) body: TeacherApplicationInput, @CurrentUser() user: AuthUser) {
    return this.teachers.apply(body, { id: user.id });
  }

  @HttpCode(201) @Post(':id/documents')
  @UseInterceptors(documentUpload())
  addDocument(
    @Param('id', uuid) id: string, @Body(new ZodPipe(documentBodySchema)) body: { kind: DocumentKind; label?: string },
    @UploadedFile() file: Upload, @CurrentUser() user: AuthUser,
  ) {
    return this.teachers.addDocument(id, body.kind, file, body.label, { email: user.email });
  }
}

@Controller('admin/teacher-applications')
export class AdminTeacherApplicationsController {
  constructor(private readonly teachers: TeachersService) {}

  @RequirePermission('teacher.manage') @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.teachers.adminList(q.status); }

  @RequirePermission('teacher.manage') @Get(':id')
  detail(@Param('id', uuid) id: string) { return this.teachers.adminDetail(id); }

  @RequirePermission('teacher.manage') @Patch(':id')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(teacherApplicationAdminUpdateSchema)) body: TeacherApplicationAdminUpdateInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.teachers.adminUpdate(id, body, actor(u, req));
  }

  @RequirePermission('teacher.manage') @HttpCode(200) @Post(':id/approve')
  approve(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.teachers.approve(id, actor(u, req)); }

  @RequirePermission('teacher.manage') @HttpCode(200) @Post(':id/reject')
  reject(@Param('id', uuid) id: string, @Body(new ZodPipe(rejectTeacherApplicationSchema)) body: RejectTeacherApplicationInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.teachers.reject(id, body, actor(u, req));
  }
}

@Controller('admin/teachers')
export class AdminTeachersController {
  constructor(private readonly teachers: TeachersService) {}

  @RequirePermission('teacher.manage') @HttpCode(201) @Post()
  create(@Body(new ZodPipe(teacherApplicationSchema)) body: TeacherApplicationInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.teachers.createDirect(body, actor(u, req));
  }
}

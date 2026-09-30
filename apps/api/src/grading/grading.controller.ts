import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  AssignmentSettingsInput, DraftInput, GradeInput, SubmitWritingInput,
  assignmentSettingsSchema, draftSchema, gradeSchema, submitWritingSchema,
} from '@ielts/validation';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { UserContextService } from '../roles/user-context.service';
import { GradingService, Reviewer } from './grading.service';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });
const sid = (u: AuthUser) => {
  if (!u.studentId) throw forbidden('Only student accounts can do this.');
  return u.studentId;
};
const queueQuery = z.object({
  status: z.enum(['SUBMITTED', 'GRADED']).default('SUBMITTED'),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(25),
});
type Audio = { buffer: Buffer; size: number } | undefined;

@Controller()
export class StudentSubmissionsController {
  constructor(private readonly grading: GradingService) {}

  @Put('assignments/:id/draft')
  draft(@Param('id', uuid) id: string, @Body(new ZodPipe(draftSchema)) body: DraftInput, @CurrentUser() u: AuthUser) { return this.grading.saveDraft(sid(u), id, body); }

  @HttpCode(200) @Post('assignments/:id/submit-writing')
  submitWriting(@Param('id', uuid) id: string, @Body(new ZodPipe(submitWritingSchema)) body: SubmitWritingInput, @CurrentUser() u: AuthUser) { return this.grading.submitWriting(sid(u), id, body.body); }

  @HttpCode(200) @Post('assignments/:id/submit-audio')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  submitAudio(@Param('id', uuid) id: string, @UploadedFile() file: Audio, @CurrentUser() u: AuthUser) { return this.grading.submitAudio(sid(u), id, file); }

  @Get('me/submissions')
  mine(@CurrentUser() u: AuthUser) { return this.grading.listMine(sid(u)); }

  @Get('submissions/:id')
  one(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.grading.getMine(sid(u), id); }
}

@Controller('mentor')
export class MentorSubmissionsController {
  constructor(private readonly grading: GradingService, private readonly ctx: UserContextService) {}

  private async reviewer(u: AuthUser): Promise<Reviewer> {
    const c = (await this.ctx.get(u.id))!;
    return { userId: u.id, mentorId: u.mentorId, permissions: c.permissions };
  }

  @RequirePermission('submission.view') @Get('submissions')
  async queue(@Query(new ZodPipe(queueQuery)) q: z.infer<typeof queueQuery>, @CurrentUser() u: AuthUser) { return this.grading.queue(await this.reviewer(u), q); }

  @RequirePermission('submission.view') @Get('submissions/:id')
  async detail(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.grading.detail(await this.reviewer(u), id); }

  @RequirePermission('submission.grade') @HttpCode(200) @Post('submissions/:id/grade')
  async grade(@Param('id', uuid) id: string, @Body(new ZodPipe(gradeSchema)) body: GradeInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.grading.grade(await this.reviewer(u), id, body, actor(u, req));
  }
}

@Controller('admin')
export class AdminGradingController {
  constructor(private readonly grading: GradingService) {}

  @RequirePermission('content.manage') @Get('rubrics')
  rubrics() { return this.grading.listRubrics(); }

  @RequirePermission('content.manage') @Put('items/:id/assignment')
  setAssignment(@Param('id', uuid) id: string, @Body(new ZodPipe(assignmentSettingsSchema)) body: AssignmentSettingsInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.grading.setAssignment(id, body, actor(u, req));
  }
}

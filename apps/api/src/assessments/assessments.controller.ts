import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import {
  AssessmentSectionInput, BandTableInput, CreateAssessmentInput, QuestionInput, SaveAnswersInput, UpdateAssessmentInput, UpdateAssessmentSectionInput, UpdateQuestionInput,
  assessmentSectionSchema, bandTableSchema, createAssessmentSchema, questionSchema, saveAnswersSchema, updateAssessmentSchema, updateAssessmentSectionSchema, updateQuestionSchema,
} from '@ielts/validation';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { AssessmentsAdminService } from './assessments-admin.service';
import { AttemptsService } from './attempts.service';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });
const student = (u: AuthUser) => {
  if (!u.studentId) throw forbidden('Only student accounts can do this.');
  return { studentId: u.studentId };
};
type AudioFile = { buffer: Buffer; size: number; originalname: string } | undefined;

@Controller('admin')
export class AdminAssessmentsController {
  constructor(private readonly admin: AssessmentsAdminService) {}

  @RequirePermission('assessment.manage') @Get('assessments')
  list() { return this.admin.list(); }

  @RequirePermission('assessment.manage') @Get('assessments/:id')
  get(@Param('id', uuid) id: string) { return this.admin.get(id); }

  @RequirePermission('assessment.manage') @Post('assessments')
  create(@Body(new ZodPipe(createAssessmentSchema)) body: CreateAssessmentInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.create(body, actor(u, req)); }

  @RequirePermission('assessment.manage') @Patch('assessments/:id')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateAssessmentSchema)) body: UpdateAssessmentInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.update(id, body, actor(u, req)); }

  @RequirePermission('assessment.manage') @Post('assessments/:id/versions')
  newVersion(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.createVersion(id, actor(u, req)); }

  @RequirePermission('assessment.manage') @Get('assessment-versions/:id')
  version(@Param('id', uuid) id: string) { return this.admin.getVersion(id); }

  @RequirePermission('assessment.manage') @HttpCode(200) @Post('assessment-versions/:id/publish')
  publish(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.publishVersion(id, actor(u, req)); }

  @RequirePermission('assessment.manage') @Post('assessment-versions/:id/sections')
  addSection(@Param('id', uuid) id: string, @Body(new ZodPipe(assessmentSectionSchema)) body: AssessmentSectionInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.createSection(id, body, actor(u, req)); }

  @RequirePermission('assessment.manage') @Patch('assessment-sections/:id')
  editSection(@Param('id', uuid) id: string, @Body(new ZodPipe(updateAssessmentSectionSchema)) body: UpdateAssessmentSectionInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.updateSection(id, body, actor(u, req)); }

  @RequirePermission('assessment.manage') @HttpCode(204) @Delete('assessment-sections/:id')
  async removeSection(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { await this.admin.deleteSection(id, actor(u, req)); }

  @RequirePermission('assessment.manage') @HttpCode(201) @Post('assessment-sections/:id/audio')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  audio(@Param('id', uuid) id: string, @UploadedFile() file: AudioFile, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.attachAudio(id, file, actor(u, req)); }

  @RequirePermission('assessment.manage') @Post('assessment-sections/:id/questions')
  addQuestion(@Param('id', uuid) id: string, @Body(new ZodPipe(questionSchema)) body: QuestionInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.createQuestion(id, body, actor(u, req)); }

  @RequirePermission('assessment.manage') @Patch('assessment-questions/:id')
  editQuestion(@Param('id', uuid) id: string, @Body(new ZodPipe(updateQuestionSchema)) body: UpdateQuestionInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.updateQuestion(id, body, actor(u, req)); }

  @RequirePermission('assessment.manage') @HttpCode(204) @Delete('assessment-questions/:id')
  async removeQuestion(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { await this.admin.deleteQuestion(id, actor(u, req)); }

  @RequirePermission('assessment.manage') @Get('band-conversions')
  bandTables() { return this.admin.listBandTables(); }

  @RequirePermission('assessment.manage') @Post('band-conversions')
  saveBandTable(@Body(new ZodPipe(bandTableSchema)) body: BandTableInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.admin.saveBandTable(body, actor(u, req)); }
}

@Controller()
export class StudentAssessmentsController {
  constructor(private readonly attempts: AttemptsService) {}

  @HttpCode(201) @Post('assessments/:id/start')
  start(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.attempts.start(student(u), id); }

  @Get('attempts/:id')
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.attempts.getAttempt(student(u), id); }

  @Put('attempts/:id/answers')
  save(@Param('id', uuid) id: string, @Body(new ZodPipe(saveAnswersSchema)) body: SaveAnswersInput, @CurrentUser() u: AuthUser) { return this.attempts.saveAnswers(student(u), id, body); }

  @HttpCode(200) @Post('attempts/:id/submit')
  submit(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.attempts.submit(student(u), id); }

  @Get('attempts/:id/result')
  result(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.attempts.result(student(u), id); }

  @Get('me/diagnostics')
  diagnostics(@CurrentUser() u: AuthUser) { return this.attempts.diagnostics(student(u).studentId); }

  @Get('me/assessments/history')
  history(@CurrentUser() u: AuthUser) { return this.attempts.history(student(u).studentId); }

  @Get('me/skills')
  skills(@CurrentUser() u: AuthUser) { return this.attempts.skillProgress(student(u).studentId); }
}

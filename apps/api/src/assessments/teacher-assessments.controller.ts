import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import {
  AssessmentSectionInput, QuestionInput, TeacherCreateAssessmentInput, UpdateAssessmentInput, UpdateAssessmentSectionInput, UpdateQuestionInput,
  assessmentSectionSchema, questionSchema, teacherCreateAssessmentSchema, updateAssessmentSchema, updateAssessmentSectionSchema, updateQuestionSchema,
} from '@ielts/validation';
import { forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssessmentsAdminService } from './assessments-admin.service';
import { AssessmentsModule } from './assessments.module';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });
const mentorId = (u: AuthUser) => {
  if (!u.mentorId) throw forbidden('Only teacher accounts can do this.');
  return u.mentorId;
};
type AudioFile = { buffer: Buffer; size: number; originalname: string } | undefined;

/**
 * Teacher-authored assessments (Listening/Reading only): a mentor builds from the same
 * AssessmentsAdminService the admin section uses — the literal reuse the brief calls for — wrapped
 * with an ownership guard so one mentor never sees or edits another's drafts. `assessment.manage`
 * (admin) and `assessment.author` (this controller) are deliberately separate permissions: an
 * admin-created assessment (createdByMentorId: null) is never reachable here, and a teacher-created
 * one is never reachable through the admin routes' RequirePermission('assessment.manage') gate
 * either way — ownership scoping only ever applies to this path.
 */
@Injectable()
export class TeacherAssessmentsService {
  constructor(private readonly prisma: PrismaService, private readonly admin: AssessmentsAdminService) {}

  private async assertOwnsAssessment(mentorId: string, assessmentId: string) {
    const a = await this.prisma.assessment.findFirst({ where: { id: assessmentId, createdByMentorId: mentorId } });
    if (!a) throw notFound('Assessment');
    return a;
  }

  private async assertOwnsVersion(mentorId: string, versionId: string) {
    const v = await this.prisma.assessmentVersion.findUnique({ where: { id: versionId }, select: { assessmentId: true } });
    if (!v) throw notFound('Assessment version');
    await this.assertOwnsAssessment(mentorId, v.assessmentId);
  }

  private async assertOwnsSection(mentorId: string, sectionId: string) {
    const s = await this.prisma.assessmentSection.findUnique({ where: { id: sectionId }, select: { assessmentVersionId: true } });
    if (!s) throw notFound('Section');
    await this.assertOwnsVersion(mentorId, s.assessmentVersionId);
  }

  private async assertOwnsQuestion(mentorId: string, questionId: string) {
    const q = await this.prisma.question.findFirst({ where: { id: questionId, deletedAt: null }, select: { sectionId: true } });
    if (!q || !q.sectionId) throw notFound('Question');
    await this.assertOwnsSection(mentorId, q.sectionId);
  }

  list(mentorId: string) {
    return this.prisma.assessment.findMany({
      where: { createdByMentorId: mentorId }, orderBy: { createdAt: 'desc' },
      include: { versions: { select: { id: true, version: true, publishedAt: true }, orderBy: { version: 'desc' } }, _count: { select: { attempts: true } } },
    });
  }

  async get(mentorId: string, id: string) {
    await this.assertOwnsAssessment(mentorId, id);
    return this.admin.get(id);
  }

  create(mentorId: string, input: TeacherCreateAssessmentInput, actor: Actor) {
    return this.admin.create(input, actor, mentorId);
  }

  async update(mentorId: string, id: string, input: UpdateAssessmentInput, actor: Actor) {
    await this.assertOwnsAssessment(mentorId, id);
    return this.admin.update(id, input, actor);
  }

  async createVersion(mentorId: string, assessmentId: string, actor: Actor) {
    await this.assertOwnsAssessment(mentorId, assessmentId);
    return this.admin.createVersion(assessmentId, actor);
  }

  async getVersion(mentorId: string, versionId: string) {
    await this.assertOwnsVersion(mentorId, versionId);
    return this.admin.getVersion(versionId);
  }

  async publishVersion(mentorId: string, versionId: string, actor: Actor) {
    await this.assertOwnsVersion(mentorId, versionId);
    return this.admin.publishVersion(versionId, actor);
  }

  async createSection(mentorId: string, versionId: string, input: AssessmentSectionInput, actor: Actor) {
    await this.assertOwnsVersion(mentorId, versionId);
    return this.admin.createSection(versionId, input, actor);
  }

  async updateSection(mentorId: string, id: string, input: UpdateAssessmentSectionInput, actor: Actor) {
    await this.assertOwnsSection(mentorId, id);
    return this.admin.updateSection(id, input, actor);
  }

  async deleteSection(mentorId: string, id: string, actor: Actor) {
    await this.assertOwnsSection(mentorId, id);
    return this.admin.deleteSection(id, actor);
  }

  async attachAudio(mentorId: string, sectionId: string, file: AudioFile, actor: Actor) {
    await this.assertOwnsSection(mentorId, sectionId);
    return this.admin.attachAudio(sectionId, file, actor);
  }

  async createQuestion(mentorId: string, sectionId: string, input: QuestionInput, actor: Actor) {
    await this.assertOwnsSection(mentorId, sectionId);
    return this.admin.createQuestion(sectionId, input, actor);
  }

  async updateQuestion(mentorId: string, id: string, input: UpdateQuestionInput, actor: Actor) {
    await this.assertOwnsQuestion(mentorId, id);
    return this.admin.updateQuestion(id, input, actor);
  }

  async deleteQuestion(mentorId: string, id: string, actor: Actor) {
    await this.assertOwnsQuestion(mentorId, id);
    return this.admin.deleteQuestion(id, actor);
  }
}

@Controller('mentor/assessments')
export class TeacherAssessmentsController {
  constructor(private readonly svc: TeacherAssessmentsService) {}

  @RequirePermission('assessment.author') @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(mentorId(u)); }

  @RequirePermission('assessment.author') @Get(':id') get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.svc.get(mentorId(u), id); }

  @RequirePermission('assessment.author') @Post() create(@Body(new ZodPipe(teacherCreateAssessmentSchema)) body: TeacherCreateAssessmentInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.create(mentorId(u), body, actor(u, req));
  }

  @RequirePermission('assessment.author') @Patch(':id') update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateAssessmentSchema)) body: UpdateAssessmentInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.update(mentorId(u), id, body, actor(u, req));
  }

  @RequirePermission('assessment.author') @Post(':id/versions') newVersion(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.createVersion(mentorId(u), id, actor(u, req));
  }

  @RequirePermission('assessment.author') @Get('versions/:id') version(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.svc.getVersion(mentorId(u), id); }

  @RequirePermission('assessment.author') @HttpCode(200) @Post('versions/:id/publish')
  publish(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.publishVersion(mentorId(u), id, actor(u, req)); }

  @RequirePermission('assessment.author') @Post('versions/:id/sections')
  addSection(@Param('id', uuid) id: string, @Body(new ZodPipe(assessmentSectionSchema)) body: AssessmentSectionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.createSection(mentorId(u), id, body, actor(u, req));
  }

  @RequirePermission('assessment.author') @Patch('sections/:id')
  editSection(@Param('id', uuid) id: string, @Body(new ZodPipe(updateAssessmentSectionSchema)) body: UpdateAssessmentSectionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.updateSection(mentorId(u), id, body, actor(u, req));
  }

  @RequirePermission('assessment.author') @HttpCode(204) @Delete('sections/:id')
  async removeSection(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { await this.svc.deleteSection(mentorId(u), id, actor(u, req)); }

  @RequirePermission('assessment.author') @HttpCode(201) @Post('sections/:id/audio') @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  audio(@Param('id', uuid) id: string, @UploadedFile() file: AudioFile, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.attachAudio(mentorId(u), id, file, actor(u, req));
  }

  @RequirePermission('assessment.author') @Post('sections/:id/questions')
  addQuestion(@Param('id', uuid) id: string, @Body(new ZodPipe(questionSchema)) body: QuestionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.createQuestion(mentorId(u), id, body, actor(u, req));
  }

  @RequirePermission('assessment.author') @Patch('questions/:id')
  editQuestion(@Param('id', uuid) id: string, @Body(new ZodPipe(updateQuestionSchema)) body: UpdateQuestionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.updateQuestion(mentorId(u), id, body, actor(u, req));
  }

  @RequirePermission('assessment.author') @HttpCode(204) @Delete('questions/:id')
  async removeQuestion(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { await this.svc.deleteQuestion(mentorId(u), id, actor(u, req)); }
}

@Module({
  imports: [AssessmentsModule],
  controllers: [TeacherAssessmentsController],
  providers: [TeacherAssessmentsService],
})
export class TeacherAssessmentsModule {}

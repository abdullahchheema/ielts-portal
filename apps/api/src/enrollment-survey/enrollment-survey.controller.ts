import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { surveyDraftSchema, surveySubmitSchema } from '@ielts/validation';
import { forbidden, notFound } from '../common/app-error';
import { AuthUser, clientMeta, CurrentUser, RequirePermission } from '../common/decorators';
import { overseesAllBatches } from '../common/scope';
import { ScopeService } from '../common/scope.service';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';
import { EnrollmentSurveyService } from './enrollment-survey.service';

const sid = (u: AuthUser) => { if (!u.studentId) throw forbidden(); return u.studentId; };

const draftBody = z.object({ revision: z.number().int().min(0), answers: surveyDraftSchema });

@Controller('me/enrollment-survey')
export class MyEnrollmentSurveyController {
  constructor(private readonly survey: EnrollmentSurveyService) {}

  @Get()
  mine(@CurrentUser() u: AuthUser) { return this.survey.mine(sid(u)); }

  @Put()
  save(@Body(new ZodPipe(draftBody)) body: z.infer<typeof draftBody>, @CurrentUser() u: AuthUser) {
    return this.survey.saveDraft(sid(u), body.revision, body.answers);
  }

  @Post('submit')
  submit(@Body(new ZodPipe(surveySubmitSchema)) body: z.infer<typeof surveySubmitSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.survey.submit(sid(u), u.id, body, clientMeta(req));
  }
}

@Controller()
export class StaffEnrollmentSurveyController {
  constructor(
    private readonly survey: EnrollmentSurveyService,
    private readonly prisma: PrismaService,
    private readonly ctx: UserContextService,
    private readonly scope: ScopeService,
  ) {}

  @RequirePermission('student.view')
  @Get('admin/students/:id/enrollment-survey')
  admin(@Param('id', new ParseUUIDPipe()) studentId: string) { return this.survey.forStudent(studentId); }

  @RequirePermission('teaching.view')
  @Get('mentor/students/:id/enrollment-survey')
  async mentor(@Param('id', new ParseUUIDPipe()) studentId: string, @CurrentUser() u: AuthUser) {
    const c = (await this.ctx.get(u.id))!;
    const visibleBatches = await this.scope.visibleBatchIds({ mentorId: u.mentorId, canOverseeAll: overseesAllBatches(c.permissions) });
    if (visibleBatches) {
      const visible = await this.prisma.enrollment.count({ where: { studentId, deletedAt: null, batchId: { in: visibleBatches } } });
      if (!visible) throw notFound('Student');
    }
    return this.survey.forStudent(studentId);
  }
}

@Module({
  controllers: [MyEnrollmentSurveyController, StaffEnrollmentSurveyController],
  providers: [EnrollmentSurveyService],
  exports: [EnrollmentSurveyService],
})
export class EnrollmentSurveyModule {}

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { studentProfileSchema } from '@ielts/validation';
import { z } from 'zod';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { LearningService, ProgressBody, progressBodySchema } from './learning.service';

const uuid = new ParseUUIDPipe();
const sid = (u: AuthUser) => {
  if (!u.studentId) throw forbidden('Only student accounts can do this.');
  return u.studentId;
};

@Controller()
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get('me/profile')
  profile(@CurrentUser() u: AuthUser) { return this.learning.getProfile(sid(u)); }

  @Patch('me/profile')
  updateProfile(@Body(new ZodPipe(studentProfileSchema)) body: z.infer<typeof studentProfileSchema>, @CurrentUser() u: AuthUser) {
    return this.learning.updateProfile(sid(u), body);
  }

  @Get('me/dashboard')
  dashboard(@CurrentUser() u: AuthUser) { return this.learning.dashboard(sid(u)); }

  @Get('me/enrollments')
  enrollments(@CurrentUser() u: AuthUser) { return this.learning.listEnrollments(sid(u)); }

  @Get('me/courses/:enrollmentId')
  course(@Param('enrollmentId', uuid) id: string, @CurrentUser() u: AuthUser) { return this.learning.getCourse(sid(u), id); }

  @Get('content/:id')
  open(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.learning.openItem(sid(u), id); }

  @HttpCode(200) @Post('content/:id/start')
  start(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.learning.start(sid(u), id); }

  @HttpCode(200) @Post('content/:id/progress')
  progress(@Param('id', uuid) id: string, @Body(new ZodPipe(progressBodySchema)) body: ProgressBody, @CurrentUser() u: AuthUser) {
    return this.learning.progress(sid(u), id, body);
  }

  @HttpCode(200) @Post('content/:id/complete')
  complete(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.learning.complete(sid(u), id); }
}

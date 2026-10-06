import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FeedbackService } from './feedback.service';

const uuid = new ParseUUIDPipe();
const sid = (u: AuthUser) => { if (!u.studentId) throw forbidden(); return u.studentId; };

const commentSchema = z.string().trim().max(1000).optional();
const respondSchema = z.object({
  score: z.number().int().min(0).max(10),
  anonymous: z.boolean().default(false),
  comments: z.object({
    overall: commentSchema,
    teacher: commentSchema,
    course: commentSchema,
    technical: commentSchema,
  }).default({}),
});

const summaryQuery = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) });

@Controller('me/feedback')
export class StudentFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('pending')
  pending(@CurrentUser() u: AuthUser) { return this.feedback.pending(sid(u)); }

  @HttpCode(201) @Post(':id/respond')
  respond(@Param('id', uuid) id: string, @Body(new ZodPipe(respondSchema)) body: z.infer<typeof respondSchema>, @CurrentUser() u: AuthUser) {
    return this.feedback.respond(sid(u), id, body);
  }

  @HttpCode(200) @Post(':id/dismiss')
  dismiss(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.feedback.dismiss(sid(u), id); }
}

@Controller('admin/feedback')
export class AdminFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @RequirePermission('feedback.view') @Get()
  summary(@Query(new ZodPipe(summaryQuery)) q: z.infer<typeof summaryQuery>) { return this.feedback.summary(q.days); }

  @RequirePermission('feedback.view') @Get('themes')
  themes(@Query(new ZodPipe(summaryQuery)) q: z.infer<typeof summaryQuery>) { return this.feedback.aiThemes(q.days); }
}

@Module({
  controllers: [StudentFeedbackController, AdminFeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}

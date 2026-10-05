import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermission } from '../common/decorators';
import { ContentAnalyticsService } from './content-analytics.service';

/** Course and question analytics. Content-quality figures; they do not identify students. */
@Controller('admin/analytics')
export class ContentAnalyticsController {
  constructor(private readonly content: ContentAnalyticsService) {}

  @RequirePermission('report.academic.view', 'course.view')
  @Get('courses/:courseVersionId')
  courses(@Param('courseVersionId', new ParseUUIDPipe()) courseVersionId: string) {
    return this.content.courseItems(courseVersionId);
  }

  @RequirePermission('report.academic.view', 'assessment.manage')
  @Get('questions')
  questions(@Query('assessmentId', new ParseUUIDPipe()) assessmentId: string) {
    return this.content.questions(assessmentId);
  }
}

import { Module } from '@nestjs/common';
import { BandService } from './band.service';
import { RiskService } from './risk.service';
import { StudentRiskController } from './student.controller';
import { AdminAnalyticsController, AdminStudentAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminSearchController } from './search.controller';
import { ContentAnalyticsController } from './content.controller';
import { ContentAnalyticsService } from './content-analytics.service';
import { Student360Service } from './student-360.service';
import { MentorBatchAnalyticsController, MentorStudentAnalyticsController } from './mentor.controller';

/** Read-only analytics. Depends on Prisma and settings only, never on feature modules, so feature modules can import it without a cycle. */
@Module({
  controllers: [StudentRiskController, AdminAnalyticsController, AdminStudentAnalyticsController, AdminSearchController, ContentAnalyticsController, MentorBatchAnalyticsController, MentorStudentAnalyticsController],
  providers: [BandService, RiskService, AdminAnalyticsService, ContentAnalyticsService, Student360Service],
  exports: [BandService, RiskService],
})
export class AnalyticsModule {}

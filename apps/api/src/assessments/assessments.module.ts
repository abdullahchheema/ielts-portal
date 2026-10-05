import { AnalyticsModule } from '../analytics/analytics.module';
import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module';
import { AdminAssessmentsController, StudentAssessmentsController } from './assessments.controller';
import { AssessmentsAdminService } from './assessments-admin.service';
import { AttemptsService } from './attempts.service';

@Module({
  imports: [LearningModule, AnalyticsModule],
  controllers: [AdminAssessmentsController, StudentAssessmentsController],
  providers: [AssessmentsAdminService, AttemptsService],
  exports: [AttemptsService],
})
export class AssessmentsModule {}

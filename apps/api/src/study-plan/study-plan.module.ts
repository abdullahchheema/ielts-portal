import { Module } from '@nestjs/common';
import { InsightsModule } from '../insights/insights.module';
import { AdminStudyPlanController, StudentStudyPlanController } from './study-plan.controller';
import { StudyPlanService } from './study-plan.service';

@Module({
  imports: [InsightsModule],
  controllers: [StudentStudyPlanController, AdminStudyPlanController],
  providers: [StudyPlanService],
  exports: [StudyPlanService],
})
export class StudyPlanModule {}

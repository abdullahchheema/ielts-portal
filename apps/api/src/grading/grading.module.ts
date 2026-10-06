import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module';
import { WritingModule } from '../writing/writing.module';
import { AdminGradingController, MentorSubmissionsController, StudentSubmissionsController } from './grading.controller';
import { GradingService } from './grading.service';

@Module({
  imports: [LearningModule, WritingModule],
  controllers: [StudentSubmissionsController, MentorSubmissionsController, AdminGradingController],
  providers: [GradingService],
  exports: [GradingService],
})
export class GradingModule {}

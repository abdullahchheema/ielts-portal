import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module';
import { MocksModule } from '../mocks/mocks.service';
import { AdminAssessmentsController, StudentAssessmentsController } from './assessments.controller';
import { AssessmentsAdminService } from './assessments-admin.service';
import { AttemptsService } from './attempts.service';

@Module({
  imports: [LearningModule, MocksModule],
  controllers: [AdminAssessmentsController, StudentAssessmentsController],
  providers: [AssessmentsAdminService, AttemptsService],
  exports: [AttemptsService],
})
export class AssessmentsModule {}

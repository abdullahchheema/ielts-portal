import { Module } from '@nestjs/common';
import { AdminStudentInsightsController, StudentInsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  controllers: [StudentInsightsController, AdminStudentInsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}

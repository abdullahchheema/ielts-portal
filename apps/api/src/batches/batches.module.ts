import { AnalyticsModule } from '../analytics/analytics.module';
import { Module } from '@nestjs/common';
import { AdminBatchesController, MentorPortalController } from './batches.controller';
import { BatchesService } from './batches.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [AdminBatchesController, MentorPortalController],
  providers: [BatchesService],
  exports: [BatchesService],
})
export class BatchesModule {}

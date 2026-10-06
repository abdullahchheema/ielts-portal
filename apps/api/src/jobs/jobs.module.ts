import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { SchedulerService } from './scheduler.service';

@Global()
@Module({
  providers: [SchedulerService, JobsService],
  exports: [SchedulerService, JobsService],
})
export class JobsModule {}

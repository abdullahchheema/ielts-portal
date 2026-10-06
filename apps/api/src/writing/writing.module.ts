import { Module } from '@nestjs/common';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';

@Module({
  controllers: [WritingController],
  providers: [WritingService],
  exports: [WritingService],
})
export class WritingModule {}

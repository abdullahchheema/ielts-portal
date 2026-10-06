import { Module } from '@nestjs/common';
import { GrammarModule } from '../grammar/grammar.service';
import { WritingController, WritingHistoryController } from './writing.controller';
import { WritingService } from './writing.service';

@Module({
  imports: [GrammarModule],
  controllers: [WritingController, WritingHistoryController],
  providers: [WritingService],
  exports: [WritingService],
})
export class WritingModule {}

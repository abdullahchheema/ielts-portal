import { Module } from '@nestjs/common';
import { QuestionBankModule } from '../question-bank/question-bank.module';
import { SpeakingController } from './speaking.controller';
import { SpeakingService } from './speaking.service';

@Module({
  imports: [QuestionBankModule],
  controllers: [SpeakingController],
  providers: [SpeakingService],
  exports: [SpeakingService],
})
export class SpeakingModule {}

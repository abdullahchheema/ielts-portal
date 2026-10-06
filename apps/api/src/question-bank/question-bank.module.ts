import { Module } from '@nestjs/common';
import { AdminBankCopyController, AdminQuestionSetsController, StudentPracticeController } from './question-bank.controller';
import { QuestionBankService } from './question-bank.service';

@Module({
  controllers: [AdminQuestionSetsController, AdminBankCopyController, StudentPracticeController],
  providers: [QuestionBankService],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}

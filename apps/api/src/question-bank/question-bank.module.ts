import { Module } from '@nestjs/common';
import { AdminBankCopyController, AdminQuestionSetsController, StudentPracticeController } from './question-bank.controller';
import { QuestionImportService } from './import.service';
import { QuestionBankService } from './question-bank.service';

@Module({
  controllers: [AdminQuestionSetsController, AdminBankCopyController, StudentPracticeController],
  providers: [QuestionBankService, QuestionImportService],
  exports: [QuestionBankService, QuestionImportService],
})
export class QuestionBankModule {}

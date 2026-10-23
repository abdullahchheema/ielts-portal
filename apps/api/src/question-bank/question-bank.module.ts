import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module';
import { AdminBankCopyController, AdminQuestionSetsController, StudentPracticeController } from './question-bank.controller';
import { QuestionImportService } from './import.service';
import { QuestionBankService } from './question-bank.service';
import { RotationService } from './rotation.service';

@Module({
  imports: [AssessmentsModule],
  controllers: [AdminQuestionSetsController, AdminBankCopyController, StudentPracticeController],
  providers: [QuestionBankService, QuestionImportService, RotationService],
  exports: [QuestionBankService, QuestionImportService, RotationService],
})
export class QuestionBankModule {}

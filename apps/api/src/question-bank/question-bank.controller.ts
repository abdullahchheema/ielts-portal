import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  BankPickInput, BankQuestionInput, CopyToSectionInput, PracticeSessionInput, QuestionSetCreateInput, QuestionSetStatusInput, QuestionSetUpdateInput,
  bankPickSchema, bankQuestionSchema, bankQuestionUpdateSchema, copyToSectionSchema, practiceSessionSchema, questionSetCreateSchema, questionSetStatusSchema, questionSetUpdateSchema,
} from '@ielts/validation';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { forbidden } from '../common/app-error';
import { ZodPipe } from '../common/zod.pipe';
import { QuestionBankService } from './question-bank.service';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request) => ({ userId: u.id, ...clientMeta(req) });

const listQuery = z.object({
  skill: z.enum(['LISTENING', 'READING', 'WRITING', 'SPEAKING']).optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED']).optional(),
  topic: z.string().trim().max(80).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller('admin/question-sets')
export class AdminQuestionSetsController {
  constructor(private readonly bank: QuestionBankService) {}

  @RequirePermission('question.manage') @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.bank.listSets(q); }

  @RequirePermission('question.manage') @Post()
  create(@Body(new ZodPipe(questionSetCreateSchema)) body: QuestionSetCreateInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.createSet(body, actor(u, req));
  }

  /** Pickers in assessment screens: candidates from every published set, including ones not yet student-facing. */
  @RequirePermission('question.manage') @HttpCode(200) @Post('pick')
  pick(@Body(new ZodPipe(bankPickSchema)) body: BankPickInput) { return this.bank.pickForAdmin(body); }

  @RequirePermission('question.manage') @Get(':id')
  get(@Param('id', uuid) id: string) { return this.bank.getSet(id); }

  @RequirePermission('question.manage') @Patch(':id')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(questionSetUpdateSchema)) body: QuestionSetUpdateInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.updateSet(id, body, actor(u, req));
  }

  @RequirePermission('question.manage') @HttpCode(200) @Post(':id/status')
  status(@Param('id', uuid) id: string, @Body(new ZodPipe(questionSetStatusSchema)) body: QuestionSetStatusInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.setStatus(id, body, actor(u, req));
  }

  @RequirePermission('question.manage') @HttpCode(200) @Post(':id/clone')
  clone(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.cloneSet(id, actor(u, req));
  }

  @RequirePermission('question.manage') @Post(':id/questions')
  addQuestion(@Param('id', uuid) id: string, @Body(new ZodPipe(bankQuestionSchema)) body: BankQuestionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.addQuestion(id, body, actor(u, req));
  }

  @RequirePermission('question.manage') @Patch('questions/:questionId')
  updateQuestion(@Param('questionId', uuid) id: string, @Body(new ZodPipe(bankQuestionUpdateSchema)) body: BankQuestionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.updateQuestion(id, body, actor(u, req));
  }

  @RequirePermission('question.manage') @Delete('questions/:questionId')
  removeQuestion(@Param('questionId', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.removeQuestion(id, actor(u, req));
  }
}

@Controller('admin/assessment-sections')
export class AdminBankCopyController {
  constructor(private readonly bank: QuestionBankService) {}

  @RequirePermission('assessment.manage') @HttpCode(200) @Post(':id/bank-questions')
  copy(@Param('id', uuid) id: string, @Body(new ZodPipe(copyToSectionSchema)) body: CopyToSectionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.copyIntoSection(id, body.questionIds, actor(u, req));
  }
}

@Controller('practice')
export class StudentPracticeController {
  constructor(private readonly bank: QuestionBankService) {}

  /** A personal practice paper from student-facing questions. The student then starts it through the normal attempt flow. */
  @Post('sessions')
  create(@Body(new ZodPipe(practiceSessionSchema)) body: PracticeSessionInput, @CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden();
    return this.bank.createPractice(u.studentId, body);
  }
}

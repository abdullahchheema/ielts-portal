import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  BankPickInput, BankQuestionInput, BulkImportInput, CopyToSectionInput, PracticeSessionInput, QuestionSetCreateInput, QuestionSetStatusInput, QuestionSetUpdateInput,
  bankPickSchema, bankQuestionSchema, bankQuestionUpdateSchema, bulkImportSchema, copyToSectionSchema, practiceSessionSchema, questionSetCreateSchema, questionSetStatusSchema, questionSetUpdateSchema,
} from '@ielts/validation';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { forbidden } from '../common/app-error';
import { ZodPipe } from '../common/zod.pipe';
import { QuestionImportService } from './import.service';
import { QuestionBankService } from './question-bank.service';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request) => ({ userId: u.id, ...clientMeta(req) });
const imageUpload = UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }));
const audioUpload = UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } }));
type ImageFile = { buffer: Buffer; size: number } | undefined;

const listQuery = z.object({
  skill: z.enum(['LISTENING', 'READING', 'WRITING', 'SPEAKING']).optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED']).optional(),
  topic: z.string().trim().max(80).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller('admin/question-sets')
export class AdminQuestionSetsController {
  constructor(private readonly bank: QuestionBankService, private readonly importer: QuestionImportService) {}

  @RequirePermission('question.manage') @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.bank.listSets(q); }

  @RequirePermission('question.manage') @Post()
  create(@Body(new ZodPipe(questionSetCreateSchema)) body: QuestionSetCreateInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.createSet(body, actor(u, req));
  }

  /** Pickers in assessment screens: candidates from every published set, including ones not yet student-facing. */
  @RequirePermission('question.manage') @HttpCode(200) @Post('pick')
  pick(@Body(new ZodPipe(bankPickSchema)) body: BankPickInput) { return this.bank.pickForAdmin(body); }

  /** Dry-run: validates every set/question and flags likely duplicates without writing anything. */
  @RequirePermission('question.manage') @HttpCode(200) @Post('import/preview')
  importPreview(@Body(new ZodPipe(bulkImportSchema)) body: BulkImportInput) { return this.importer.preview(body); }

  /** Persists the import as DRAFT sets in one transaction. Refuses if any question is invalid. */
  @RequirePermission('question.manage') @HttpCode(201) @Post('import/commit')
  importCommit(@Body(new ZodPipe(bulkImportSchema)) body: BulkImportInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.importer.commit(body, actor(u, req));
  }

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

  @RequirePermission('question.manage') @HttpCode(201) @Post(':id/images') @imageUpload
  attachSetImage(@Param('id', uuid) id: string, @UploadedFile() file: ImageFile, @Query('alt') alt: string | undefined, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.attachSetImage(id, file, alt, actor(u, req));
  }

  @RequirePermission('question.manage') @HttpCode(200) @Post(':id/audio') @audioUpload
  attachSetAudio(@Param('id', uuid) id: string, @UploadedFile() file: ImageFile, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.attachSetAudio(id, file, actor(u, req));
  }

  @RequirePermission('question.manage') @HttpCode(201) @Post('questions/:questionId/images') @imageUpload
  attachQuestionImage(@Param('questionId', uuid) id: string, @UploadedFile() file: ImageFile, @Query('alt') alt: string | undefined, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.attachQuestionImage(id, file, alt, actor(u, req));
  }

  @RequirePermission('question.manage') @Delete('images/:imageId')
  removeImage(@Param('imageId', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.bank.removeImage(id, actor(u, req));
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

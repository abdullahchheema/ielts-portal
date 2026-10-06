import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  addSpeakingResponseSchema, AddSpeakingResponseInput, completeSpeakingSchema, createSpeakingAttemptSchema, CreateSpeakingAttemptInput, MAX_SPEAKING_BYTES,
  presignSpeakingSchema, PresignSpeakingInput,
} from '@ielts/validation';
import { AppError, forbidden } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { SpeakingService } from './speaking.service';

const uuid = new ParseUUIDPipe();
const sid = (u: AuthUser) => { if (!u.studentId) throw forbidden(); return u.studentId; };

const questionsQuery = z.object({ part: z.enum(['PART1', 'PART2', 'PART3']) });

@Controller('speaking')
export class SpeakingController {
  constructor(private readonly speaking: SpeakingService) {}

  @Get('questions')
  questions(@Query(new ZodPipe(questionsQuery)) q: z.infer<typeof questionsQuery>, @CurrentUser() u: AuthUser) {
    sid(u);
    return this.speaking.questions(q.part);
  }

  @HttpCode(201) @Post('attempts')
  create(@Body(new ZodPipe(createSpeakingAttemptSchema)) body: CreateSpeakingAttemptInput, @CurrentUser() u: AuthUser) {
    return this.speaking.createAttempt(sid(u), body);
  }

  @Get('attempts/:id')
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.speaking.getAttempt(sid(u), id); }

  @HttpCode(201) @Post('attempts/:id/responses')
  addResponse(@Param('id', uuid) id: string, @Body(new ZodPipe(addSpeakingResponseSchema)) body: AddSpeakingResponseInput, @CurrentUser() u: AuthUser) {
    return this.speaking.addResponse(sid(u), id, body);
  }

  @HttpCode(200) @Post('responses/:id/presign')
  presign(@Param('id', uuid) id: string, @Body(new ZodPipe(presignSpeakingSchema)) body: PresignSpeakingInput, @CurrentUser() u: AuthUser) {
    return this.speaking.presign(sid(u), id, body);
  }

  /** Only used when S3 is not configured (local fallback). Content is sniffed on the server. */
  @HttpCode(200) @Post('responses/:id/audio')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_SPEAKING_BYTES, files: 1 } }))
  upload(@Param('id', uuid) id: string, @UploadedFile() file: { buffer: Buffer; size: number } | undefined, @CurrentUser() u: AuthUser) {
    if (!file) throw new AppError('UPLOAD_FAILED', 400, 'Choose a recording to upload.');
    return this.speaking.uploadLocal(sid(u), id, file);
  }

  @HttpCode(200) @Post('responses/:id/complete')
  complete(@Param('id', uuid) id: string, @Body(new ZodPipe(completeSpeakingSchema)) body: { durationSec?: number }, @CurrentUser() u: AuthUser) {
    return this.speaking.complete(sid(u), id, body.durationSec);
  }

  @HttpCode(200) @Post('responses/:id/retry')
  retry(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.speaking.retry(sid(u), id); }

  @Get('responses/:id')
  response(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.speaking.getResponse(sid(u), id); }
}

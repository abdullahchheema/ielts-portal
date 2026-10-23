import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { z } from 'zod';
import {
  AddSpeakingResponseInput, MAX_SPEAKING_BYTES, SaveAnswersInput, SaveWritingInput,
  addSpeakingResponseSchema, saveAnswersSchema, saveWritingSchema, simulatorAdvanceSchema,
} from '@ielts/validation';
import { AppError } from '../common/app-error';
import { Public, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FreeTestService } from './free-test.service';

const uuid = new ParseUUIDPipe();
const speakingQuery = z.object({ part: z.enum(['PART1', 'PART2', 'PART3']) });

/** The anonymous free-test flow: no login required at any step. A full 4-skill mock, orchestrated
 *  the same way the authenticated simulator is — see FreeTestService for how. */
@Controller('free-test')
export class FreeTestController {
  constructor(private readonly freeTest: FreeTestService) {}

  /** Fully anonymous: no email, phone, or body at all. Every call mints a fresh claim — there is no
   *  identity to dedupe against, so "one free test per person" is no longer enforced. */
  @Public() @Post('claim')
  claim(@Req() req: Request) {
    return this.freeTest.claim(clientMeta(req));
  }

  @Public() @Get(':leadId')
  get(@Param('leadId', uuid) leadId: string) { return this.freeTest.get(leadId); }

  @Public() @Get(':leadId/section')
  getSection(@Param('leadId', uuid) leadId: string) { return this.freeTest.getSection(leadId); }

  @Public() @Put(':leadId/answers')
  saveAnswers(@Param('leadId', uuid) leadId: string, @Body(new ZodPipe(saveAnswersSchema)) body: SaveAnswersInput) {
    return this.freeTest.saveAnswers(leadId, body);
  }

  @Public() @HttpCode(200) @Post(':leadId/section/submit')
  submitSection(@Param('leadId', uuid) leadId: string) { return this.freeTest.submitSection(leadId); }

  @Public() @HttpCode(200) @Put(':leadId/section/audio-played')
  markAudioPlayed(@Param('leadId', uuid) leadId: string) { return this.freeTest.markAudioPlayed(leadId); }

  @Public() @HttpCode(200) @Post(':leadId/advance')
  advance(@Param('leadId', uuid) leadId: string, @Body(new ZodPipe(simulatorAdvanceSchema)) body: { expectedRevision: number }) {
    return this.freeTest.advance(leadId, body.expectedRevision);
  }

  @Public() @Get(':leadId/writing')
  getWriting(@Param('leadId', uuid) leadId: string) { return this.freeTest.getWriting(leadId); }

  @Public() @Put(':leadId/writing')
  saveWriting(@Param('leadId', uuid) leadId: string, @Body(new ZodPipe(saveWritingSchema)) body: SaveWritingInput) {
    return this.freeTest.saveWriting(leadId, body);
  }

  @Public() @HttpCode(200) @Post(':leadId/writing/submit')
  submitWriting(@Param('leadId', uuid) leadId: string) { return this.freeTest.submitWriting(leadId); }

  @Public() @Get('speaking-questions')
  speakingQuestions(@Query(new ZodPipe(speakingQuery)) q: { part: 'PART1' | 'PART2' | 'PART3' }) {
    return this.freeTest.listSpeakingQuestions(q.part);
  }

  @Public() @HttpCode(201) @Post(':leadId/speaking-responses')
  addSpeakingResponse(@Param('leadId', uuid) leadId: string, @Body(new ZodPipe(addSpeakingResponseSchema)) body: AddSpeakingResponseInput) {
    return this.freeTest.addSpeakingResponse(leadId, body);
  }

  // Audio goes straight in as multipart, which finalizes the response itself (status -> UPLOADED) —
  // there is no separate "complete" step here, unlike the authenticated presign+direct-PUT path.
  @Public() @HttpCode(200) @Post(':leadId/speaking-responses/:responseId/audio')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_SPEAKING_BYTES, files: 1 } }))
  uploadSpeakingAudio(
    @Param('leadId', uuid) leadId: string, @Param('responseId', uuid) responseId: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file) throw new AppError('UPLOAD_FAILED', 400, 'Choose a recording to upload.');
    return this.freeTest.uploadSpeakingAudio(leadId, responseId, file);
  }
}

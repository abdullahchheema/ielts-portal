import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ClaimFreeTestInput, SaveAnswersInput, claimFreeTestSchema, saveAnswersSchema } from '@ielts/validation';
import { Public, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FreeTestService } from './free-test.service';

const uuid = new ParseUUIDPipe();

/** The anonymous free-test flow: no login required at any step. */
@Controller('free-test')
export class FreeTestController {
  constructor(private readonly freeTest: FreeTestService) {}

  @Public() @Post('claim')
  claim(@Body(new ZodPipe(claimFreeTestSchema)) body: ClaimFreeTestInput, @Req() req: Request) {
    return this.freeTest.claim(body.email, body.phone, clientMeta(req));
  }

  @Public() @Post(':leadId/start')
  start(@Param('leadId', uuid) leadId: string) { return this.freeTest.start(leadId); }

  @Public() @Put(':leadId/answers')
  saveAnswers(@Param('leadId', uuid) leadId: string, @Body(new ZodPipe(saveAnswersSchema)) body: SaveAnswersInput) {
    return this.freeTest.saveAnswers(leadId, body);
  }

  @Public() @HttpCode(200) @Post(':leadId/submit')
  submit(@Param('leadId', uuid) leadId: string) { return this.freeTest.submit(leadId); }

  @Public() @Get(':leadId/result')
  result(@Param('leadId', uuid) leadId: string) { return this.freeTest.result(leadId); }
}

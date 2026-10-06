import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { createWritingSchema, CreateWritingInput, saveWritingSchema, SaveWritingInput } from '@ielts/validation';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { WritingService } from './writing.service';

const uuid = new ParseUUIDPipe();

const compareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

/** Student writing practice. Every route is scoped to the signed-in student's own essays. */
@Controller('writing/responses')
export class WritingController {
  constructor(private readonly writing: WritingService) {}

  private student(u: AuthUser): string {
    if (!u.studentId) throw forbidden();
    return u.studentId;
  }

  @Get()
  list(@CurrentUser() u: AuthUser) { return this.writing.list(this.student(u)); }

  @Post()
  create(@Body(new ZodPipe(createWritingSchema)) body: CreateWritingInput, @CurrentUser() u: AuthUser) {
    return this.writing.create(this.student(u), body);
  }

  @Get(':id')
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.writing.get(this.student(u), id); }

  @Put(':id')
  save(@Param('id', uuid) id: string, @Body(new ZodPipe(saveWritingSchema)) body: SaveWritingInput, @CurrentUser() u: AuthUser) {
    return this.writing.save(this.student(u), id, body);
  }

  @HttpCode(200) @Post(':id/submit')
  submit(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() _req: Request) {
    return this.writing.submit(this.student(u), id);
  }
}

/** Progress over time and side-by-side comparison. Reads stored evaluations only. */
@Controller('writing')
export class WritingHistoryController {
  constructor(private readonly writing: WritingService) {}

  private student(u: AuthUser): string {
    if (!u.studentId) throw forbidden();
    return u.studentId;
  }

  @Get('history')
  history(@CurrentUser() u: AuthUser) { return this.writing.history(this.student(u)); }

  @Get('compare')
  compare(@Query(new ZodPipe(compareQuery)) q: { a: string; b: string }, @CurrentUser() u: AuthUser) {
    return this.writing.compare(this.student(u), q.a, q.b);
  }
}

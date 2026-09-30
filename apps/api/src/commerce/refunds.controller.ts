import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  RefundCreateInput, RefundProcessInput, RefundRejectInput, RefundRequestInput,
  refundCreateSchema, refundProcessSchema, refundRejectSchema, refundRequestSchema,
} from '@ielts/validation';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { RefundsService } from './refunds.service';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });
const listQuery = z.object({ status: z.enum(['REQUESTED', 'APPROVED', 'PROCESSED', 'REJECTED']).optional() });

@Controller()
export class StudentRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post('orders/:id/refund-request')
  request(@Param('id', uuid) id: string, @Body(new ZodPipe(refundRequestSchema)) body: RefundRequestInput, @CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts can do this.');
    return this.refunds.request({ studentId: u.studentId, userId: u.id }, id, body.reason);
  }
}

@Controller('admin')
export class AdminRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @RequirePermission('payment.refund') @Get('refunds')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.refunds.list(q.status); }

  @RequirePermission('payment.refund') @Post('payments/:id/refunds')
  create(@Param('id', uuid) id: string, @Body(new ZodPipe(refundCreateSchema)) body: RefundCreateInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.refunds.create(id, body, actor(u, req));
  }

  @RequirePermission('payment.refund') @HttpCode(200) @Post('refunds/:id/process')
  process(@Param('id', uuid) id: string, @Body(new ZodPipe(refundProcessSchema)) body: RefundProcessInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.refunds.process(id, body, actor(u, req));
  }

  @RequirePermission('payment.refund') @HttpCode(200) @Post('refunds/:id/reject')
  reject(@Param('id', uuid) id: string, @Body(new ZodPipe(refundRejectSchema)) body: RefundRejectInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.refunds.reject(id, body, actor(u, req));
  }
}

import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  ApproveProofInput, ManualEnrollmentInput, RejectProofInput,
  approveProofSchema, manualEnrollmentSchema, rejectProofSchema,
} from '@ielts/validation';
import { setSessionCookies } from '../auth/cookies';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser, Public, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { ApplicationsService, MAX_PROOF_BYTES } from './applications.service';
import { EnrollmentsService } from './enrollments.service';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config.module';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });
type Upload = { buffer: Buffer; size: number } | undefined;
const proofUpload = () => FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_PROOF_BYTES, files: 1 } });

/** What visitors see on the homepage and enrollment form. */
@Controller('public')
export class PublicController {
  constructor(private readonly applications: ApplicationsService) {}

  @Public() @Get('course')
  course() { return this.applications.publicCourse(); }

  @Public() @Get('batches')
  batches() { return this.applications.publicBatches(); }

  @Public() @Get('payment-methods')
  methods() { return this.applications.paymentMethods(); }
}

@Controller()
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Public: new visitors create their account and apply in one request; signed-in students just apply.
   * A brand-new student is signed in on the response so they land straight in their portal.
   */
  @Public() @HttpCode(201) @Post('applications')
  @UseInterceptors(proofUpload())
  async apply(
    @Body() body: Record<string, unknown>, @UploadedFile() file: Upload,
    @CurrentUser() user: AuthUser | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response,
  ) {
    const current = user?.studentId ? { userId: user.id, studentId: user.studentId } : null;
    const result = await this.applications.submit(current, body, file, clientMeta(req));
    if (result.session) setSessionCookies(res, result.session, this.config.NODE_ENV === 'production');
    return { enrollmentId: result.enrollmentId, status: result.status, signedIn: !!result.session };
  }

  @Get('me/applications')
  mine(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts can do this.');
    return this.applications.mine(u.studentId);
  }

  @HttpCode(201) @Post('applications/:id/payment-proof')
  @UseInterceptors(proofUpload())
  resubmit(@Param('id', uuid) id: string, @Body() body: Record<string, unknown>, @UploadedFile() file: Upload, @CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts can do this.');
    return this.applications.resubmit(u.studentId, u.id, id, body, file);
  }
}

const listQuery = z.object({
  status: z.enum(['PENDING', 'ENROLLED', 'REJECTED', 'ALL']).default('PENDING'),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(25),
});
const ordersQuery = z.object({ status: z.string().optional() });

@Controller('admin')
export class AdminCommerceController {
  constructor(private readonly applications: ApplicationsService, private readonly enrollments: EnrollmentsService) {}

  @RequirePermission('payment.verify') @Get('applications')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.applications.adminList(q); }

  @RequirePermission('payment.verify') @HttpCode(200) @Post('applications/proofs/:id/verify')
  verify(@Param('id', uuid) id: string, @Body(new ZodPipe(approveProofSchema)) body: ApproveProofInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.applications.verify(id, body, actor(u, req));
  }

  @RequirePermission('payment.verify') @HttpCode(200) @Post('applications/proofs/:id/reject')
  reject(@Param('id', uuid) id: string, @Body(new ZodPipe(rejectProofSchema)) body: RejectProofInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.applications.reject(id, body, actor(u, req));
  }

  @RequirePermission('payment.view') @Get('payments/:id')
  payment(@Param('id', uuid) id: string) { return this.applications.paymentDetail(id); }

  @RequirePermission('payment.view') @Get('orders')
  orders(@Query(new ZodPipe(ordersQuery)) q: z.infer<typeof ordersQuery>) { return this.enrollments.listOrders(q.status); }

  @RequirePermission('enrollment.view') @Get('enrollments')
  list2(@Query('status') status?: string) { return this.enrollments.list(status as never); }

  @RequirePermission('enrollment.create') @Post('enrollments')
  manual(@Body(new ZodPipe(manualEnrollmentSchema)) body: ManualEnrollmentInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.enrollments.manualEnroll(body, actor(u, req));
  }
}

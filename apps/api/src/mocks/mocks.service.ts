import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  MockAccessDecisionInput, MockAccessRequestInput, MockActivationInput,
  mockAccessDecisionSchema, mockAccessRequestSchema, mockActivationSchema,
} from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

export interface Reviewer { userId: string; mentorId?: string; canOverseeAll: boolean }
const sid = (u: AuthUser) => {
  if (!u.studentId) throw forbidden('Only student accounts can do this.');
  return u.studentId;
};

/**
 * Individual mock-test access requests and batch-wide activations (spec §22). Ordinary practice
 * stays open; only assessments of type MOCK are gated here, and the real enforcement lives in
 * AttemptsService.start() — hiding the button is not the security boundary.
 */
@Injectable()
export class MocksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotificationsService) {}

  private async assertBatch(r: Reviewer, batchId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) throw notFound('Batch');
    if (r.canOverseeAll) return batch;
    const ok = r.mentorId ? await this.prisma.batchMentor.count({ where: { batchId, mentorId: r.mentorId } }) : 0;
    if (!ok) throw forbidden('You are not assigned to this batch.');
    return batch;
  }

  private async assertMockAssessment(assessmentId: string) {
    const a = await this.prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!a) throw notFound('Assessment');
    if (a.type !== 'MOCK') throw new AppError('VALIDATION_ERROR', 422, 'Only mock tests use the access-request workflow.', { assessmentId: 'not a mock test' });
    return a;
  }

  // ───────── student ─────────
  async request(studentId: string, assessmentId: string, input: MockAccessRequestInput) {
    const assessment = await this.assertMockAssessment(assessmentId);
    const pending = await this.prisma.mockAccessRequest.findFirst({ where: { studentId, assessmentId, status: 'PENDING' } });
    if (pending) throw new AppError('MOCK_REQUEST_ALREADY_PENDING', 409, 'You already have a pending request for this mock test.');
    const batchId = (await this.prisma.enrollment.findFirst({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { batchId: true } }))?.batchId;
    const row = await this.prisma.mockAccessRequest.create({ data: { studentId, assessmentId, batchId, reason: input.reason } });
    await this.notify.notifyPermission('mock.review', 'MOCK_ACCESS_REQUESTED', 'Mock test access requested', `A student requested access to ${assessment.title}.`, {
      entityType: 'MockAccessRequest', entityId: row.id, link: '/teacher/mock-requests',
    });
    return row;
  }

  async listMine(studentId: string) {
    return this.prisma.mockAccessRequest.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, include: { assessment: { select: { title: true } } } });
  }

  // ───────── teacher / admin review ─────────
  async listForReview(r: Reviewer, status?: string) {
    const batchIds = r.canOverseeAll ? undefined : (await this.prisma.batchMentor.findMany({ where: { mentorId: r.mentorId }, select: { batchId: true } })).map((b) => b.batchId);
    return this.prisma.mockAccessRequest.findMany({
      where: { ...(status ? { status } : {}), ...(batchIds ? { batchId: { in: batchIds } } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { assessment: { select: { title: true, timeLimitMin: true } }, student: { select: { firstName: true, lastName: true } } },
    });
  }

  private async assertRequestAccess(r: Reviewer, id: string) {
    const req = await this.prisma.mockAccessRequest.findUnique({ where: { id } });
    if (!req) throw notFound('Mock access request');
    if (req.batchId && !r.canOverseeAll) await this.assertBatch(r, req.batchId);
    else if (!req.batchId && !r.canOverseeAll) throw forbidden('You are not authorised to review this request.');
    return req;
  }

  async decide(r: Reviewer, id: string, decision: 'APPROVED' | 'DECLINED', input: MockAccessDecisionInput, actor: Actor) {
    const req = await this.assertRequestAccess(r, id);
    if (req.status !== 'PENDING') throw new AppError('CONFLICT', 409, 'This request has already been decided.');
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.mockAccessRequest.update({
        where: { id }, data: {
          status: decision, reviewedBy: actor.userId, reviewedAt: new Date(), decisionNote: input.decisionNote,
          availableFrom: decision === 'APPROVED' ? new Date(input.availableFrom ?? new Date().toISOString()) : null,
          availableUntil: decision === 'APPROVED' && input.availableUntil ? new Date(input.availableUntil) : null,
        },
      });
      await this.audit.record({ ...actor, action: decision === 'APPROVED' ? 'MOCK_REQUEST_APPROVED' : 'MOCK_REQUEST_DECLINED', entityType: 'MockAccessRequest', entityId: id, before: req, after: updated }, tx);
      return updated;
    });
    const student = await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: req.studentId }, select: { userId: true } });
    const assessment = await this.prisma.assessment.findUniqueOrThrow({ where: { id: req.assessmentId }, select: { title: true } });
    await this.notify.notifyUser(student.userId, decision === 'APPROVED' ? 'MOCK_REQUEST_APPROVED' : 'MOCK_REQUEST_DECLINED',
      decision === 'APPROVED' ? 'Mock test access approved' : 'Mock test access declined',
      decision === 'APPROVED' ? `Your request for ${assessment.title} was approved.` : `Your request for ${assessment.title} was declined.${input.decisionNote ? ` ${input.decisionNote}` : ''}`,
      { entityType: 'MockAccessRequest', entityId: id, link: '/student/mock-tests' });
    return after;
  }

  // ───────── batch activation ─────────
  async activate(r: Reviewer, assessmentId: string, input: MockActivationInput, actor: Actor) {
    await this.assertBatch(r, input.batchId);
    const assessment = await this.assertMockAssessment(assessmentId);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mockActivation.upsert({
        where: { batchId_assessmentId: { batchId: input.batchId, assessmentId } },
        create: { batchId: input.batchId, assessmentId, availableFrom: new Date(input.availableFrom), availableUntil: input.availableUntil ? new Date(input.availableUntil) : null, instructions: input.instructions, activatedBy: actor.userId, status: 'ACTIVE' },
        update: { availableFrom: new Date(input.availableFrom), availableUntil: input.availableUntil ? new Date(input.availableUntil) : null, instructions: input.instructions, status: 'ACTIVE' },
      });
      await this.audit.record({ ...actor, action: 'MOCK_ACTIVATED', entityType: 'MockActivation', entityId: created.id, after: { batchId: input.batchId, assessmentId } }, tx);
      return created;
    });
    const students = await this.prisma.enrollment.findMany({ where: { batchId: input.batchId, status: 'ACTIVE', deletedAt: null }, select: { student: { select: { userId: true } } } });
    for (const e of students) {
      await this.notify.notifyUser(e.student.userId, 'MOCK_ACTIVATED', 'Mock test available', `${assessment.title} is now available for your batch.`, { entityType: 'MockActivation', entityId: row.id, link: '/student/mock-tests' });
    }
    return row;
  }

  async listActivations(r: Reviewer, batchId: string) {
    await this.assertBatch(r, batchId);
    return this.prisma.mockActivation.findMany({ where: { batchId }, orderBy: { createdAt: 'desc' }, include: { assessment: { select: { title: true } } } });
  }

  async cancelActivation(r: Reviewer, id: string, actor: Actor) {
    const row = await this.prisma.mockActivation.findUnique({ where: { id } });
    if (!row) throw notFound('Mock activation');
    await this.assertBatch(r, row.batchId);
    await this.prisma.$transaction(async (tx) => {
      await tx.mockActivation.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record({ ...actor, action: 'MOCK_ACTIVATION_CANCELLED', entityType: 'MockActivation', entityId: id }, tx);
    });
  }

  /**
   * The real gate, called from AttemptsService.start() for assessment.type === 'MOCK'.
   * An approved individual request or an active batch activation, both inside their
   * availability window, are the only ways in — hiding the button is not enough.
   */
  async assertAttemptAllowed(studentId: string, assessmentId: string) {
    const now = new Date();
    const withinWindow = (from: Date | null, until: Date | null) => (!from || now >= from) && (!until || now <= until);

    const approved = await this.prisma.mockAccessRequest.findFirst({ where: { studentId, assessmentId, status: 'APPROVED' }, orderBy: { reviewedAt: 'desc' } });
    if (approved && withinWindow(approved.availableFrom, approved.availableUntil)) return;

    const batchIds = (await this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { batchId: true } })).map((e) => e.batchId);
    if (batchIds.length) {
      const activation = await this.prisma.mockActivation.findFirst({ where: { batchId: { in: batchIds }, assessmentId, status: 'ACTIVE' } });
      if (activation && withinWindow(activation.availableFrom, activation.availableUntil)) return;
    }

    if (approved) throw new AppError('MOCK_NOT_AVAILABLE', 403, 'Your approved window for this mock test has not started yet or has ended.');
    throw new AppError('MOCK_ACCESS_REQUIRED', 403, 'Request access to this mock test first.');
  }

  /** Read-only status for the student's mock-tests list — same rule as assertAttemptAllowed, without throwing. */
  async statusFor(studentId: string, assessmentId: string) {
    const now = new Date();
    const withinWindow = (from: Date | null, until: Date | null) => (!from || now >= from) && (!until || now <= until);

    const [request, batchIds] = await Promise.all([
      this.prisma.mockAccessRequest.findFirst({ where: { studentId, assessmentId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { batchId: true } }).then((rows) => rows.map((e) => e.batchId)),
    ]);
    const activation = batchIds.length ? await this.prisma.mockActivation.findFirst({ where: { batchId: { in: batchIds }, assessmentId, status: 'ACTIVE' } }) : null;

    if (activation && withinWindow(activation.availableFrom, activation.availableUntil)) {
      return { canAttempt: true, status: 'ACTIVATED' as const, availableFrom: activation.availableFrom, availableUntil: activation.availableUntil, instructions: activation.instructions, requestId: null, decisionNote: null };
    }
    if (request?.status === 'APPROVED' && withinWindow(request.availableFrom, request.availableUntil)) {
      return { canAttempt: true, status: 'APPROVED' as const, availableFrom: request.availableFrom, availableUntil: request.availableUntil, instructions: null, requestId: request.id, decisionNote: request.decisionNote };
    }
    if (request?.status === 'APPROVED') {
      return { canAttempt: false, status: 'EXPIRED' as const, availableFrom: request.availableFrom, availableUntil: request.availableUntil, instructions: null, requestId: request.id, decisionNote: request.decisionNote };
    }
    if (request?.status === 'PENDING') {
      return { canAttempt: false, status: 'PENDING' as const, availableFrom: null, availableUntil: null, instructions: null, requestId: request.id, decisionNote: null };
    }
    if (request?.status === 'DECLINED') {
      return { canAttempt: false, status: 'DECLINED' as const, availableFrom: null, availableUntil: null, instructions: null, requestId: request.id, decisionNote: request.decisionNote };
    }
    return { canAttempt: false, status: 'NONE' as const, availableFrom: null, availableUntil: null, instructions: null, requestId: null, decisionNote: null };
  }
}

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller()
export class MocksController {
  constructor(private readonly mocks: MocksService, private readonly ctx: UserContextService) {}

  private async rev(u: AuthUser): Promise<Reviewer> {
    const c = (await this.ctx.get(u.id))!;
    return { userId: u.id, mentorId: u.mentorId, canOverseeAll: c.permissions.has('batch.create') };
  }

  @HttpCode(201) @Post('assessments/:id/mock-access-requests')
  request(@Param('id', uuid) assessmentId: string, @Body(new ZodPipe(mockAccessRequestSchema)) body: MockAccessRequestInput, @CurrentUser() u: AuthUser) {
    return this.mocks.request(sid(u), assessmentId, body);
  }

  @Get('me/mock-access-requests')
  listMine(@CurrentUser() u: AuthUser) { return this.mocks.listMine(sid(u)); }

  @RequirePermission('mock.review') @Get('mentor/mock-access-requests')
  async listForReview(@Query(new ZodPipe(z.object({ status: z.enum(['PENDING', 'APPROVED', 'DECLINED', 'EXPIRED']).optional() }))) q: { status?: string }, @CurrentUser() u: AuthUser) {
    return this.mocks.listForReview(await this.rev(u), q.status);
  }

  @RequirePermission('mock.review') @HttpCode(200) @Post('mentor/mock-access-requests/:id/approve')
  async approve(@Param('id', uuid) id: string, @Body(new ZodPipe(mockAccessDecisionSchema)) body: MockAccessDecisionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.mocks.decide(await this.rev(u), id, 'APPROVED', body, actor(u, req));
  }

  @RequirePermission('mock.review') @HttpCode(200) @Post('mentor/mock-access-requests/:id/decline')
  async decline(@Param('id', uuid) id: string, @Body(new ZodPipe(mockAccessDecisionSchema)) body: MockAccessDecisionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.mocks.decide(await this.rev(u), id, 'DECLINED', body, actor(u, req));
  }

  @RequirePermission('mock.review') @HttpCode(201) @Post('mentor/assessments/:id/mock-activations')
  async activate(@Param('id', uuid) assessmentId: string, @Body(new ZodPipe(mockActivationSchema)) body: MockActivationInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.mocks.activate(await this.rev(u), assessmentId, body, actor(u, req));
  }

  @RequirePermission('mock.review') @Get('mentor/batches/:id/mock-activations')
  async listActivations(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.mocks.listActivations(await this.rev(u), id); }

  @RequirePermission('mock.review') @HttpCode(204) @Delete('mentor/mock-activations/:id')
  async cancel(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { await this.mocks.cancelActivation(await this.rev(u), id, actor(u, req)); }
}

@Module({ controllers: [MocksController], providers: [MocksService], exports: [MocksService] })
export class MocksModule {}

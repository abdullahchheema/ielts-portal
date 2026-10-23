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
import { ScopeService } from '../common/scope.service';
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
 * Mock-test access control: a student requests access to one mock, or a teacher/admin opens a
 * mock for an entire batch at once. `assessments.library_visible` alone never granted real
 * per-student access — the actual gate lives in AttemptsService.resolveAccess(), which calls
 * assertAttemptAllowed() below. Composing/publishing mocks (mock-exams/) is untouched.
 *
 * Phase 6 added a second, parallel shape: a MockExam bundles Listening+Reading as one unit, so a
 * request/activation for one now keys on *either* assessmentId (the original single-skill shape,
 * still read for pre-Phase-6 rows) *or* mockExamId (every new, bundle-based request/activation) —
 * exactly one of the two is ever set on a given row. `request`/`activate`/`assertAttemptAllowed`/
 * `statusFor` are the original assessment-keyed methods, untouched; `requestMockExam`/
 * `activateMockExam`/`assertMockExamAttemptAllowed`/`statusForMockExam` are their mockExamId twins.
 * `decide`/`listForReview`/`listActivations`/`cancelActivation` operate on the request/activation
 * row itself, so they're naturally shared by both shapes already — they just needed their title
 * lookups to branch on which key the row actually has.
 */
@Injectable()
export class MocksService {
  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly notify: NotificationsService, private readonly scope: ScopeService,
  ) {}

  private async assertMockAssessment(assessmentId: string) {
    const a = await this.prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!a || a.type !== 'MOCK' || !a.libraryVisible) throw new AppError('ASSESSMENT_NOT_AVAILABLE', 404, 'This mock test is not available.');
    return a;
  }

  private async assertMockExam(mockExamId: string) {
    const m = await this.prisma.mockExam.findUnique({ where: { id: mockExamId } });
    if (!m || !m.libraryVisible) throw new AppError('ASSESSMENT_NOT_AVAILABLE', 404, 'This mock test is not available.');
    return m;
  }

  /** The title to show in a notification/UI row for either shape of request/activation. */
  private async titleFor(row: { assessmentId: string | null; mockExamId: string | null }) {
    if (row.assessmentId) return (await this.prisma.assessment.findUniqueOrThrow({ where: { id: row.assessmentId }, select: { title: true } })).title;
    return (await this.prisma.mockExam.findUniqueOrThrow({ where: { id: row.mockExamId! }, select: { title: true } })).title;
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

  /** requestMockExam()'s twin for the new whole-module bundle shape (Phase 6). */
  async requestMockExam(studentId: string, mockExamId: string, input: MockAccessRequestInput) {
    const mockExam = await this.assertMockExam(mockExamId);
    const pending = await this.prisma.mockAccessRequest.findFirst({ where: { studentId, mockExamId, status: 'PENDING' } });
    if (pending) throw new AppError('MOCK_REQUEST_ALREADY_PENDING', 409, 'You already have a pending request for this mock test.');
    const batchId = (await this.prisma.enrollment.findFirst({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { batchId: true } }))?.batchId;
    const row = await this.prisma.mockAccessRequest.create({ data: { studentId, mockExamId, batchId, reason: input.reason } });
    await this.notify.notifyPermission('mock.review', 'MOCK_ACCESS_REQUESTED', 'Mock test access requested', `A student requested access to ${mockExam.title}.`, {
      entityType: 'MockAccessRequest', entityId: row.id, link: '/teacher/mock-requests',
    });
    return row;
  }

  async listMine(studentId: string) {
    return this.prisma.mockAccessRequest.findMany({
      where: { studentId }, orderBy: { createdAt: 'desc' },
      include: { assessment: { select: { title: true } }, mockExam: { select: { title: true } } },
    });
  }

  // ───────── teacher / admin review ─────────
  async listForReview(r: Reviewer, status?: string) {
    const batchIds = await this.scope.visibleBatchIds(r);
    return this.prisma.mockAccessRequest.findMany({
      where: { ...(status ? { status } : {}), ...(batchIds ? { batchId: { in: batchIds } } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        assessment: { select: { title: true, timeLimitMin: true } }, mockExam: { select: { title: true } },
        student: { select: { firstName: true, lastName: true } },
      },
    });
  }

  private async assertRequestAccess(r: Reviewer, id: string) {
    const req = await this.prisma.mockAccessRequest.findUnique({ where: { id } });
    if (!req) throw notFound('Mock access request');
    if (req.batchId && !r.canOverseeAll) await this.scope.assertBatch(r, req.batchId);
    else if (!req.batchId && !r.canOverseeAll) throw forbidden('You are not authorised to review this request.');
    return req;
  }

  async decide(r: Reviewer, id: string, decision: 'APPROVED' | 'DECLINED', input: MockAccessDecisionInput, actor: Actor) {
    const req = await this.assertRequestAccess(r, id);
    if (req.status !== 'PENDING') throw new AppError('CONFLICT', 409, 'This request has already been decided.');
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.mockAccessRequest.update({
        where: { id }, data: {
          status: decision, reviewedById: actor.userId, reviewedAt: new Date(), decisionNote: input.decisionNote,
          availableFrom: decision === 'APPROVED' ? new Date(input.availableFrom ?? new Date().toISOString()) : null,
          availableUntil: decision === 'APPROVED' && input.availableUntil ? new Date(input.availableUntil) : null,
        },
      });
      await this.audit.record({ userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent, action: decision === 'APPROVED' ? 'MOCK_REQUEST_APPROVED' : 'MOCK_REQUEST_DECLINED', entityType: 'MockAccessRequest', entityId: id, before: req, after: updated }, tx);
      return updated;
    });
    const student = await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: req.studentId }, select: { userId: true } });
    const title = await this.titleFor(req);
    await this.notify.notifyUser(student.userId, decision === 'APPROVED' ? 'MOCK_REQUEST_APPROVED' : 'MOCK_REQUEST_DECLINED',
      decision === 'APPROVED' ? 'Mock test access approved' : 'Mock test access declined',
      decision === 'APPROVED' ? `Your request for ${title} was approved.` : `Your request for ${title} was declined.${input.decisionNote ? ` ${input.decisionNote}` : ''}`,
      { entityType: 'MockAccessRequest', entityId: id, link: '/student/simulator' });
    return after;
  }

  // ───────── batch activation ─────────
  async activate(r: Reviewer, assessmentId: string, input: MockActivationInput, actor: Actor) {
    await this.scope.assertBatch(r, input.batchId);
    const assessment = await this.assertMockAssessment(assessmentId);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mockActivation.upsert({
        where: { batchId_assessmentId: { batchId: input.batchId, assessmentId } },
        create: { batchId: input.batchId, assessmentId, availableFrom: new Date(input.availableFrom), availableUntil: input.availableUntil ? new Date(input.availableUntil) : null, instructions: input.instructions, activatedById: actor.userId, status: 'ACTIVE' },
        update: { availableFrom: new Date(input.availableFrom), availableUntil: input.availableUntil ? new Date(input.availableUntil) : null, instructions: input.instructions, status: 'ACTIVE' },
      });
      await this.audit.record({ userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent, action: 'MOCK_ACTIVATED', entityType: 'MockActivation', entityId: created.id, after: { batchId: input.batchId, assessmentId } }, tx);
      return created;
    });
    const students = await this.prisma.enrollment.findMany({ where: { batchId: input.batchId, status: 'ACTIVE', deletedAt: null }, select: { student: { select: { userId: true } } } });
    for (const e of students) {
      await this.notify.notifyUser(e.student.userId, 'MOCK_ACTIVATED', 'Mock test available', `${assessment.title} is now available for your batch.`, { entityType: 'MockActivation', entityId: row.id, link: '/student/simulator' });
    }
    return row;
  }

  /** activate()'s twin for the new whole-module bundle shape (Phase 6). */
  async activateMockExam(r: Reviewer, mockExamId: string, input: MockActivationInput, actor: Actor) {
    await this.scope.assertBatch(r, input.batchId);
    const mockExam = await this.assertMockExam(mockExamId);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mockActivation.upsert({
        where: { batchId_mockExamId: { batchId: input.batchId, mockExamId } },
        create: { batchId: input.batchId, mockExamId, availableFrom: new Date(input.availableFrom), availableUntil: input.availableUntil ? new Date(input.availableUntil) : null, instructions: input.instructions, activatedById: actor.userId, status: 'ACTIVE' },
        update: { availableFrom: new Date(input.availableFrom), availableUntil: input.availableUntil ? new Date(input.availableUntil) : null, instructions: input.instructions, status: 'ACTIVE' },
      });
      await this.audit.record({ userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent, action: 'MOCK_ACTIVATED', entityType: 'MockActivation', entityId: created.id, after: { batchId: input.batchId, mockExamId } }, tx);
      return created;
    });
    const students = await this.prisma.enrollment.findMany({ where: { batchId: input.batchId, status: 'ACTIVE', deletedAt: null }, select: { student: { select: { userId: true } } } });
    for (const e of students) {
      await this.notify.notifyUser(e.student.userId, 'MOCK_ACTIVATED', 'Mock test available', `${mockExam.title} is now available for your batch.`, { entityType: 'MockActivation', entityId: row.id, link: '/student/simulator' });
    }
    return row;
  }

  async listActivations(r: Reviewer, batchId: string) {
    await this.scope.assertBatch(r, batchId);
    return this.prisma.mockActivation.findMany({
      where: { batchId }, orderBy: { createdAt: 'desc' },
      include: { assessment: { select: { title: true } }, mockExam: { select: { title: true } } },
    });
  }

  async cancelActivation(r: Reviewer, id: string, actor: Actor) {
    const row = await this.prisma.mockActivation.findUnique({ where: { id } });
    if (!row) throw notFound('Mock activation');
    await this.scope.assertBatch(r, row.batchId);
    await this.prisma.$transaction(async (tx) => {
      await tx.mockActivation.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record({ userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent, action: 'MOCK_ACTIVATION_CANCELLED', entityType: 'MockActivation', entityId: id }, tx);
    });
  }

  /**
   * The real gate, called from AttemptsService.resolveAccess() for assessment.libraryVisible
   * (i.e. every MOCK-type assessment). An approved individual request or an active batch
   * activation, both inside their availability window, are the only ways in.
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

  /** assertAttemptAllowed()'s twin for the new whole-module bundle shape (Phase 6) — called once
   *  for the whole MockExam instead of twice (once per underlying Listening/Reading assessment). */
  async assertMockExamAttemptAllowed(studentId: string, mockExamId: string) {
    const now = new Date();
    const withinWindow = (from: Date | null, until: Date | null) => (!from || now >= from) && (!until || now <= until);

    const approved = await this.prisma.mockAccessRequest.findFirst({ where: { studentId, mockExamId, status: 'APPROVED' }, orderBy: { reviewedAt: 'desc' } });
    if (approved && withinWindow(approved.availableFrom, approved.availableUntil)) return;

    const batchIds = (await this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { batchId: true } })).map((e) => e.batchId);
    if (batchIds.length) {
      const activation = await this.prisma.mockActivation.findFirst({ where: { batchId: { in: batchIds }, mockExamId, status: 'ACTIVE' } });
      if (activation && withinWindow(activation.availableFrom, activation.availableUntil)) return;
    }

    if (approved) throw new AppError('MOCK_NOT_AVAILABLE', 403, 'Your approved window for this mock test has not started yet or has ended.');
    throw new AppError('MOCK_ACCESS_REQUIRED', 403, 'Request access to this mock test first.');
  }

  /** Read-only status for the student's mock-test list — same rule as assertAttemptAllowed, without throwing. */
  async statusFor(studentId: string, assessmentId: string) {
    const now = new Date();
    const withinWindow = (from: Date | null, until: Date | null) => (!from || now >= from) && (!until || now <= until);

    const [request, batchIds] = await Promise.all([
      this.prisma.mockAccessRequest.findFirst({ where: { studentId, assessmentId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { batchId: true } }).then((rows) => rows.map((e) => e.batchId)),
    ]);
    const activation = batchIds.length ? await this.prisma.mockActivation.findFirst({ where: { batchId: { in: batchIds }, assessmentId, status: 'ACTIVE' } }) : null;
    return this.statusShape(request, activation);
  }

  /** statusFor()'s twin for the new whole-module bundle shape (Phase 6). */
  async statusForMockExam(studentId: string, mockExamId: string) {
    const [request, batchIds] = await Promise.all([
      this.prisma.mockAccessRequest.findFirst({ where: { studentId, mockExamId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { batchId: true } }).then((rows) => rows.map((e) => e.batchId)),
    ]);
    const activation = batchIds.length ? await this.prisma.mockActivation.findFirst({ where: { batchId: { in: batchIds }, mockExamId, status: 'ACTIVE' } }) : null;
    return this.statusShape(request, activation);
  }

  private statusShape(
    request: { id: string; status: string; availableFrom: Date | null; availableUntil: Date | null; decisionNote: string | null } | null,
    activation: { availableFrom: Date; availableUntil: Date | null; instructions: string | null } | null,
  ) {
    const now = new Date();
    const withinWindow = (from: Date | null, until: Date | null) => (!from || now >= from) && (!until || now <= until);

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

  @HttpCode(201) @Post('mock-exams/:id/access-requests')
  requestMockExam(@Param('id', uuid) mockExamId: string, @Body(new ZodPipe(mockAccessRequestSchema)) body: MockAccessRequestInput, @CurrentUser() u: AuthUser) {
    return this.mocks.requestMockExam(sid(u), mockExamId, body);
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

  @RequirePermission('mock.review') @HttpCode(201) @Post('mentor/mock-exams/:id/mock-activations')
  async activateMockExam(@Param('id', uuid) mockExamId: string, @Body(new ZodPipe(mockActivationSchema)) body: MockActivationInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.mocks.activateMockExam(await this.rev(u), mockExamId, body, actor(u, req));
  }

  @RequirePermission('mock.review') @Get('mentor/batches/:id/mock-activations')
  async listActivations(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.mocks.listActivations(await this.rev(u), id); }

  @RequirePermission('mock.review') @HttpCode(204) @Delete('mentor/mock-activations/:id')
  async cancel(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { await this.mocks.cancelActivation(await this.rev(u), id, actor(u, req)); }
}

@Module({ controllers: [MocksController], providers: [MocksService], exports: [MocksService] })
export class MocksModule {}

import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { LectureRecordingInput, LectureRecordingReviewInput, UpdateLectureRecordingInput, lectureRecordingReviewSchema, lectureRecordingSchema, updateLectureRecordingSchema } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { parseDriveUrl } from '../live/meeting-links';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

export interface Reviewer { userId: string; mentorId?: string; canOverseeAll: boolean }

/**
 * Google Drive lecture recordings (spec §47–§51). The platform never uploads or stores the video —
 * only the Drive share link and metadata. Publishing does not mean the platform has verified the
 * file is playable: that still depends entirely on the Drive link's own sharing permissions.
 */
@Injectable()
export class RecordingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async assertBatch(r: Reviewer, batchId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) throw notFound('Batch');
    if (r.canOverseeAll) return batch;
    const ok = r.mentorId ? await this.prisma.batchMentor.count({ where: { batchId, mentorId: r.mentorId } }) : 0;
    if (!ok) throw forbidden('You are not assigned to this batch.');
    return batch;
  }

  private checkDriveUrl(driveUrl: string) {
    const check = parseDriveUrl(driveUrl);
    if (!check.valid) throw new AppError('RECORDING_INVALID_URL', 422, check.reason, { driveUrl: check.reason });
    return check.fileId;
  }

  async submit(r: Reviewer, input: LectureRecordingInput, actor: Actor) {
    await this.assertBatch(r, input.batchId);
    const fileId = this.checkDriveUrl(input.driveUrl);
    if (input.sessionId) {
      const s = await this.prisma.liveSession.findFirst({ where: { id: input.sessionId, batchId: input.batchId } });
      if (!s) throw notFound('Class session');
    }
    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.lectureRecording.create({
        data: {
          sessionId: input.sessionId, batchId: input.batchId, title: input.title, module: input.module,
          driveUrl: input.driveUrl, driveFileId: fileId, description: input.description, chapters: input.chapters as never,
          submittedBy: actor.userId, status: 'SUBMITTED',
        },
      });
      await this.audit.record({ ...actor, action: 'RECORDING_SUBMITTED', entityType: 'LectureRecording', entityId: rec.id, after: { batchId: input.batchId, title: input.title } }, tx);
      return rec;
    });
  }

  async update(r: Reviewer, id: string, input: UpdateLectureRecordingInput, actor: Actor) {
    const before = await this.prisma.lectureRecording.findUnique({ where: { id } });
    if (!before) throw notFound('Recording');
    await this.assertBatch(r, before.batchId);
    if (!r.canOverseeAll && before.submittedBy !== actor.userId) throw forbidden('You can only edit recordings you submitted.');
    const fileId = input.driveUrl ? this.checkDriveUrl(input.driveUrl) : undefined;
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.lectureRecording.update({
        where: { id },
        data: { title: input.title, module: input.module, description: input.description, driveUrl: input.driveUrl, driveFileId: fileId, chapters: input.chapters as never },
      });
      await this.audit.record({ ...actor, action: 'RECORDING_UPDATED', entityType: 'LectureRecording', entityId: id, before, after }, tx);
      return after;
    });
  }

  async listForMentor(r: Reviewer, batchId?: string) {
    const where = r.canOverseeAll
      ? (batchId ? { batchId } : {})
      : { batchId: batchId ? batchId : { in: (await this.prisma.batchMentor.findMany({ where: { mentorId: r.mentorId } })).map((b) => b.batchId) } };
    if (batchId) await this.assertBatch(r, batchId);
    return this.prisma.lectureRecording.findMany({ where, orderBy: { submittedAt: 'desc' }, include: { batch: { select: { name: true } }, session: { select: { id: true, topic: true, startsAt: true } } } });
  }

  async listForBatchAdmin(batchId: string) {
    return this.prisma.lectureRecording.findMany({ where: { batchId }, orderBy: { submittedAt: 'desc' }, include: { session: { select: { id: true, topic: true, startsAt: true } } } });
  }

  async review(id: string, decision: 'PUBLISHED' | 'REJECTED', input: LectureRecordingReviewInput, actor: Actor) {
    const before = await this.prisma.lectureRecording.findUnique({ where: { id } });
    if (!before) throw notFound('Recording');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.lectureRecording.update({
        where: { id }, data: { status: decision, reviewedBy: actor.userId, reviewedAt: new Date(), reviewNote: input.reviewNote, publishedAt: decision === 'PUBLISHED' ? new Date() : null },
      });
      await this.audit.record({ ...actor, action: decision === 'PUBLISHED' ? 'RECORDING_PUBLISHED' : 'RECORDING_REJECTED', entityType: 'LectureRecording', entityId: id, before, after }, tx);
      return after;
    });
  }

  /** Only published recordings for batches the student is (or was) enrolled in. */
  async listForStudent(studentId: string) {
    const batchIds = (await this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null }, select: { batchId: true } })).map((e) => e.batchId);
    if (!batchIds.length) return [];
    const rows = await this.prisma.lectureRecording.findMany({
      where: { batchId: { in: batchIds }, status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' },
      include: { batch: { select: { name: true } }, session: { select: { topic: true, startsAt: true } }, views: { where: { studentId }, select: { openedAt: true, reviewedAt: true } } },
    });
    return rows.map((r) => ({ ...r, opened: r.views.length > 0, views: undefined }));
  }

  async markOpened(studentId: string, id: string) {
    const rec = await this.prisma.lectureRecording.findFirst({ where: { id, status: 'PUBLISHED' } });
    if (!rec) throw notFound('Recording');
    const enrolled = await this.prisma.enrollment.count({ where: { studentId, batchId: rec.batchId, deletedAt: null } });
    if (!enrolled) throw forbidden('You are not enrolled in this batch.');
    await this.prisma.lectureRecordingView.upsert({
      where: { recordingId_studentId: { recordingId: id, studentId } }, create: { recordingId: id, studentId }, update: {},
    });
    return { ok: true };
  }
}

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller()
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService, private readonly ctx: UserContextService) {}

  private async rev(u: AuthUser): Promise<Reviewer> {
    const c = (await this.ctx.get(u.id))!;
    return { userId: u.id, mentorId: u.mentorId, canOverseeAll: c.permissions.has('batch.create') };
  }

  @RequirePermission('recording.manage') @HttpCode(201) @Post('mentor/recordings')
  async submit(@Body(new ZodPipe(lectureRecordingSchema)) body: LectureRecordingInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recordings.submit(await this.rev(u), body, actor(u, req));
  }

  @RequirePermission('recording.manage') @Get('mentor/recordings')
  async listMine(@Query(new ZodPipe(z.object({ batchId: z.string().uuid().optional() }))) q: { batchId?: string }, @CurrentUser() u: AuthUser) {
    return this.recordings.listForMentor(await this.rev(u), q.batchId);
  }

  @RequirePermission('recording.manage') @Patch('mentor/recordings/:id')
  async update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateLectureRecordingSchema)) body: UpdateLectureRecordingInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recordings.update(await this.rev(u), id, body, actor(u, req));
  }

  @RequirePermission('batch.analytics.view') @Get('admin/batches/:id/recordings')
  listForBatch(@Param('id', uuid) id: string) { return this.recordings.listForBatchAdmin(id); }

  @RequirePermission('recording.review') @HttpCode(200) @Post('admin/recordings/:id/publish')
  async publish(@Param('id', uuid) id: string, @Body(new ZodPipe(lectureRecordingReviewSchema)) body: LectureRecordingReviewInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recordings.review(id, 'PUBLISHED', body, actor(u, req));
  }

  @RequirePermission('recording.review') @HttpCode(200) @Post('admin/recordings/:id/reject')
  async reject(@Param('id', uuid) id: string, @Body(new ZodPipe(lectureRecordingReviewSchema)) body: LectureRecordingReviewInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recordings.review(id, 'REJECTED', body, actor(u, req));
  }

  @Get('me/recordings')
  listForStudent(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts can do this.');
    return this.recordings.listForStudent(u.studentId);
  }

  @HttpCode(200) @Post('me/recordings/:id/open')
  markOpened(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts can do this.');
    return this.recordings.markOpened(u.studentId, id);
  }
}

@Module({ controllers: [RecordingsController], providers: [RecordingsService], exports: [RecordingsService] })
export class RecordingsModule {}

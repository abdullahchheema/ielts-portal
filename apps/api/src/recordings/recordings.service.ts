import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { LectureRecordingInput, LectureRecordingReviewInput, UpdateLectureRecordingInput, lectureRecordingReviewSchema, lectureRecordingSchema, updateLectureRecordingSchema } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { parseDriveUrl } from '../live/meeting-links';
import { StorageService } from '../integrations/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

const uuid = new ParseUUIDPipe();
const MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;
const MEDIA_TYPES = ['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4'] as const;
const SIGNED_TTL_SEC = 300;

const externalSchema = z.object({
  externalUrl: z.string().url().max(500).refine((u) => u.startsWith('https://'), 'Use an https link.'),
  durationSec: z.number().int().min(1).max(86_400).nullable().optional(),
  availability: z.enum(['BATCH', 'ALL_STUDENTS', 'ALUMNI']).default('BATCH'),
});
const presignSchema = z.object({
  mime: z.enum(MEDIA_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_RECORDING_BYTES),
  availability: z.enum(['BATCH', 'ALL_STUDENTS', 'ALUMNI']).default('BATCH'),
});
const progressSchema = z.object({ positionSec: z.number().int().min(0).max(86_400), completed: z.boolean().optional() });

/**
 * Class recordings (uploaded or S3-hosted video/audio). Students see only recordings for batches
 * they are actively enrolled in, unless a recording is explicitly open to all students. Playback
 * URLs are signed for a few minutes and checked on every request.
 */
@Injectable()
export class RecordingsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly audit: AuditService) {}

  /** Teachers record for their own batches; administrators with batch oversight for any. */
  private async assertSessionManager(sessionId: string, mentorId: string | undefined, canOverseeAll: boolean) {
    const s = await this.prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true, batchId: true } });
    if (!s) throw notFound('Session');
    if (!canOverseeAll) {
      const ok = mentorId ? await this.prisma.batchMentor.count({ where: { batchId: s.batchId, mentorId } }) : 0;
      if (!ok) throw forbidden('You are not assigned to this batch.');
    }
    return s;
  }

  async addExternal(sessionId: string, input: z.infer<typeof externalSchema>, mentorId: string | undefined, canOverseeAll: boolean, actorId: string, meta: { ip?: string; userAgent?: string }) {
    const s = await this.assertSessionManager(sessionId, mentorId, canOverseeAll);
    const rec = await this.prisma.classRecording.create({
      data: {
        sessionId, batchId: s.batchId, externalUrl: input.externalUrl, durationSec: input.durationSec ?? null, status: 'READY',
        availability: input.availability, uploadedById: actorId,
      },
      select: { id: true, status: true },
    });
    await this.audit.record({ userId: actorId, ...meta, action: 'TEACHER_ADDED_RECORDING', entityType: 'ClassRecording', entityId: rec.id, after: { sessionId, availability: input.availability, source: 'EXTERNAL' } });
    return rec;
  }

  /** Storage upload, step one: reserve the record and return a presigned PUT. Local storage returns null mode. */
  async presign(sessionId: string, input: z.infer<typeof presignSchema>, mentorId: string | undefined, canOverseeAll: boolean, actorId: string) {
    const s = await this.assertSessionManager(sessionId, mentorId, canOverseeAll);
    const rec = await this.prisma.classRecording.create({
      data: { sessionId, batchId: s.batchId, mime: input.mime, sizeBytes: BigInt(input.sizeBytes), status: 'UPLOADING', availability: input.availability, uploadedById: actorId },
      select: { id: true },
    });
    const key = `recordings/${s.batchId}/${rec.id}`;
    await this.prisma.classRecording.update({ where: { id: rec.id }, data: { storageKey: key } });
    const put = await this.storage.presignPut(key, input.mime, SIGNED_TTL_SEC * 3);
    if (!put) return { id: rec.id, mode: 'unavailable' as const, reason: 'Direct upload needs S3 storage. Add the recording as a link instead.' };
    return { id: rec.id, mode: 'direct' as const, url: put.url, headers: put.headers };
  }

  /** Storage upload, step two: confirm the object arrived, is within the size limit, and is media. */
  async complete(recordingId: string, mentorId: string | undefined, canOverseeAll: boolean) {
    const rec = await this.prisma.classRecording.findUnique({ where: { id: recordingId }, select: { id: true, storageKey: true, status: true, batchId: true } });
    if (!rec) throw notFound('Recording');
    if (!canOverseeAll) {
      const ok = mentorId ? await this.prisma.batchMentor.count({ where: { batchId: rec.batchId, mentorId } }) : 0;
      if (!ok) throw forbidden('You are not assigned to this batch.');
    }
    if (rec.status !== 'UPLOADING' || !rec.storageKey) throw conflict('CONFLICT', 'This recording is not waiting for an upload.');
    const meta = await this.storage.head(rec.storageKey);
    if (!meta || meta.size <= 0 || meta.size > MAX_RECORDING_BYTES) {
      await this.prisma.classRecording.update({ where: { id: rec.id }, data: { status: 'FAILED' } });
      throw new AppError('UPLOAD_FAILED', 422, 'The recording did not arrive intact. Please upload it again.');
    }
    await this.prisma.classRecording.update({ where: { id: rec.id }, data: { status: 'READY', sizeBytes: BigInt(meta.size) } });
    return { id: rec.id, status: 'READY' };
  }

  /** Recordings the student may see: their active batches, and any recording opened to all students. */
  async forStudent(studentId: string) {
    const enrolled = await this.prisma.enrollment.findMany({ where: { studentId, status: 'ACTIVE', deletedAt: null }, select: { batchId: true } });
    const batchIds = enrolled.map((e) => e.batchId);
    const rows = await this.prisma.classRecording.findMany({
      where: { status: 'READY', OR: [{ batchId: { in: batchIds } }, { availability: 'ALL_STUDENTS' }] },
      orderBy: { createdAt: 'desc' }, take: 100,
      select: {
        id: true, durationSec: true, createdAt: true, availability: true,
        session: { select: { topic: true, title: true, startsAt: true, mentor: { select: { displayName: true } } } },
        views: { where: { studentId }, select: { positionSec: true, completedAt: true }, take: 1 },
      },
    });
    return rows.map(({ views, ...r }) => ({ ...r, progress: views[0] ? { positionSec: views[0].positionSec, completed: !!views[0].completedAt } : null }));
  }

  /** Batch recordings need an active enrolment in that batch. Alumni recordings need the alumni stage. Everyone else is refused as not found. */
  private async assertCanView(studentId: string, rec: { batchId: string; availability: string }) {
    if (rec.availability === 'ALL_STUDENTS') return;
    if (rec.availability === 'ALUMNI') {
      const alumni = await this.prisma.studentLifecycle.count({ where: { studentId, stage: 'ALUMNI' } });
      if (!alumni) throw notFound('Recording');
      return;
    }
    const ok = await this.prisma.enrollment.count({ where: { studentId, batchId: rec.batchId, status: 'ACTIVE', deletedAt: null } });
    if (!ok) throw notFound('Recording');
  }

  /** Playback. The student must be allowed to see the recording; the link is signed or external and is never stored for reuse. */
  async play(studentId: string, recordingId: string) {
    const rec = await this.prisma.classRecording.findFirst({ where: { id: recordingId, status: 'READY' }, select: { id: true, batchId: true, availability: true, storageKey: true, externalUrl: true } });
    if (!rec) throw notFound('Recording');
    await this.assertCanView(studentId, rec);
    if (rec.storageKey) return { url: await this.storage.signedUrl(rec.storageKey, SIGNED_TTL_SEC), expiresInSec: SIGNED_TTL_SEC };
    if (rec.externalUrl) return { url: rec.externalUrl, expiresInSec: null };
    throw notFound('Recording');
  }

  /** Watch progress. Position only moves forward, and completion is recorded once. */
  async progress(studentId: string, recordingId: string, positionSec: number, completed: boolean) {
    const rec = await this.prisma.classRecording.findFirst({ where: { id: recordingId, status: 'READY' }, select: { id: true, batchId: true, availability: true, durationSec: true } });
    if (!rec) throw notFound('Recording');
    await this.assertCanView(studentId, rec);
    const nearEnd = rec.durationSec ? positionSec >= rec.durationSec * 0.9 : false;
    const done = completed || nearEnd;
    const existing = await this.prisma.recordingView.findUnique({ where: { recordingId_studentId: { recordingId, studentId } }, select: { positionSec: true, completedAt: true } });
    const position = Math.max(existing?.positionSec ?? 0, positionSec);
    await this.prisma.recordingView.upsert({
      where: { recordingId_studentId: { recordingId, studentId } },
      create: { recordingId, studentId, positionSec: position, completedAt: done ? new Date() : null },
      update: { positionSec: position, ...(done && !existing?.completedAt ? { completedAt: new Date() } : {}) },
    });
    return { positionSec: position, completed: done || !!existing?.completedAt };
  }
}

const sid = (u: AuthUser) => { if (!u.studentId) throw forbidden(); return u.studentId; };

@Controller()
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService, private readonly ctx: UserContextService) {}

  @RequirePermission('teaching.view') @HttpCode(201) @Post('mentor/sessions/:id/recordings')
  async external(@Param('id', uuid) id: string, @Body(new ZodPipe(externalSchema)) body: z.infer<typeof externalSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    const c = (await this.ctx.get(u.id))!;
    return this.recordings.addExternal(id, body, u.mentorId, c.permissions.has('batch.create'), u.id, clientMeta(req));
  }

  @RequirePermission('teaching.view') @HttpCode(200) @Post('mentor/sessions/:id/recordings/presign')
  async presign(@Param('id', uuid) id: string, @Body(new ZodPipe(presignSchema)) body: z.infer<typeof presignSchema>, @CurrentUser() u: AuthUser) {
    const c = (await this.ctx.get(u.id))!;
    return this.recordings.presign(id, body, u.mentorId, c.permissions.has('batch.create'), u.id);
  }

  @RequirePermission('teaching.view') @HttpCode(200) @Post('mentor/recordings/:id/complete')
  async complete(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    const c = (await this.ctx.get(u.id))!;
    return this.recordings.complete(id, u.mentorId, c.permissions.has('batch.create'));
  }

  // Uploaded/hosted video lives under `me/class-recordings`, not `me/recordings` — that bare path
  // is owned by LectureRecordingsController below (Drive-link lecture archive), which already has
  // integration-test coverage at it.
  @Get('me/class-recordings')
  list(@CurrentUser() u: AuthUser) { return this.recordings.forStudent(sid(u)); }

  @HttpCode(200) @Post('me/class-recordings/:id/play')
  play(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.recordings.play(sid(u), id); }

  @HttpCode(200) @Post('me/class-recordings/:id/progress')
  progress(@Param('id', uuid) id: string, @Body(new ZodPipe(progressSchema)) body: z.infer<typeof progressSchema>, @CurrentUser() u: AuthUser) {
    return this.recordings.progress(sid(u), id, body.positionSec, !!body.completed);
  }
}

export interface Reviewer { userId: string; mentorId?: string; canOverseeAll: boolean }

/**
 * Google Drive lecture recordings (spec §47–§51). The platform never uploads or stores the video —
 * only the Drive share link and metadata. Publishing does not mean the platform has verified the
 * file is playable: that still depends entirely on the Drive link's own sharing permissions.
 *
 * Distinct from RecordingsService above (which hosts/uploads actual video files): this is a
 * teacher-submitted, admin-reviewed archive of external lecture links. Student-facing routes live
 * under `me/lecture-recordings` so they do not collide with RecordingsController's `me/recordings`.
 */
@Injectable()
export class LectureRecordingsService {
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

const lectureActor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller()
export class LectureRecordingsController {
  constructor(private readonly recordings: LectureRecordingsService, private readonly ctx: UserContextService) {}

  private async rev(u: AuthUser): Promise<Reviewer> {
    const c = (await this.ctx.get(u.id))!;
    return { userId: u.id, mentorId: u.mentorId, canOverseeAll: c.permissions.has('batch.create') };
  }

  @RequirePermission('recording.manage') @HttpCode(201) @Post('mentor/recordings')
  async submit(@Body(new ZodPipe(lectureRecordingSchema)) body: LectureRecordingInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recordings.submit(await this.rev(u), body, lectureActor(u, req));
  }

  @RequirePermission('recording.manage') @Get('mentor/recordings')
  async listMine(@Query(new ZodPipe(z.object({ batchId: z.string().uuid().optional() }))) q: { batchId?: string }, @CurrentUser() u: AuthUser) {
    return this.recordings.listForMentor(await this.rev(u), q.batchId);
  }

  @RequirePermission('recording.manage') @Patch('mentor/recordings/:id')
  async update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateLectureRecordingSchema)) body: UpdateLectureRecordingInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recordings.update(await this.rev(u), id, body, lectureActor(u, req));
  }

  @RequirePermission('batch.analytics.view') @Get('admin/batches/:id/recordings')
  listForBatch(@Param('id', uuid) id: string) { return this.recordings.listForBatchAdmin(id); }

  @RequirePermission('recording.review') @HttpCode(200) @Post('admin/recordings/:id/publish')
  async publish(@Param('id', uuid) id: string, @Body(new ZodPipe(lectureRecordingReviewSchema)) body: LectureRecordingReviewInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recordings.review(id, 'PUBLISHED', body, lectureActor(u, req));
  }

  @RequirePermission('recording.review') @HttpCode(200) @Post('admin/recordings/:id/reject')
  async reject(@Param('id', uuid) id: string, @Body(new ZodPipe(lectureRecordingReviewSchema)) body: LectureRecordingReviewInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.recordings.review(id, 'REJECTED', body, lectureActor(u, req));
  }

  // Owns the unprefixed `me/recordings` surface (matches the existing integration-test coverage
  // in batch-analytics-recordings.spec.ts); RecordingsController's uploaded-video equivalent lives
  // under `me/class-recordings` instead, since both cannot own the same bare path.
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

@Module({
  controllers: [RecordingsController, LectureRecordingsController],
  providers: [RecordingsService, LectureRecordingsService],
  exports: [RecordingsService, LectureRecordingsService],
})
export class RecordingsModule {}

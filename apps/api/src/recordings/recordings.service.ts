import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
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
 * Class recordings. Students see only recordings for batches they are actively enrolled in, unless a recording is
 * explicitly open to all students. Playback URLs are signed for a few minutes and checked on every request.
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

  /** Playback. The student must be allowed to see the recording; the link is signed or external and is never stored for reuse. */
  async play(studentId: string, recordingId: string) {
    const rec = await this.prisma.classRecording.findFirst({ where: { id: recordingId, status: 'READY' }, select: { id: true, batchId: true, availability: true, storageKey: true, externalUrl: true } });
    if (!rec) throw notFound('Recording');
    if (rec.availability !== 'ALL_STUDENTS') {
      const ok = await this.prisma.enrollment.count({ where: { studentId, batchId: rec.batchId, status: 'ACTIVE', deletedAt: null } });
      if (!ok) throw notFound('Recording');
    }
    if (rec.storageKey) return { url: await this.storage.signedUrl(rec.storageKey, SIGNED_TTL_SEC), expiresInSec: SIGNED_TTL_SEC };
    if (rec.externalUrl) return { url: rec.externalUrl, expiresInSec: null };
    throw notFound('Recording');
  }

  /** Watch progress. Position only moves forward, and completion is recorded once. */
  async progress(studentId: string, recordingId: string, positionSec: number, completed: boolean) {
    const rec = await this.prisma.classRecording.findFirst({ where: { id: recordingId, status: 'READY' }, select: { id: true, batchId: true, availability: true, durationSec: true } });
    if (!rec) throw notFound('Recording');
    if (rec.availability !== 'ALL_STUDENTS') {
      const ok = await this.prisma.enrollment.count({ where: { studentId, batchId: rec.batchId, status: 'ACTIVE', deletedAt: null } });
      if (!ok) throw notFound('Recording');
    }
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

  @Get('me/recordings')
  list(@CurrentUser() u: AuthUser) { return this.recordings.forStudent(sid(u)); }

  @HttpCode(200) @Post('me/recordings/:id/play')
  play(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.recordings.play(sid(u), id); }

  @HttpCode(200) @Post('me/recordings/:id/progress')
  progress(@Param('id', uuid) id: string, @Body(new ZodPipe(progressSchema)) body: z.infer<typeof progressSchema>, @CurrentUser() u: AuthUser) {
    return this.recordings.progress(sid(u), id, body.positionSec, !!body.completed);
  }
}

@Module({ controllers: [RecordingsController], providers: [RecordingsService], exports: [RecordingsService] })
export class RecordingsModule {}

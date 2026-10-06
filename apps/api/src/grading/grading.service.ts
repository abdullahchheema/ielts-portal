import { overseesAllBatches } from '../common/scope';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { randomUUID } from 'node:crypto';
import type { AssignmentSettingsInput, DraftInput, GradeInput } from '@ielts/validation';
import { roundIeltsBand } from '../assessments/grading';
import { AuditService } from '../audit/audit.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { ieltsSummary } from '../common/ielts';
import { Actor } from '../courses/courses.service';
import { StorageService, sniffFileType } from '../integrations/storage.service';
import { LearningService } from '../learning/learning.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WritingService } from '../writing/writing.service';

const AUDIO_MIMES = ['audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'];
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const invalid = (field: string, msg: string) => new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { [field]: msg });

export interface Reviewer { userId: string; mentorId?: string; permissions: Set<string> }

@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly learning: LearningService,
    private readonly notify: NotificationsService,
    private readonly writing: WritingService,
  ) {}

  // ───────── admin: configure an assignment on a content item ─────────
  listRubrics() {
    return this.prisma.rubric.findMany({ orderBy: { name: 'asc' }, include: { criteria: { orderBy: { sequence: 'asc' } } } });
  }

  async setAssignment(itemId: string, input: AssignmentSettingsInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.contentItem.findUnique({ where: { id: itemId }, include: { section: { include: { version: true } } } });
      if (!item) throw notFound('Content item');
      if (item.section.version.status !== 'DRAFT') throw new AppError('VERSION_PUBLISHED_IMMUTABLE', 409, 'Published versions are read-only. Create a new version to make changes.');
      if (!['WRITING_TASK', 'SPEAKING_TASK', 'ASSIGNMENT'].includes(item.contentType)) throw invalid('contentType', 'Only writing, speaking and assignment items take a submission.');
      const rubric = await tx.rubric.findUnique({ where: { id: input.rubricId } });
      if (!rubric || rubric.skill !== input.skill) throw invalid('rubricId', `Choose a ${input.skill.toLowerCase()} rubric.`);
      const data = { skill: input.skill, rubricId: input.rubricId, instructions: input.instructions, dueAt: input.dueAt ? new Date(input.dueAt) : null, minWords: input.minWords ?? null };
      const a = await tx.assignment.upsert({ where: { contentItemId: itemId }, create: { contentItemId: itemId, ...data }, update: data });
      await this.audit.record({ ...actor, action: 'ASSIGNMENT_CONFIGURED', entityType: 'Assignment', entityId: a.id, after: data }, tx);
      return a;
    });
  }

  // ───────── student ─────────
  /** Loads the assignment and proves the student may open its lesson (enrollment, release rules...). */
  private async accessible(studentId: string, assignmentId: string) {
    const a = await this.prisma.assignment.findUnique({ where: { id: assignmentId }, include: { rubric: { include: { criteria: { orderBy: { sequence: 'asc' } } } } } });
    if (!a) throw notFound('Assignment');
    const { enrollment } = await this.learning.assertItemAccess(studentId, a.contentItemId);
    return { assignment: a, enrollment };
  }

  /** Autosaved writing draft. Revision-checked so two tabs cannot overwrite each other. */
  async saveDraft(studentId: string, assignmentId: string, input: DraftInput) {
    const { assignment, enrollment } = await this.accessible(studentId, assignmentId);
    if (assignment.skill !== 'WRITING') throw invalid('skill', 'Drafts are only for writing tasks.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM student_profiles WHERE id = ${studentId}::uuid FOR UPDATE`;
      const open = await tx.submission.findFirst({ where: { assignmentId, studentId, status: { in: ['DRAFT', 'SUBMITTED'] } } });
      if (!open) {
        if (input.revision !== 0) throw new AppError('ANSWER_SAVE_CONFLICT', 409, 'Your draft changed elsewhere. Reload.', { revision: 0 });
        const created = await tx.submission.create({ data: { assignmentId, studentId, enrollmentId: enrollment.id, body: input.body, status: 'DRAFT', revision: 1, wordCount: countWords(input.body) } });
        return { revision: created.revision };
      }
      if (open.status === 'SUBMITTED') throw new AppError('ATTEMPT_ALREADY_SUBMITTED', 409, 'Your submission is already waiting for feedback.');
      if (open.revision !== input.revision) throw new AppError('ANSWER_SAVE_CONFLICT', 409, 'Your draft changed elsewhere. Reload.', { revision: open.revision, body: open.body });
      const updated = await tx.submission.update({ where: { id: open.id }, data: { body: input.body, revision: { increment: 1 }, wordCount: countWords(input.body) } });
      return { revision: updated.revision };
    });
  }

  async submitWriting(studentId: string, assignmentId: string, bodyOverride?: string) {
    const { assignment, enrollment } = await this.accessible(studentId, assignmentId);
    if (assignment.skill !== 'WRITING') throw invalid('skill', 'This task takes an audio recording.');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM student_profiles WHERE id = ${studentId}::uuid FOR UPDATE`;
      const open = await tx.submission.findFirst({ where: { assignmentId, studentId, status: { in: ['DRAFT', 'SUBMITTED'] } } });
      if (open?.status === 'SUBMITTED') return { submission: open, created: false }; // idempotent double-submit
      const body = (bodyOverride ?? open?.body ?? '').trim();
      if (countWords(body) === 0) throw new AppError('SUBMISSION_INCOMPLETE', 422, 'Write your answer before submitting.');
      const now = new Date();
      const data = { body, status: 'SUBMITTED', submittedAt: now, wordCount: countWords(body), late: !!assignment.dueAt && now > assignment.dueAt, enrollmentId: enrollment.id };
      const submission = open
        ? await tx.submission.update({ where: { id: open.id }, data: { ...data, revision: { increment: 1 } } })
        : await tx.submission.create({ data: { assignmentId, studentId, ...data } });
      return { submission, created: true };
    });
    if (result.created) {
      await this.afterSubmit(studentId, assignment, enrollment.id, enrollment.batchId, result.submission.id);
      // AI analysis is supporting evidence for the mentor. It is queued after the commit and never changes the grade.
      if (assignment.skill === 'WRITING') await this.writing.queueSubmissionAnalysis(result.submission.id, result.submission.revision).catch(() => undefined);
    }
    return this.presentOwn(result.submission.id, studentId);
  }

  async submitAudio(studentId: string, assignmentId: string, file: { buffer: Buffer; size: number } | undefined) {
    const { assignment, enrollment } = await this.accessible(studentId, assignmentId);
    if (assignment.skill !== 'SPEAKING') throw invalid('skill', 'This task takes written text.');
    if (!file) throw new AppError('SUBMISSION_INCOMPLETE', 422, 'Record or upload your answer first.');
    if (file.size > MAX_AUDIO_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The recording is larger than 25 MB.');
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed || !AUDIO_MIMES.includes(sniffed.mime)) throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Upload an MP3, M4A, WAV, OGG or WebM recording.');

    const existing = await this.prisma.submission.findFirst({ where: { assignmentId, studentId, status: { in: ['DRAFT', 'SUBMITTED'] } } });
    if (existing) return this.presentOwn(existing.id, studentId); // already waiting for feedback
    const fileKey = `submissions/${studentId}/${assignmentId}/${randomUUID()}.${sniffed.ext}`;
    await this.storage.put(fileKey, file.buffer, sniffed.mime);
    const now = new Date();
    let id: string;
    try {
      ({ id } = await this.prisma.submission.create({
        data: { assignmentId, studentId, enrollmentId: enrollment.id, fileKey, fileMime: sniffed.mime, status: 'SUBMITTED', submittedAt: now, late: !!assignment.dueAt && now > assignment.dueAt },
      }));
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') { // raced with a double-click: the other request won
        const won = await this.prisma.submission.findFirstOrThrow({ where: { assignmentId, studentId, status: { in: ['DRAFT', 'SUBMITTED'] } } });
        return this.presentOwn(won.id, studentId);
      }
      throw e;
    }
    await this.afterSubmit(studentId, assignment, enrollment.id, enrollment.batchId, id);
    return this.presentOwn(id, studentId);
  }

  /** Completes the lesson (submitting is what counts), tells the assigned mentors, and logs to the student timeline. */
  private async afterSubmit(studentId: string, a: { id: string; contentItemId: string; skill: string }, enrollmentId: string, batchId: string, submissionId: string) {
    await this.learning.markCompletedBySystem(studentId, enrollmentId, a.contentItemId).catch(() => undefined);
    await this.prisma.studentTimelineEvent.create({ data: { studentId, type: 'SUBMISSION_SENT', summary: `Submitted a ${a.skill.toLowerCase()} task`, meta: { submissionId } } });
    const roles = a.skill === 'WRITING' ? ['MAIN', 'WRITING'] : ['MAIN', 'SPEAKING'];
    const mentors = await this.prisma.batchMentor.findMany({ where: { batchId, mentorRole: { in: roles as never } }, include: { mentor: { select: { userId: true } } } });
    for (const uid of new Set(mentors.map((m) => m.mentor.userId))) {
      await this.notify.notifyUser(uid, 'SUBMISSION_RECEIVED', 'New submission to grade', `A student submitted a ${a.skill.toLowerCase()} task.`, {
        entityType: 'SUBMISSION', entityId: submissionId, link: `/teacher/grading/${submissionId}`,
      });
    }
  }

  async listMine(studentId: string) {
    const rows = await this.prisma.submission.findMany({
      where: { studentId, status: { not: 'DRAFT' } }, orderBy: { submittedAt: 'desc' }, take: 100,
      include: { assignment: { select: { skill: true, contentItem: { select: { title: true } } } } },
    });
    return rows.map((r) => ({ id: r.id, title: r.assignment.contentItem.title, skill: r.assignment.skill, status: r.status, submittedAt: r.submittedAt, gradedAt: r.gradedAt, finalBand: r.finalBand === null ? null : Number(r.finalBand) }));
  }

  private async presentOwn(submissionId: string, studentId: string) {
    const s = await this.prisma.submission.findFirst({ where: { id: submissionId, studentId }, include: this.detailInclude() });
    if (!s) throw notFound('Submission');
    return this.present(s, true);
  }

  getMine(studentId: string, id: string) { return this.presentOwn(id, studentId); }

  // ───────── mentor ─────────
  private detailInclude() {
    return {
      assignment: { include: { contentItem: { select: { title: true } }, rubric: { include: { criteria: { orderBy: { sequence: 'asc' as const } } } } } },
      student: {
        select: {
          id: true, firstName: true, lastName: true, currentBand: true, targetBand: true,
          ieltsHistory: true, ieltsOverall: true, ieltsListening: true, ieltsReading: true, ieltsWriting: true, ieltsSpeaking: true, ieltsTestDate: true, ieltsAttempts: true,
        },
      },
      feedback: { orderBy: { createdAt: 'desc' as const }, include: { rubricScores: { include: { criterion: { select: { name: true, sequence: true } } } } } },
    } satisfies Prisma.SubmissionInclude;
  }

  /** Mentors see only submissions from batches they are assigned to (MAIN, or the matching skill role). */
  private scope(r: Reviewer): Prisma.SubmissionWhereInput {
    if (r.mentorId) {
      const some = (roles: ('MAIN' | 'WRITING' | 'SPEAKING')[]) => ({ enrollment: { batch: { mentors: { some: { mentorId: r.mentorId, mentorRole: { in: roles } } } } } });
      return { OR: [{ assignment: { skill: 'WRITING' }, ...some(['MAIN', 'WRITING']) }, { assignment: { skill: 'SPEAKING' }, ...some(['MAIN', 'SPEAKING']) }] };
    }
    if (overseesAllBatches(r.permissions)) return {}; // academic admins oversee every batch
    throw forbidden('You are not assigned to grade submissions.');
  }

  async queue(r: Reviewer, q: { status: 'SUBMITTED' | 'GRADED'; skip: number; take: number }) {
    const where: Prisma.SubmissionWhereInput = { AND: [this.scope(r), { status: q.status }] };
    const [rows, total] = await Promise.all([
      this.prisma.submission.findMany({
        where, orderBy: { submittedAt: q.status === 'SUBMITTED' ? 'asc' : 'desc' }, skip: q.skip, take: q.take, // oldest first: fair turnaround
        include: { assignment: { select: { skill: true, dueAt: true, contentItem: { select: { title: true } } } }, student: { select: { firstName: true, lastName: true } }, enrollment: { select: { batch: { select: { name: true } } } } },
      }),
      this.prisma.submission.count({ where }),
    ]);
    return {
      total,
      items: rows.map((s) => ({
        id: s.id, title: s.assignment.contentItem.title, skill: s.assignment.skill, status: s.status, submittedAt: s.submittedAt, late: s.late,
        wordCount: s.wordCount, student: `${s.student.firstName} ${s.student.lastName}`, batch: s.enrollment?.batch.name ?? null, finalBand: s.finalBand === null ? null : Number(s.finalBand),
      })),
    };
  }

  async detail(r: Reviewer, id: string) {
    const s = await this.prisma.submission.findFirst({ where: { AND: [this.scope(r), { id, status: { not: 'DRAFT' } }] }, include: this.detailInclude() });
    if (!s) throw notFound('Submission');
    return this.present(s, false);
  }

  private async present(s: Prisma.SubmissionGetPayload<{ include: ReturnType<GradingService['detailInclude']> }>, forStudent: boolean) {
    const rubric = s.assignment.rubric;
    const feedback = s.feedback.map((f) => ({
      id: f.id, createdAt: f.createdAt, comment: f.comment, finalBand: f.finalBand === null ? null : Number(f.finalBand),
      scores: f.rubricScores.sort((a, b) => a.criterion.sequence - b.criterion.sequence).map((x) => ({ criterionId: x.criterionId, criterion: x.criterion.name, score: Number(x.score), comment: x.comment })),
    }));
    return {
      id: s.id, status: s.status, revision: s.revision, submittedAt: s.submittedAt, late: s.late, wordCount: s.wordCount, body: s.body,
      audioUrl: s.fileKey ? await this.storage.signedUrl(s.fileKey, 600) : null, finalBand: s.finalBand === null ? null : Number(s.finalBand), gradedAt: s.gradedAt,
      assignment: { id: s.assignment.id, title: s.assignment.contentItem.title, skill: s.assignment.skill, instructions: s.assignment.instructions, minWords: s.assignment.minWords },
      rubric: rubric ? { id: rubric.id, name: rubric.name, criteria: rubric.criteria.map((c) => ({ id: c.id, name: c.name })) } : null,
      student: forStudent ? undefined : { name: `${s.student.firstName} ${s.student.lastName}`, currentBand: s.student.currentBand === null ? null : Number(s.student.currentBand), targetBand: s.student.targetBand === null ? null : Number(s.student.targetBand), ielts: ieltsSummary(s.student) },
      feedback, // newest first; older gradings are kept as history
    };
  }

  /**
   * Grades (or regrades) a submission. Optimistic locking on `revision` stops two mentors grading the same
   * submission at once; every grading is stored as new immutable rows, so history is never lost.
   */
  async grade(r: Reviewer, id: string, input: GradeInput, actor: Actor) {
    const info = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await tx.submission.findFirst({
        where: { AND: [this.scope(r), { id, status: { in: ['SUBMITTED', 'GRADED'] } }] },
        include: { assignment: { include: { rubric: { include: { criteria: true } }, contentItem: { select: { title: true } } } }, student: { select: { userId: true } } },
      });
      if (!s) throw notFound('Submission');
      if (s.revision !== input.revision) throw new AppError('CONFLICT', 409, 'This submission was graded by someone else. Reload to see their grade.', { revision: s.revision });

      const criteria = s.assignment.rubric?.criteria ?? [];
      if (criteria.length === 0) throw invalid('rubric', 'This task has no rubric.');
      const given = new Map(input.scores.map((x) => [x.criterionId, x]));
      if (given.size !== input.scores.length) throw invalid('scores', 'Each criterion can only be scored once.');
      const missing = criteria.filter((c) => !given.has(c.id));
      if (missing.length || input.scores.some((x) => !criteria.find((c) => c.id === x.criterionId))) throw invalid('scores', `Score every criterion: ${criteria.map((c) => c.name).join(', ')}.`);

      const band = roundIeltsBand(input.scores.map((x) => x.score))!;
      const fb = await tx.submissionFeedback.create({ data: { submissionId: id, mentorId: r.userId, comment: input.comment, finalBand: band } });
      await tx.rubricScore.createMany({ data: input.scores.map((x) => ({ submissionId: id, feedbackId: fb.id, criterionId: x.criterionId, score: x.score, comment: x.comment, gradedBy: r.userId })) });
      const before = { status: s.status, finalBand: s.finalBand === null ? null : Number(s.finalBand) };
      await tx.submission.update({ where: { id }, data: { status: 'GRADED', finalBand: band, gradedAt: new Date(), revision: { increment: 1 } } });
      await tx.studentTimelineEvent.create({ data: { studentId: s.studentId, type: 'SUBMISSION_GRADED', summary: `${s.assignment.contentItem.title} graded: Band ${band.toFixed(1)}`, meta: { submissionId: id } } });
      await this.audit.record({ ...actor, action: s.status === 'GRADED' ? 'MENTOR_CHANGED_GRADE' : 'MENTOR_GRADED_SUBMISSION', entityType: 'Submission', entityId: id, before, after: { finalBand: band, scores: input.scores.map((x) => x.score) } }, tx);
      return { studentUserId: s.student.userId, title: s.assignment.contentItem.title, band };
    });
    await this.notify.notifyUser(info.studentUserId, 'SUBMISSION_GRADED', 'Your work has been graded', `“${info.title}”: Band ${info.band.toFixed(1)}. Open it to read your mentor’s feedback.`, {
      email: true, entityType: 'SUBMISSION', entityId: id, link: `/student/submissions/${id}`,
    });
    // The draft is only a working copy. The final grade is the record, so the draft goes now.
    await this.prisma.gradingDraft.deleteMany({ where: { submissionId: id } }).catch(() => undefined);
    return this.detail(r, id);
  }
}

import { ScopeService } from '../common/scope.service';
import { DEFAULT_GRADING_TARGET_HOURS } from '../analytics/thresholds';
import { SettingsService } from '../settings/settings.service';
import { BandService } from '../analytics/band.service';
import { overseesAllBatches } from '../common/scope';
import { Inject, Injectable } from '@nestjs/common';
import { BatchStatus, EnrollmentStatus, Prisma } from '@ielts/db';
import * as argon2 from 'argon2';
import type { AssignMentorInput, CreateBatchInput, CreateMentorInput, UpdateBatchInput } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../auth/tokens';
import { removeAccount } from '../admin/account-removal';
import { AppError, conflict, forbidden, notFound } from '../common/app-error';
import { ieltsSummary } from '../common/ielts';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { MailService } from '../integrations/mail.service';
import { StorageService } from '../integrations/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';
import { getMainCourse } from '../courses/main-course';
import type { Actor } from '../courses/courses.service';

/** Allowed manual status transitions. There is no "full" state: batches have no size limit. */
export const BATCH_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['DRAFT', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
};

const LIVE: EnrollmentStatus[] = ['PENDING_PAYMENT', 'ACTIVE', 'PAUSED'];
const bad = (field: string, msg: string) => new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { [field]: msg });

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly settings: SettingsService,
    private readonly bands: BandService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly ctx: UserContextService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ───────── batches ─────────
  /** Headcount per batch: applications waiting for verification vs students who are enrolled. */
  private async counts(batchIds: string[]) {
    if (batchIds.length === 0) return new Map<string, { pending: number; enrolled: number }>();
    const rows = await this.prisma.enrollment.groupBy({ by: ['batchId', 'status'], where: { batchId: { in: batchIds }, deletedAt: null }, _count: true });
    const map = new Map<string, { pending: number; enrolled: number }>();
    for (const r of rows) {
      const c = map.get(r.batchId) ?? { pending: 0, enrolled: 0 };
      if (r.status === 'PENDING_PAYMENT') c.pending += r._count;
      else if (['ACTIVE', 'PAUSED', 'COMPLETED'].includes(r.status)) c.enrolled += r._count;
      map.set(r.batchId, c);
    }
    return map;
  }

  async list(filter: { status?: BatchStatus; scope?: 'active' | 'upcoming' | 'completed' }) {
    const now = new Date();
    const where: Prisma.BatchWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.scope === 'active') where.status = { in: ['OPEN', 'IN_PROGRESS'] };
    if (filter.scope === 'upcoming') Object.assign(where, { startAt: { gt: now }, status: { in: ['DRAFT', 'OPEN'] } });
    if (filter.scope === 'completed') where.status = { in: ['COMPLETED', 'ARCHIVED', 'CANCELLED'] };

    const batches = await this.prisma.batch.findMany({
      where,
      orderBy: { startAt: 'desc' },
      include: {
        course: { select: { title: true, code: true } },
        version: { select: { versionNumber: true } },
        mentors: { include: { mentor: { select: { id: true, displayName: true } } } },
      },
    });
    const counts = await this.counts(batches.map((b) => b.id));
    return batches.map((b) => ({ ...b, mentorAssigned: b.mentors.length > 0, counts: counts.get(b.id) ?? { pending: 0, enrolled: 0 } }));
  }

  async get(id: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: { select: { id: true, title: true, code: true } },
        version: { select: { id: true, versionNumber: true, status: true } },
        mentors: { include: { mentor: { select: { id: true, displayName: true } } } },
      },
    });
    if (!batch) throw notFound('Batch');
    const counts = await this.counts([id]);
    return { ...batch, mentorAssigned: batch.mentors.length > 0, counts: counts.get(id) ?? { pending: 0, enrolled: 0 } };
  }

  /** New batches always belong to the academy's one course. Mentors are optional and can be added any time. */
  async create(input: CreateBatchInput, actor: Actor) {
    const { course, version: newest } = await getMainCourse(this.prisma);
    const version = input.courseVersionId
      ? await this.prisma.courseVersion.findFirst({ where: { id: input.courseVersionId, courseId: course.id } })
      : newest;
    if (!version) throw bad('courseVersionId', 'Publish the course content before creating a batch.');
    if (version.status !== 'PUBLISHED') throw bad('courseVersionId', 'Only a published version can be used for a batch.');

    if (input.mentors?.length) {
      const found = await this.prisma.mentorProfile.count({ where: { id: { in: input.mentors.map((m) => m.mentorId) }, status: 'ACTIVE' } });
      if (found !== new Set(input.mentors.map((m) => m.mentorId)).size) throw bad('mentors', 'One of the selected teachers was not found.');
    }
    this.assertDates(input);
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.create({
        data: {
          courseId: course.id, courseVersionId: version.id, name: input.name, description: input.description,
          startAt: new Date(input.startAt), endAt: input.endAt ? new Date(input.endAt) : null,
          timezone: input.timezone, days: input.days, classTime: input.classTime, deliveryMode: input.deliveryMode,
          enrollmentOpenAt: input.enrollmentOpenAt ? new Date(input.enrollmentOpenAt) : null,
          enrollmentCloseAt: input.enrollmentCloseAt ? new Date(input.enrollmentCloseAt) : null,
        },
      });
      if (input.mentors?.length) {
        const unique = new Map(input.mentors.map((m) => [`${m.mentorId}:${m.mentorRole}`, m]));
        await tx.batchMentor.createMany({ data: [...unique.values()].map((m) => ({ batchId: batch.id, mentorId: m.mentorId, mentorRole: m.mentorRole })) });
      }
      await this.audit.record({ ...actor, action: 'ADMIN_CREATED_BATCH', entityType: 'Batch', entityId: batch.id, after: { ...batch, mentors: input.mentors ?? [] } }, tx);
      return batch;
    });
  }

  async update(id: string, input: UpdateBatchInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.batch.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound('Batch');

      this.assertDates({
        startAt: input.startAt ?? before.startAt.toISOString(),
        endAt: input.endAt ?? before.endAt?.toISOString(),
        enrollmentOpenAt: input.enrollmentOpenAt ?? before.enrollmentOpenAt?.toISOString(),
        enrollmentCloseAt: input.enrollmentCloseAt ?? before.enrollmentCloseAt?.toISOString(),
      });

      if (input.courseVersionId && input.courseVersionId !== before.courseVersionId) {
        const enrolled = await tx.enrollment.count({ where: { batchId: id, deletedAt: null } });
        if (enrolled) throw conflict('CONFLICT', 'Cannot change the course version of a batch that already has enrollments.');
        const v = await tx.courseVersion.findFirst({ where: { id: input.courseVersionId, courseId: before.courseId, status: 'PUBLISHED' } });
        if (!v) throw bad('courseVersionId', 'Must be a published version of this course.');
      }
      const status = input.status;
      if (status && status !== before.status && !BATCH_TRANSITIONS[before.status].includes(status)) {
        throw new AppError('CONFLICT', 409, `A batch cannot move from ${before.status} to ${status}.`);
      }

      const { status: _s, startAt, endAt, enrollmentOpenAt, enrollmentCloseAt, ...rest } = input;
      const after = await tx.batch.update({
        where: { id },
        data: {
          ...rest,
          ...(status ? { status } : {}),
          ...(startAt ? { startAt: new Date(startAt) } : {}),
          ...(endAt ? { endAt: new Date(endAt) } : {}),
          ...(enrollmentOpenAt ? { enrollmentOpenAt: new Date(enrollmentOpenAt) } : {}),
          ...(enrollmentCloseAt ? { enrollmentCloseAt: new Date(enrollmentCloseAt) } : {}),
        },
      });
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_BATCH', entityType: 'Batch', entityId: id, before, after }, tx);
      return after;
    });
  }

  /**
   * Remove a batch. A batch that never had students is deleted (soft); one with history is archived so
   * records and reports stay intact; one that still has live students must be emptied first.
   */
  async remove(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id, deletedAt: null } });
      if (!batch) throw notFound('Batch');
      const live = await tx.enrollment.count({ where: { batchId: id, deletedAt: null, status: { in: LIVE } } });
      if (live) throw conflict('CONFLICT', `This batch still has ${live} student(s) or pending application(s). Transfer or resolve them first.`);
      const history = await tx.enrollment.count({ where: { batchId: id, deletedAt: null } });
      if (history) {
        await tx.batch.update({ where: { id }, data: { status: 'ARCHIVED' } });
      } else {
        await tx.batch.update({ where: { id }, data: { deletedAt: new Date() } });
      }
      await this.audit.record({ ...actor, action: 'ADMIN_REMOVED_BATCH', entityType: 'Batch', entityId: id, before: batch, after: { archived: history > 0 } }, tx);
      return { deleted: history === 0, archived: history > 0 };
    });
  }

  private assertDates(d: { startAt?: string; endAt?: string; enrollmentOpenAt?: string; enrollmentCloseAt?: string }) {
    const t = (v?: string) => (v ? new Date(v).getTime() : undefined);
    if (t(d.endAt) !== undefined && t(d.startAt) !== undefined && t(d.endAt)! < t(d.startAt)!) throw bad('endAt', 'End must not be before start.');
    if (t(d.enrollmentOpenAt) !== undefined && t(d.enrollmentCloseAt) !== undefined && t(d.enrollmentCloseAt)! <= t(d.enrollmentOpenAt)!) {
      throw bad('enrollmentCloseAt', 'Enrollment must close after it opens.');
    }
  }

  // ───────── mentor assignment ─────────
  async assignMentor(batchId: string, input: AssignMentorInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const [batch, mentor] = await Promise.all([
        tx.batch.findFirst({ where: { id: batchId, deletedAt: null } }),
        tx.mentorProfile.findUnique({ where: { id: input.mentorId } }),
      ]);
      if (!batch) throw notFound('Batch');
      if (!mentor || mentor.status !== 'ACTIVE') throw notFound('Mentor');
      const existing = await tx.batchMentor.findUnique({
        where: { batchId_mentorId_mentorRole: { batchId, mentorId: input.mentorId, mentorRole: input.mentorRole } },
      });
      if (existing) throw conflict('CONFLICT', 'This mentor already has that role on the batch.');
      const row = await tx.batchMentor.create({ data: { batchId, mentorId: input.mentorId, mentorRole: input.mentorRole } });
      await this.audit.record({ ...actor, action: 'ADMIN_ASSIGNED_MENTOR', entityType: 'Batch', entityId: batchId, after: row }, tx);
      return row;
    });
  }

  async unassignMentor(batchId: string, mentorId: string, role: 'MAIN' | 'WRITING' | 'SPEAKING', actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const key = { batchId_mentorId_mentorRole: { batchId, mentorId, mentorRole: role } };
      const before = await tx.batchMentor.findUnique({ where: key });
      if (!before) throw notFound('Mentor assignment');
      await tx.batchMentor.delete({ where: key });
      await this.audit.record({ ...actor, action: 'ADMIN_UNASSIGNED_MENTOR', entityType: 'Batch', entityId: batchId, before }, tx);
    });
  }

  // ───────── mentors ─────────
  listMentors() {
    return this.prisma.mentorProfile.findMany({
      where: { status: { not: 'REMOVED' } },
      orderBy: { displayName: 'asc' },
      include: { user: { select: { email: true, status: true } }, _count: { select: { batches: true } } },
    });
  }

  async removeMentor(mentorId: string, actor: Actor, actorEmail: string) {
    const profile = await this.prisma.mentorProfile.findUnique({ where: { id: mentorId }, select: { userId: true } });
    if (!profile) throw notFound('Teacher');
    const result = await this.prisma.$transaction((tx) => removeAccount(tx, this.audit, {
      targetUserId: profile.userId, actor, actorEmail, ownerEmail: this.config.OWNER_EMAIL, mustBeTeacher: true,
    }));
    this.ctx.invalidate(profile.userId);
    return result;
  }

  /** An approved teacher applicant already has a verified account from applying: this adds the mentor role to it. */
  async attachMentorRole(
    user: { id: string; email: string; status: string; emailVerifiedAt: Date | null },
    profile: { displayName: string; bio?: string; specializations: string[] },
    actor: Actor,
    applicationId: string,
  ) {
    if (!user.emailVerifiedAt || user.status !== 'ACTIVE') throw new AppError('CONFLICT', 409, 'This applicant has not verified their email yet.');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: 'MENTOR' } });
    const mentor = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.createMany({ data: [{ userId: user.id, roleId: role.id }], skipDuplicates: true });
      const created = await tx.mentorProfile.create({
        data: { userId: user.id, displayName: profile.displayName, bio: profile.bio, specializations: profile.specializations, applicationId },
      });
      await this.audit.record({ ...actor, action: 'ADMIN_GRANTED_MENTOR_ROLE', entityType: 'User', entityId: user.id, after: { displayName: profile.displayName, applicationId } }, tx);
      return created;
    });
    await this.mail.send(user.email, 'Your teaching application was approved', `<p>Hello ${profile.displayName}, your application to teach with us was approved. Log in with your existing account to open your teacher portal: <a href="${this.config.APP_URL}/login">${this.config.APP_URL}/login</a></p>`);
    return mentor;
  }

  async createMentor(input: CreateMentorInput, actor: Actor, applicationId?: string) {
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new AppError('EMAIL_ALREADY_REGISTERED', 409, 'An account with this email already exists.');

    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: 'MENTOR' } });
    const passwordHash = await argon2.hash(input.password ?? randomToken(24), { type: argon2.argon2id });
    const resetToken = randomToken();

    const mentor = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(),
          roles: { create: { roleId: role.id } },
          mentor: { create: { displayName: input.displayName, bio: input.bio, specializations: input.specializations, applicationId } },
        },
        include: { mentor: true },
      });
      // Long-lived reset link doubles as the "set your password" invitation.
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(resetToken), expiresAt: new Date(Date.now() + 7 * 24 * 3600_000) },
      });
      await this.audit.record({ ...actor, action: 'ADMIN_CREATED_MENTOR', entityType: 'User', entityId: user.id, after: { email: user.email, displayName: input.displayName } }, tx);
      return user.mentor!;
    });

    const link = `${this.config.APP_URL}/reset-password?token=${resetToken}`;
    await this.mail.send(input.email, 'You have been added as a mentor', `<p>Hello ${input.displayName}, your mentor account is ready. Set your password here (valid 7 days):</p><p><a href="${link}">${link}</a></p>`);
    return mentor;
  }

  /** Teacher profile detail: the mentor record plus its linked application (if any) and the application's children. */
  async mentorDetail(mentorId: string) {
    const mentor = await this.prisma.mentorProfile.findUnique({
      where: { id: mentorId },
      include: {
        user: { select: { id: true, email: true, phone: true, status: true, createdAt: true, lastLoginAt: true } },
        batches: { include: { batch: { select: { id: true, name: true, status: true } } } },
        application: {
          include: {
            educations: true, experiences: true, certifications: true, references: true,
            documents: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
    if (!mentor) throw notFound('Mentor');
    const application = mentor.application
      ? {
          ...mentor.application,
          documents: await Promise.all(mentor.application.documents.map(async (d) => ({ ...d, fileUrl: await this.storage.signedUrl(d.fileKey, 300) }))),
        }
      : null;
    return { ...mentor, application };
  }

  // ───────── teacher portal (scoped to assigned batches) ─────────
  /** Teachers only reach batches they are assigned to; academic admins may oversee any. */
  private async assertBatchAccess(batchId: string, user: { mentorId?: string; permissions: Set<string> }) {
    await this.scope.assertBatch({ mentorId: user.mentorId ?? null, permissions: user.permissions }, batchId);
  }

  async mentorBatches(mentorId: string) {
    const rows = await this.prisma.batchMentor.findMany({
      where: { mentorId, batch: { deletedAt: null } },
      include: { batch: { include: { course: { select: { title: true } } } } },
      orderBy: { batch: { startAt: 'desc' } },
    });
    const counts = await this.counts(rows.map((r) => r.batchId));
    return rows.map((r) => ({ ...r.batch, myRole: r.mentorRole, courseTitle: r.batch.course.title, studentCount: counts.get(r.batchId)?.enrolled ?? 0 }));
  }

  async batchStudents(batchId: string, user: { mentorId?: string; permissions: Set<string> }) {
    await this.assertBatchAccess(batchId, user);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { batchId, deletedAt: null, status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] } },
      include: { student: { select: { id: true, firstName: true, lastName: true, currentBand: true, targetBand: true } } },
      orderBy: { enrolledAt: 'asc' },
    });
    return enrollments.map((e) => ({
      enrollmentId: e.id, status: e.status, progressPercent: e.progressPercent, enrolledAt: e.enrolledAt, student: e.student,
    }));
  }

  /** Per-student results for a batch: latest and best band per skill (tests and graded work) and the last mock score. */
  async batchResults(batchId: string, user: { mentorId?: string; permissions: Set<string> }) {
    await this.assertBatchAccess(batchId, user);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { batchId, deletedAt: null, status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] } },
      select: {
        studentId: true, progressPercent: true,
        student: {
          select: {
            firstName: true, lastName: true, targetBand: true,
            ieltsHistory: true, ieltsOverall: true, ieltsListening: true, ieltsReading: true, ieltsWriting: true, ieltsSpeaking: true, ieltsTestDate: true, ieltsAttempts: true,
          },
        },
      },
      orderBy: { enrolledAt: 'asc' },
    });
    const ids = enrollments.map((e) => e.studentId);
    // Band numbers come from the same engine as the student's own view, so the two screens cannot disagree.
    const [estimates, attempts] = ids.length ? await Promise.all([
      this.bands.forCohort(ids),
      this.prisma.assessmentAttempt.findMany({
        where: { studentId: { in: ids }, status: { notIn: ['IN_PROGRESS', 'NOT_STARTED', 'INVALIDATED'] } },
        orderBy: { submittedAt: 'asc' }, select: { studentId: true, bandScore: true, percent: true, submittedAt: true, assessment: { select: { skill: true, type: true, title: true } } },
      }),
    ]) : [new Map(), []];

    return enrollments.map((e) => {
      const est = estimates.get(e.studentId);
      const skills = Object.fromEntries((["LISTENING", "READING", "WRITING", "SPEAKING"] as const).map((k) => {
        const s = est?.skills[k];
        return [k, { latest: s?.latest ?? null, best: s?.best ?? null, estimated: s?.estimated ?? null, previous: s?.previous ?? null, trend: s?.trend ?? "INSUFFICIENT_DATA", pointCount: s?.pointCount ?? 0 }];
      }));
      const mocks = attempts.filter((x) => x.studentId === e.studentId && x.assessment.type === 'MOCK');
      const lastMock = mocks[mocks.length - 1];
      return {
        studentId: e.studentId, name: `${e.student.firstName} ${e.student.lastName}`, targetBand: e.student.targetBand === null ? null : Number(e.student.targetBand),
        ielts: ieltsSummary(e.student),
        progressPercent: Number(e.progressPercent), skills,
        overall: est?.overall ?? null, overallStatus: est?.overallStatus ?? "INSUFFICIENT_DATA", missingSkills: est?.missingSkills ?? [],
        lastMock: lastMock ? { title: lastMock.assessment.title, percent: lastMock.percent === null ? null : Number(lastMock.percent), at: lastMock.submittedAt } : null,
      };
    });
  }

  /** Numbers for the teacher's home page. */
  async teacherDashboard(mentorId: string) {
    const assignments = await this.prisma.batchMentor.findMany({ where: { mentorId, batch: { deletedAt: null } }, select: { batchId: true, mentorRole: true } });
    const batchIds = [...new Set(assignments.map((a) => a.batchId))];
    const roleFor = (skill: 'WRITING' | 'SPEAKING') => assignments.filter((a) => a.mentorRole === 'MAIN' || a.mentorRole === skill).map((a) => a.batchId);
    const [students, sessions, toGradeWriting, toGradeSpeaking, activeBatches] = await Promise.all([
      this.prisma.enrollment.count({ where: { batchId: { in: batchIds }, deletedAt: null, status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] } } }),
      this.prisma.liveSession.findMany({ where: { batchId: { in: batchIds }, endsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' }, take: 5, select: { id: true, topic: true, startsAt: true, batch: { select: { id: true, name: true } } } }),
      this.prisma.submission.count({ where: { status: 'SUBMITTED', assignment: { skill: 'WRITING' }, enrollment: { batchId: { in: roleFor('WRITING') } } } }),
      this.prisma.submission.count({ where: { status: 'SUBMITTED', assignment: { skill: 'SPEAKING' }, enrollment: { batchId: { in: roleFor('SPEAKING') } } } }),
      this.prisma.batch.count({ where: { id: { in: batchIds }, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    ]);
    const workload = await this.teacherWorkload(batchIds, roleFor);
    return { batches: batchIds.length, activeBatches, students, toGrade: toGradeWriting + toGradeSpeaking, upcomingSessions: sessions, ...workload };
  }

  /**
   * Grading turnaround and attendance hygiene for the teacher's own batches. Informational:
   * nothing here penalises a teacher, and the target comes from settings.
   */
  private async teacherWorkload(batchIds: string[], roleFor: (skill: 'WRITING' | 'SPEAKING') => string[]) {
    if (batchIds.length === 0) return { gradingTargetHours: DEFAULT_GRADING_TARGET_HOURS, grading: { waiting: 0, oldestWaitingHours: null, overTarget: 0, medianTurnaroundHours: null }, unmarkedSessions: 0 };
    const target = Number(await this.settings.get('analytics.grading.target_hours')) || DEFAULT_GRADING_TARGET_HOURS;
    const now = Date.now();
    const scope = { OR: [{ assignment: { skill: 'WRITING' }, enrollment: { batchId: { in: roleFor('WRITING') } } }, { assignment: { skill: 'SPEAKING' }, enrollment: { batchId: { in: roleFor('SPEAKING') } } }] };
    const [waiting, graded, sessions] = await Promise.all([
      this.prisma.submission.findMany({ where: { status: 'SUBMITTED', ...scope }, select: { submittedAt: true }, orderBy: { submittedAt: 'asc' }, take: 500 }),
      this.prisma.submission.findMany({ where: { status: 'GRADED', gradedAt: { gte: new Date(now - 30 * 86_400_000) }, ...scope }, select: { submittedAt: true, gradedAt: true }, take: 500 }),
      this.prisma.liveSession.findMany({ where: { batchId: { in: batchIds }, endsAt: { lt: new Date(now), gte: new Date(now - 30 * 86_400_000) } }, select: { id: true, _count: { select: { attendance: true } } } }),
    ]);
    const oldest = waiting[0]?.submittedAt.getTime();
    const hours = graded.filter((g) => g.gradedAt).map((g) => (g.gradedAt!.getTime() - g.submittedAt.getTime()) / 3_600_000).sort((a, b) => a - b);
    const median = hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null;
    return {
      gradingTargetHours: target,
      grading: {
        waiting: waiting.length,
        oldestWaitingHours: oldest === undefined ? null : Math.round((now - oldest) / 3_600_000),
        overTarget: waiting.filter((w) => now - w.submittedAt.getTime() > target * 3_600_000).length,
        medianTurnaroundHours: median,
      },
      unmarkedSessions: sessions.filter((s) => s._count.attendance === 0).length,
    };
  }

  invalidateUser(userId: string) { this.ctx.invalidate(userId); }
}

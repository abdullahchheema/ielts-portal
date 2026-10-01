import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { randomUUID } from 'node:crypto';
import type { RejectTeacherApplicationInput, TeacherApplicationAdminUpdateInput, TeacherApplicationInput } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { BatchesService } from '../batches/batches.service';
import { AppError, notFound } from '../common/app-error';
import { Actor } from '../courses/courses.service';
import { sniffFileType, StorageService } from '../integrations/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const DOCUMENT_KINDS = ['CNIC', 'CV', 'DEGREE', 'CERTIFICATE', 'OTHER'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const STATUS_SETS = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const;
export type TeacherApplicationStatusFilter = (typeof STATUS_SETS)[number];

/** Splits a validated teacher application payload into its scalar fields and its child-record arrays. */
function splitApplicationInput(input: TeacherApplicationInput) {
  const { educations, experiences, certifications, references, dateOfBirth, joiningDate, ...scalars } = input;
  return {
    scalars,
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
    joiningDate: joiningDate ? new Date(joiningDate) : undefined,
    educations: educations ?? [],
    experiences: (experiences ?? []).map((e) => ({ ...e, startDate: e.startDate ? new Date(e.startDate) : undefined, endDate: e.endDate ? new Date(e.endDate) : undefined })),
    certifications: (certifications ?? []).map((c) => ({ ...c, issuedAt: c.issuedAt ? new Date(c.issuedAt) : undefined, expiresAt: c.expiresAt ? new Date(c.expiresAt) : undefined })),
    references: references ?? [],
  };
}

@Injectable()
export class TeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    private readonly batches: BatchesService,
  ) {}

  // ───────── public ─────────
  /** A prospective teacher submits their application. No account is created — only the application record. */
  async apply(input: TeacherApplicationInput) {
    const { scalars, dateOfBirth, joiningDate, educations, experiences, certifications, references } = splitApplicationInput(input);
    const app = await this.prisma.teacherApplication.create({
      data: {
        ...scalars,
        dateOfBirth, joiningDate,
        educations: { create: educations },
        experiences: { create: experiences },
        certifications: { create: certifications },
        references: { create: references },
      },
    });
    await this.notify.notifyPermission('teacher.manage', 'TEACHER_APPLICATION', 'New teacher application', `${app.fullName} applied to teach.`, {
      entityType: 'TEACHER_APPLICATION', entityId: app.id, link: `/admin/applications?tab=teachers&open=${app.id}`,
    });
    return { id: app.id, status: app.status };
  }

  /** One supporting document per call; the applicant has no account, so the application id scopes access. */
  async addDocument(applicationId: string, kind: DocumentKind, file: { buffer: Buffer; size: number } | undefined, label?: string) {
    const app = await this.prisma.teacherApplication.findUnique({ where: { id: applicationId }, select: { id: true } });
    if (!app) throw notFound('Application');
    if (!file) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { file: 'Attach a file.' });
    if (file.size > MAX_DOCUMENT_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The file is larger than 8 MB.');
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed || !ALLOWED_DOCUMENT_MIME.has(sniffed.mime)) throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only JPG, PNG, WebP or PDF files are accepted.');
    const fileKey = `teachers/applications/${applicationId}/${randomUUID()}.${sniffed.ext}`;
    await this.storage.put(fileKey, file.buffer, sniffed.mime);
    return this.prisma.teacherDocument.create({ data: { applicationId, kind, label, fileKey, fileMime: sniffed.mime } });
  }

  // ───────── admin ─────────
  async adminList(status: TeacherApplicationStatusFilter) {
    const where: Prisma.TeacherApplicationWhereInput = status === 'ALL' ? {} : { status };
    const [items, total, pending, approved, rejected] = await Promise.all([
      this.prisma.teacherApplication.findMany({
        where, orderBy: { submittedAt: status === 'PENDING' ? 'asc' : 'desc' }, take: 200,
        select: { id: true, fullName: true, email: true, phone: true, city: true, status: true, subjects: true, submittedAt: true, reviewedAt: true },
      }),
      this.prisma.teacherApplication.count({ where }),
      this.prisma.teacherApplication.count({ where: { status: 'PENDING' } }),
      this.prisma.teacherApplication.count({ where: { status: 'APPROVED' } }),
      this.prisma.teacherApplication.count({ where: { status: 'REJECTED' } }),
    ]);
    return { total, counts: { pending, approved, rejected }, items };
  }

  async adminDetail(id: string) {
    const app = await this.prisma.teacherApplication.findUnique({
      where: { id },
      include: {
        educations: true, experiences: true, certifications: true, references: true,
        documents: { orderBy: { createdAt: 'desc' } },
        mentor: { select: { id: true, userId: true, status: true } },
      },
    });
    if (!app) throw notFound('Application');
    return { ...app, documents: await Promise.all(app.documents.map(async (d) => ({ ...d, fileUrl: await this.storage.signedUrl(d.fileKey, 300) }))) };
  }

  /** Admin edits any scalar field of the application (child records — education/experience/etc. — are managed separately). */
  async adminUpdate(id: string, input: TeacherApplicationAdminUpdateInput, actor: Actor) {
    const before = await this.prisma.teacherApplication.findUnique({ where: { id } });
    if (!before) throw notFound('Application');
    const { dateOfBirth, joiningDate, ...rest } = input;
    const after = await this.prisma.teacherApplication.update({
      where: { id },
      data: {
        ...rest,
        ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null } : {}),
        ...(joiningDate !== undefined ? { joiningDate: joiningDate ? new Date(joiningDate) : null } : {}),
      },
    });
    await this.audit.record({ ...actor, action: 'ADMIN_UPDATED_TEACHER_APPLICATION', entityType: 'TeacherApplication', entityId: id, before: { status: before.status }, after: { status: after.status } });
    return after;
  }

  /** Approves the application: creates the mentor account (User + MentorProfile linked via applicationId) and emails an invitation. */
  async approve(id: string, actor: Actor) {
    const app = await this.prisma.teacherApplication.findUnique({ where: { id } });
    if (!app) throw notFound('Application');
    if (app.status !== 'PENDING') throw new AppError('CONFLICT', 409, 'This application has already been reviewed.');

    const mentor = await this.batches.createMentor(
      { email: app.email, displayName: app.fullName, bio: app.personalStatement ?? undefined, specializations: app.subjects, password: undefined },
      actor,
      app.id,
    );
    const claimed = await this.prisma.teacherApplication.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedBy: actor.userId, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new AppError('CONFLICT', 409, 'This application has already been reviewed.');
    await this.audit.record({ ...actor, action: 'ADMIN_APPROVED_TEACHER_APPLICATION', entityType: 'TeacherApplication', entityId: id, before: { status: 'PENDING' }, after: { status: 'APPROVED', mentorId: mentor.id } });
    return { ok: true, status: 'APPROVED', mentorId: mentor.id };
  }

  async reject(id: string, input: RejectTeacherApplicationInput, actor: Actor) {
    const claimed = await this.prisma.teacherApplication.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectionReason: input.reason, reviewedBy: actor.userId, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new AppError('CONFLICT', 409, 'This application has already been reviewed.');
    await this.audit.record({ ...actor, action: 'ADMIN_REJECTED_TEACHER_APPLICATION', entityType: 'TeacherApplication', entityId: id, after: { reason: input.reason } });
    return { ok: true };
  }

  /** Admin creates a teacher directly: the application is recorded as already APPROVED, alongside the mentor account. */
  async createDirect(input: TeacherApplicationInput, actor: Actor) {
    const { scalars, dateOfBirth, joiningDate, educations, experiences, certifications, references } = splitApplicationInput(input);
    const exists = await this.prisma.user.findUnique({ where: { email: scalars.email } });
    if (exists) throw new AppError('EMAIL_ALREADY_REGISTERED', 409, 'An account with this email already exists.');

    const app = await this.prisma.teacherApplication.create({
      data: {
        ...scalars, dateOfBirth, joiningDate, status: 'APPROVED', reviewedBy: actor.userId, reviewedAt: new Date(),
        educations: { create: educations }, experiences: { create: experiences }, certifications: { create: certifications }, references: { create: references },
      },
    });
    const mentor = await this.batches.createMentor(
      { email: app.email, displayName: app.fullName, bio: app.personalStatement ?? undefined, specializations: app.subjects, password: undefined },
      actor,
      app.id,
    );
    await this.audit.record({ ...actor, action: 'ADMIN_CREATED_TEACHER', entityType: 'TeacherApplication', entityId: app.id, after: { email: app.email, mentorId: mentor.id } });
    return { id: app.id, mentorId: mentor.id };
  }
}

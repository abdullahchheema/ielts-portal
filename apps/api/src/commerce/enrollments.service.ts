import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { EnrollmentStatus, Prisma } from '@ielts/db';
import type { ManualEnrollmentInput } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, notFound } from '../common/app-error';
import { Actor } from '../courses/courses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ENROLLMENT_ACTIVATED, EnrollmentActivatedEvent } from './events';

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Enrolls a student without online checkout (bank deal, scholarship, corporate, migration...). */
  async manualEnroll(input: ManualEnrollmentInput, actor: Actor) {
    let ev: EnrollmentActivatedEvent;
    const enrollment = await this.prisma.$transaction(async (tx) => {
      const student = await tx.studentProfile.findFirst({
        where: input.studentId ? { id: input.studentId } : { user: { email: input.studentEmail, deletedAt: null } },
        include: { user: { select: { id: true, status: true } } },
      });
      if (!student) throw notFound('Student');
      if (student.user.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 409, 'This student account is not active.');

      const batch = await tx.batch.findFirst({ where: { id: input.batchId, deletedAt: null }, include: { course: true } });
      if (!batch) throw notFound('Batch');
      if (['CANCELLED', 'COMPLETED', 'ARCHIVED'].includes(batch.status)) throw new AppError('BATCH_NOT_OPEN', 409, `This batch is ${batch.status.toLowerCase()}.`);

      const live = await tx.enrollment.findFirst({ where: { studentId: student.id, batchId: batch.id, deletedAt: null, status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'PAUSED'] } } });
      if (live) {
        throw new AppError('ENROLLMENT_ALREADY_EXISTS', 409, live.status === 'PENDING_PAYMENT'
          ? 'This student has a pending application for this batch — verify their payment instead.' : 'This student is already enrolled in this batch.');
      }

      const now = new Date();
      const base = batch.startAt > now ? batch.startAt : now;
      const days = input.accessDays ?? batch.course.defaultAccessDays;
      const created = await tx.enrollment.create({
        data: {
          studentId: student.id, courseId: batch.courseId, courseVersionId: batch.courseVersionId, batchId: batch.id,
          status: 'ACTIVE', source: input.source, enrolledAt: now, accessStartsAt: now, accessEndsAt: new Date(base.getTime() + days * 86_400_000),
        },
      });
      await tx.studentTimelineEvent.create({ data: { studentId: student.id, type: 'ENROLLED', summary: `Enrolled in ${batch.course.title} (${batch.name}) by staff — ${input.source}`, meta: { enrollmentId: created.id } } });
      await this.audit.record({ ...actor, action: 'ADMIN_CREATED_ENROLLMENT', entityType: 'Enrollment', entityId: created.id, after: { ...created, reason: input.reason } }, tx);
      ev = { enrollmentId: created.id, studentId: student.id, userId: student.user.id, source: input.source };
      return created;
    }, { maxWait: 10_000, timeout: 20_000 });

    this.events.emit(ENROLLMENT_ACTIVATED, ev!);
    return enrollment;
  }

  list(status?: EnrollmentStatus) {
    const where: Prisma.EnrollmentWhereInput = { deletedAt: null, ...(status ? { status } : {}) };
    return this.prisma.enrollment.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
        course: { select: { title: true } },
        batch: { select: { id: true, name: true } },
      },
    });
  }

  listOrders(status?: string) {
    return this.prisma.order.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' }, take: 200,
      include: {
        student: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
        payments: { select: { id: true, status: true, provider: true } },
        items: { select: { batch: { select: { name: true, course: { select: { title: true } } } } } },
      },
    });
  }

  @OnEvent(ENROLLMENT_ACTIVATED)
  async onActivated(ev: EnrollmentActivatedEvent) {
    await this.notify.notifyUser(ev.userId, 'ENROLLMENT_CONFIRMED', 'You are enrolled!', 'Your enrollment is active. Open your dashboard to start learning.', {
      email: true, entityType: 'ENROLLMENT', entityId: ev.enrollmentId, link: `/student/application?open=${ev.enrollmentId}`,
    });
  }
}

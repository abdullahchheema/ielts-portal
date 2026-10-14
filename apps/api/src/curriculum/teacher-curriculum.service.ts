import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@ielts/db';
import { CurriculumAssignmentInput, curriculumAssignmentSchema } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { CoursesModule } from '../courses/courses.module';
import { CoursesService } from '../courses/courses.service';
import { getMainCourse } from '../courses/main-course';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

export interface Reviewer { userId: string; mentorId?: string; canOverseeAll: boolean }

@Injectable()
export class TeacherCurriculumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  /** Mentors act only on batches they are assigned to; academic admins (batch.create) on any. */
  private async assertBatch(r: Reviewer, batchId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) throw notFound('Batch');
    if (r.canOverseeAll) return batch;
    const ok = r.mentorId ? await this.prisma.batchMentor.count({ where: { batchId, mentorId: r.mentorId } }) : 0;
    if (!ok) throw forbidden('You are not assigned to this batch.');
    return batch;
  }

  /** Browse the live master curriculum (the one course's newest published version), for teachers to pick what to assign. */
  async browse() {
    const { version } = await getMainCourse(this.prisma);
    if (!version) throw notFound('Published course version');
    return this.courses.tree(version.id);
  }

  async assign(r: Reviewer, input: CurriculumAssignmentInput, actor: Actor) {
    const item = await this.prisma.contentItem.findUnique({ where: { id: input.contentItemId } });
    if (!item) throw notFound('Content item');
    if (!item.teacherAssignable) throw new AppError('VALIDATION_ERROR', 422, 'This item cannot be assigned by a teacher.', { contentItemId: 'not teacher-assignable' });

    if (input.batchId) await this.assertBatch(r, input.batchId);
    let studentIds = input.studentIds ?? [];
    if (studentIds.length) {
      // Every named student must be an active enrollment the reviewer is authorised to see — in the given batch if one
      // was named, or in any batch the reviewer can oversee otherwise.
      const where: Prisma.EnrollmentWhereInput = input.batchId
        ? { studentId: { in: studentIds }, batchId: input.batchId, status: { in: ['ACTIVE', 'COMPLETED'] }, deletedAt: null }
        : { studentId: { in: studentIds }, status: { in: ['ACTIVE', 'COMPLETED'] }, deletedAt: null, batch: r.canOverseeAll ? {} : { mentors: { some: { mentorId: r.mentorId } } } };
      const found = await this.prisma.enrollment.findMany({ where, select: { studentId: true, batchId: true } });
      const foundIds = new Set(found.map((e) => e.studentId));
      const missing = studentIds.filter((id) => !foundIds.has(id));
      if (missing.length) throw forbidden('One or more students are not in a batch you are authorised to assign to.');
      if (!r.canOverseeAll) for (const e of found) await this.assertBatch(r, e.batchId);
    }

    const rows = input.batchId && !studentIds.length
      ? [{ batchId: input.batchId, studentId: undefined }]
      : studentIds.map((studentId) => ({ batchId: input.batchId, studentId }));

    const created = await this.prisma.$transaction(async (tx) => {
      const out = [];
      for (const target of rows) {
        const row = await tx.curriculumAssignment.create({
          data: {
            contentItemId: input.contentItemId, batchId: target.batchId, studentId: target.studentId, assignedBy: actor.userId,
            requirement: input.requirement, classification: input.classification, sessionId: input.sessionId, dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
            instructions: input.instructions, publishedAt: input.publish ? new Date() : null,
          },
        });
        out.push(row);
      }
      await this.audit.record({ ...actor, action: 'CURRICULUM_ASSIGNED', entityType: 'CurriculumAssignment', entityId: out[0]?.id, after: { contentItemId: input.contentItemId, batchId: input.batchId, studentCount: studentIds.length } }, tx);
      return out;
    });

    if (input.publish) {
      const studentUserIds = studentIds.length
        ? (await this.prisma.studentProfile.findMany({ where: { id: { in: studentIds } }, select: { userId: true } })).map((s) => s.userId)
        : input.batchId
          ? (await this.prisma.enrollment.findMany({ where: { batchId: input.batchId, status: 'ACTIVE', deletedAt: null }, select: { student: { select: { userId: true } } } })).map((e) => e.student.userId)
          : [];
      for (const userId of studentUserIds) {
        await this.notify.notifyUser(userId, 'CURRICULUM_ASSIGNED', 'New activity assigned', `${item.title} has been assigned to you.`, {
          entityType: 'ContentItem', entityId: item.id, link: '/student/today',
        });
      }
    }
    return created;
  }

  async listForBatch(r: Reviewer, batchId: string) {
    await this.assertBatch(r, batchId);
    const rows = await this.prisma.curriculumAssignment.findMany({
      where: { batchId }, orderBy: { createdAt: 'desc' },
      include: { contentItem: { select: { id: true, title: true, module: true, estimatedMinutes: true } } },
    });
    const studentCount = await this.prisma.enrollment.count({ where: { batchId, status: { in: ['ACTIVE', 'COMPLETED'] }, deletedAt: null } });
    const withCompletion = await Promise.all(rows.map(async (a) => {
      const completed = await this.prisma.contentProgress.count({ where: { contentItemId: a.contentItemId, status: 'COMPLETED', enrollment: { batchId } } });
      return { ...a, completedCount: completed, studentCount };
    }));
    return withCompletion;
  }

  async remove(r: Reviewer, id: string, actor: Actor) {
    const a = await this.prisma.curriculumAssignment.findUnique({ where: { id } });
    if (!a) throw notFound('Curriculum assignment');
    if (a.batchId) await this.assertBatch(r, a.batchId);
    else if (!r.canOverseeAll) throw forbidden('You are not authorised to remove this assignment.');
    await this.prisma.$transaction(async (tx) => {
      await tx.curriculumAssignment.delete({ where: { id } });
      await this.audit.record({ ...actor, action: 'CURRICULUM_ASSIGNMENT_REMOVED', entityType: 'CurriculumAssignment', entityId: id, before: a }, tx);
    });
  }
}

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller()
export class TeacherCurriculumController {
  constructor(private readonly svc: TeacherCurriculumService, private readonly ctx: UserContextService) {}

  private async rev(u: AuthUser): Promise<Reviewer> {
    const c = (await this.ctx.get(u.id))!;
    return { userId: u.id, mentorId: u.mentorId, canOverseeAll: c.permissions.has('batch.create') };
  }

  @RequirePermission('curriculum.assign') @Get('mentor/curriculum')
  browse() { return this.svc.browse(); }

  @RequirePermission('curriculum.assign') @HttpCode(201) @Post('mentor/curriculum-assignments')
  async assign(@Body(new ZodPipe(curriculumAssignmentSchema)) body: CurriculumAssignmentInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.assign(await this.rev(u), body, actor(u, req));
  }

  @RequirePermission('curriculum.assign') @Get('mentor/batches/:id/curriculum-assignments')
  async listForBatch(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.svc.listForBatch(await this.rev(u), id); }

  @RequirePermission('curriculum.assign') @HttpCode(204) @Delete('mentor/curriculum-assignments/:id')
  async remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { await this.svc.remove(await this.rev(u), id, actor(u, req)); }
}

@Module({ imports: [CoursesModule], controllers: [TeacherCurriculumController], providers: [TeacherCurriculumService], exports: [TeacherCurriculumService] })
export class TeacherCurriculumModule {}

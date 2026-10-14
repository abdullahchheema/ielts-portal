import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurriculumAssignmentInput, curriculumAssignmentSchema } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ScopeService } from '../common/scope.service';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { CoursesModule } from '../courses/courses.module';
import { CoursesService } from '../courses/courses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

export interface Reviewer { userId: string; mentorId?: string; canOverseeAll: boolean }
const sid = (u: AuthUser) => {
  if (!u.studentId) throw forbidden('Only student accounts can do this.');
  return u.studentId;
};

/**
 * A teacher assigns one piece of the shared course content to a batch they teach, or to a named
 * student in that batch — distinct from `Assignment`, which is a single global fixture on a
 * ContentItem that applies to every enrolled student. Read-side for students lives here too.
 */
@Injectable()
export class CurriculumAssignmentsService {
  constructor(
    private readonly prisma: PrismaService, private readonly courses: CoursesService,
    private readonly audit: AuditService, private readonly notify: NotificationsService, private readonly scope: ScopeService,
  ) {}

  /** The shared content library, scoped to one batch's actual (published) course version. */
  async browse(r: Reviewer, batchId: string) {
    await this.scope.assertBatch(r, batchId);
    const batch = await this.prisma.batch.findUniqueOrThrow({ where: { id: batchId }, select: { courseVersionId: true } });
    return this.courses.tree(batch.courseVersionId);
  }

  private async assertStudentInBatch(r: Reviewer, studentId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, orderBy: { createdAt: 'desc' }, select: { batchId: true },
    });
    if (!enrollment) throw notFound('Student enrollment');
    await this.scope.assertBatch(r, enrollment.batchId);
    return enrollment.batchId;
  }

  async assign(r: Reviewer, input: CurriculumAssignmentInput, actor: Actor) {
    const item = await this.prisma.contentItem.findUnique({ where: { id: input.contentItemId }, select: { id: true, title: true } });
    if (!item) throw notFound('Content item');
    let batchId: string;
    if (input.batchId) { await this.scope.assertBatch(r, input.batchId); batchId = input.batchId; }
    else batchId = await this.assertStudentInBatch(r, input.studentId!);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.curriculumAssignment.create({
        data: {
          contentItemId: input.contentItemId, batchId: input.batchId, studentId: input.studentId,
          requirement: input.requirement, dueAt: input.dueAt ? new Date(input.dueAt) : null, instructions: input.instructions, assignedById: actor.userId,
        },
      });
      await this.audit.record({ userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent, action: 'CURRICULUM_ASSIGNED', entityType: 'CurriculumAssignment', entityId: created.id, after: { contentItemId: input.contentItemId, batchId: input.batchId, studentId: input.studentId } }, tx);
      return created;
    });

    const students = input.studentId
      ? [await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: input.studentId }, select: { userId: true } })]
      : (await this.prisma.enrollment.findMany({ where: { batchId, status: 'ACTIVE', deletedAt: null }, select: { student: { select: { userId: true } } } })).map((e) => e.student);
    for (const s of students) {
      await this.notify.notifyUser(s.userId, 'CURRICULUM_ASSIGNED', 'New assignment from your teacher', `${item.title} has been assigned to you${input.dueAt ? `, due ${new Date(input.dueAt).toLocaleDateString()}` : ''}.`, {
        entityType: 'CurriculumAssignment', entityId: row.id, link: '/student/today',
      });
    }
    return row;
  }

  async listForBatch(r: Reviewer, batchId: string) {
    await this.scope.assertBatch(r, batchId);
    return this.prisma.curriculumAssignment.findMany({
      where: { OR: [{ batchId }, { student: { enrollments: { some: { batchId, deletedAt: null } } } }] },
      orderBy: { createdAt: 'desc' },
      include: { contentItem: { select: { title: true, contentType: true } }, student: { select: { firstName: true, lastName: true } } },
    });
  }

  async remove(r: Reviewer, id: string, actor: Actor) {
    const row = await this.prisma.curriculumAssignment.findUnique({ where: { id } });
    if (!row) throw notFound('Curriculum assignment');
    const batchId = row.batchId ?? (await this.prisma.enrollment.findFirst({ where: { studentId: row.studentId!, deletedAt: null }, select: { batchId: true } }))?.batchId;
    if (batchId) await this.scope.assertBatch(r, batchId);
    else if (!r.canOverseeAll) throw forbidden('You are not authorised to remove this assignment.');
    await this.prisma.$transaction(async (tx) => {
      await tx.curriculumAssignment.delete({ where: { id } });
      await this.audit.record({ userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent, action: 'CURRICULUM_ASSIGNMENT_REMOVED', entityType: 'CurriculumAssignment', entityId: id, before: row }, tx);
    });
  }

  // ───────── student read side ─────────
  async listMine(studentId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, orderBy: { createdAt: 'desc' }, select: { batchId: true } });
    return this.prisma.curriculumAssignment.findMany({
      where: { OR: [{ studentId }, ...(enrollment ? [{ batchId: enrollment.batchId }] : [])] },
      orderBy: { createdAt: 'desc' },
      include: { contentItem: { select: { id: true, title: true, contentType: true, estimatedMinutes: true, sectionId: true } } },
    });
  }
}

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller()
export class CurriculumAssignmentsController {
  constructor(private readonly assignments: CurriculumAssignmentsService, private readonly ctx: UserContextService) {}

  private async rev(u: AuthUser): Promise<Reviewer> {
    const c = (await this.ctx.get(u.id))!;
    return { userId: u.id, mentorId: u.mentorId, canOverseeAll: c.permissions.has('batch.create') };
  }

  @RequirePermission('curriculum.assign') @Get('mentor/batches/:id/curriculum')
  async browse(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.assignments.browse(await this.rev(u), id); }

  @RequirePermission('curriculum.assign') @HttpCode(201) @Post('mentor/curriculum-assignments')
  async assign(@Body(new ZodPipe(curriculumAssignmentSchema)) body: CurriculumAssignmentInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.assignments.assign(await this.rev(u), body, actor(u, req));
  }

  @RequirePermission('curriculum.assign') @Get('mentor/batches/:id/curriculum-assignments')
  async listForBatch(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.assignments.listForBatch(await this.rev(u), id); }

  @RequirePermission('curriculum.assign') @HttpCode(204) @Delete('mentor/curriculum-assignments/:id')
  async remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { await this.assignments.remove(await this.rev(u), id, actor(u, req)); }

  @Get('me/curriculum-assignments')
  listMine(@CurrentUser() u: AuthUser) { return this.assignments.listMine(sid(u)); }
}

@Module({
  imports: [CoursesModule],
  controllers: [CurriculumAssignmentsController],
  providers: [CurriculumAssignmentsService],
  exports: [CurriculumAssignmentsService],
})
export class CurriculumAssignmentsModule {}

import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

const uuid = new ParseUUIDPipe();

/** The permission needed to see or write notes about each kind of record. Teachers have no entry and see nothing. */
const TARGET_PERMISSION: Record<string, string> = {
  STUDENT: 'student.view',
  TEACHER: 'teacher.manage',
  BATCH: 'batch.view',
  APPLICATION: 'enrollment.view',
  PAYMENT: 'payment.view',
  TICKET: 'ticket.manage',
};
/** The audience group of a note. A note is seen only by someone who holds this group's permission. */
const VISIBILITY_PERMISSION: Record<string, string> = {
  ALL_STAFF: 'dashboard.view',
  ACADEMIC: 'report.academic.view',
  FINANCE: 'report.finance.view',
  SUPPORT: 'ticket.manage',
};

const createSchema = z.object({
  targetType: z.enum(['STUDENT', 'TEACHER', 'BATCH', 'APPLICATION', 'PAYMENT', 'TICKET']),
  targetId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
  visibility: z.enum(['ALL_STAFF', 'ACADEMIC', 'FINANCE', 'SUPPORT']).default('ALL_STAFF'),
  pinned: z.boolean().default(false),
});
const updateSchema = z.object({ body: z.string().trim().min(1).max(4000).optional(), pinned: z.boolean().optional(), visibility: z.enum(['ALL_STAFF', 'ACADEMIC', 'FINANCE', 'SUPPORT']).optional() });
const listQuery = z.object({ targetType: z.enum(['STUDENT', 'TEACHER', 'BATCH', 'APPLICATION', 'PAYMENT', 'TICKET']), targetId: z.string().uuid() });

type Perms = Set<string>;
const can = (perms: Perms, key: string) => perms.has(key);

/** Notes are staff-only. Each note needs the target's permission and its audience group's permission to be seen. */
@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private assertTarget(perms: Perms, targetType: string) {
    const need = TARGET_PERMISSION[targetType];
    if (!need || !can(perms, need)) throw forbidden('You do not have access to notes for this record.');
  }

  private visibleTo(perms: Perms, visibility: string) {
    const need = VISIBILITY_PERMISSION[visibility];
    return !!need && can(perms, need);
  }

  async list(perms: Perms, targetType: string, targetId: string) {
    this.assertTarget(perms, targetType);
    const rows = await this.prisma.internalNote.findMany({
      where: { targetType, targetId, deletedAt: null }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 200,
      select: { id: true, body: true, visibility: true, pinned: true, createdAt: true, updatedAt: true, author: { select: { email: true } } },
    });
    return rows.filter((n) => this.visibleTo(perms, n.visibility));
  }

  async create(userId: string, perms: Perms, input: z.infer<typeof createSchema>, meta: { ip?: string; userAgent?: string }) {
    this.assertTarget(perms, input.targetType);
    if (!this.visibleTo(perms, input.visibility)) throw forbidden('You cannot write a note for that audience.');
    const note = await this.prisma.internalNote.create({
      data: { targetType: input.targetType, targetId: input.targetId, authorId: userId, body: input.body, visibility: input.visibility, pinned: input.pinned },
      select: { id: true, createdAt: true },
    });
    await this.audit.record({ userId, ...meta, action: 'STAFF_ADDED_NOTE', entityType: 'InternalNote', entityId: note.id, after: { targetType: input.targetType, visibility: input.visibility } });
    return note;
  }

  /** Only the author can edit their note. Every edit records before and after, so nothing is changed silently. */
  async update(userId: string, perms: Perms, id: string, input: z.infer<typeof updateSchema>, meta: { ip?: string; userAgent?: string }) {
    const before = await this.prisma.internalNote.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Note');
    this.assertTarget(perms, before.targetType);
    if (before.authorId !== userId) throw forbidden('Only the author can edit this note.');
    if (input.visibility && !this.visibleTo(perms, input.visibility)) throw forbidden('You cannot write a note for that audience.');
    const after = await this.prisma.internalNote.update({ where: { id }, data: { body: input.body, pinned: input.pinned, visibility: input.visibility } });
    await this.audit.record({ userId, ...meta, action: 'STAFF_CHANGED_NOTE', entityType: 'InternalNote', entityId: id, before: { body: before.body, visibility: before.visibility, pinned: before.pinned }, after: { body: after.body, visibility: after.visibility, pinned: after.pinned } });
    return { id, updatedAt: after.updatedAt };
  }

  /** Soft delete. The record stays for the audit trail. */
  async remove(userId: string, perms: Perms, id: string, meta: { ip?: string; userAgent?: string }) {
    const n = await this.prisma.internalNote.findFirst({ where: { id, deletedAt: null } });
    if (!n) throw notFound('Note');
    this.assertTarget(perms, n.targetType);
    if (n.authorId !== userId && !can(perms, 'admin.manage')) throw forbidden('Only the author or a super admin can delete this note.');
    await this.prisma.internalNote.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ userId, ...meta, action: 'STAFF_DELETED_NOTE', entityType: 'InternalNote', entityId: id, before: { targetType: n.targetType, targetId: n.targetId } });
    return { ok: true };
  }
}

@Controller('admin/notes')
export class NotesController {
  constructor(private readonly notes: NotesService, private readonly ctx: UserContextService) {}

  private async perms(u: AuthUser): Promise<Perms> { return (await this.ctx.get(u.id))!.permissions; }

  @RequirePermission('dashboard.view') @Get()
  async list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>, @CurrentUser() u: AuthUser) {
    return this.notes.list(await this.perms(u), q.targetType, q.targetId);
  }

  @RequirePermission('dashboard.view') @Post()
  async create(@Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.notes.create(u.id, await this.perms(u), body, clientMeta(req));
  }

  @RequirePermission('dashboard.view') @Patch(':id')
  async update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.notes.update(u.id, await this.perms(u), id, body, clientMeta(req));
  }

  @RequirePermission('dashboard.view') @HttpCode(200) @Delete(':id')
  async remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.notes.remove(u.id, await this.perms(u), id, clientMeta(req));
  }
}

@Module({ controllers: [NotesController], providers: [NotesService], exports: [NotesService] })
export class NotesModule {}

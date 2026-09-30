import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  StaffTicketMessageInput, TicketCreateInput, TicketMessageInput, TicketUpdateInput,
  staffTicketMessageSchema, ticketCreateSchema, ticketMessageSchema, ticketUpdateSchema,
} from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor } from '../courses/courses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotificationsService) {}

  // ───────── student ─────────
  async create(userId: string, input: TicketCreateInput) {
    const t = await this.prisma.supportTicket.create({ data: { studentId: userId, category: input.category, subject: input.subject, description: input.description, priority: input.priority } });
    await this.notify.notifyPermission('ticket.manage', 'TICKET_OPENED', 'New support ticket', `${input.category}: ${input.subject}`);
    return t;
  }

  listMine(userId: string) {
    return this.prisma.supportTicket.findMany({ where: { studentId: userId }, orderBy: { createdAt: 'desc' }, select: { id: true, subject: true, category: true, status: true, createdAt: true, resolvedAt: true } });
  }

  async getMine(userId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, studentId: userId }, include: { messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } } } });
    if (!t) throw notFound('Ticket');
    return t;
  }

  async replyAsStudent(userId: string, id: string, input: TicketMessageInput) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, studentId: userId } });
    if (!t) throw notFound('Ticket');
    if (t.status === 'CLOSED') throw new AppError('CONFLICT', 409, 'This ticket is closed. Please open a new one.');
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { ticketId: id, authorId: userId, body: input.body } });
      if (t.status === 'WAITING_FOR_STUDENT' || t.status === 'RESOLVED') await tx.supportTicket.update({ where: { id }, data: { status: 'OPEN', resolvedAt: null } });
    });
    await this.notify.notifyPermission('ticket.manage', 'TICKET_REPLY', 'Student replied to a ticket', t.subject);
    return { ok: true };
  }

  // ───────── staff ─────────
  async list(q: { status?: string; assignedTo?: string; skip: number; take: number }) {
    const where = { ...(q.status ? { status: q.status as never } : {}), ...(q.assignedTo ? { assignedTo: q.assignedTo } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: q.skip, take: q.take, include: { user: { select: { email: true, student: { select: { firstName: true, lastName: true } } } }, _count: { select: { messages: true } } } }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { total, items: items.map((t) => ({ id: t.id, subject: t.subject, category: t.category, priority: t.priority, status: t.status, assignedTo: t.assignedTo, createdAt: t.createdAt, student: t.user.student ? `${t.user.student.firstName} ${t.user.student.lastName}` : t.user.email, email: t.user.email, messages: t._count.messages })) };
  }

  /** Staff view: full conversation incl. internal notes, plus limited enrolment context (no private mentor feedback). */
  async get(id: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } }, user: { select: { email: true, status: true, student: { select: { id: true, firstName: true, lastName: true, enrollments: { where: { deletedAt: null }, select: { status: true, course: { select: { title: true } }, batch: { select: { name: true } } } } } } } } } });
    if (!t) throw notFound('Ticket');
    return t;
  }

  async update(id: string, input: TicketUpdateInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supportTicket.findUnique({ where: { id } });
      if (!before) throw notFound('Ticket');
      const after = await tx.supportTicket.update({
        where: { id },
        data: { ...input, ...(input.status === 'RESOLVED' || input.status === 'CLOSED' ? { resolvedAt: before.resolvedAt ?? new Date() } : input.status ? { resolvedAt: null } : {}) },
      });
      await this.audit.record({ ...actor, action: 'TICKET_UPDATED', entityType: 'SupportTicket', entityId: id, before: { status: before.status, assignedTo: before.assignedTo }, after: { status: after.status, assignedTo: after.assignedTo } }, tx);
      return after;
    });
  }

  async replyAsStaff(id: string, input: StaffTicketMessageInput, actor: Actor) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw notFound('Ticket');
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { ticketId: id, authorId: actor.userId, body: input.body, internal: input.internal } });
      if (!input.internal && (t.status === 'OPEN' || t.status === 'IN_PROGRESS')) await tx.supportTicket.update({ where: { id }, data: { status: 'WAITING_FOR_STUDENT' } });
    });
    if (!input.internal) await this.notify.notifyUser(t.studentId, 'TICKET_REPLY', `Support replied: ${t.subject}`, input.body.slice(0, 500), { email: true });
    return { ok: true };
  }
}

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });
const listQuery = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_FOR_STUDENT', 'RESOLVED', 'CLOSED']).optional(),
  assignedTo: z.string().uuid().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(25),
});
const studentOnly = (u: AuthUser) => { if (!u.studentId) throw forbidden('Only student accounts can do this.'); return u.id; };

@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('me/tickets')
  create(@Body(new ZodPipe(ticketCreateSchema)) body: TicketCreateInput, @CurrentUser() u: AuthUser) { return this.support.create(studentOnly(u), body); }

  @Get('me/tickets')
  mine(@CurrentUser() u: AuthUser) { return this.support.listMine(studentOnly(u)); }

  @Get('me/tickets/:id')
  one(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.support.getMine(studentOnly(u), id); }

  @HttpCode(200) @Post('me/tickets/:id/messages')
  reply(@Param('id', uuid) id: string, @Body(new ZodPipe(ticketMessageSchema)) body: TicketMessageInput, @CurrentUser() u: AuthUser) { return this.support.replyAsStudent(studentOnly(u), id, body); }

  @RequirePermission('ticket.manage') @Get('admin/tickets')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.support.list(q); }

  @RequirePermission('ticket.manage') @Get('admin/tickets/:id')
  get(@Param('id', uuid) id: string) { return this.support.get(id); }

  @RequirePermission('ticket.manage') @Patch('admin/tickets/:id')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(ticketUpdateSchema)) body: TicketUpdateInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.support.update(id, body, actor(u, req)); }

  @RequirePermission('ticket.manage') @HttpCode(200) @Post('admin/tickets/:id/messages')
  staffReply(@Param('id', uuid) id: string, @Body(new ZodPipe(staffTicketMessageSchema)) body: StaffTicketMessageInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.support.replyAsStaff(id, body, actor(u, req)); }
}

@Module({ controllers: [SupportController], providers: [SupportService] })
export class SupportModule {}

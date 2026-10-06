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
import { leastLoaded, roleFor, slaDueAt } from './routing';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotificationsService) {}

  // ───────── student ─────────
  /**
   * Opens a ticket with its SLA clock, then routes it to the least-loaded member of the team for its category.
   * If nobody on that team is active, the ticket stays open and everyone with ticket access is told, as before.
   */
  async create(userId: string, input: TicketCreateInput) {
    const createdAt = new Date();
    const t = await this.prisma.supportTicket.create({
      data: { studentId: userId, category: input.category, subject: input.subject, description: input.description, priority: input.priority, slaDueAt: slaDueAt(createdAt, input.priority) },
    });
    const assigned = await this.autoAssign(t.id, input.category, input.subject);
    if (!assigned) {
      await this.notify.notifyPermission('ticket.manage', 'TICKET_OPENED', 'New support ticket', `${input.category}: ${input.subject}`, {
        entityType: 'TICKET', entityId: t.id, link: `/admin/tickets/${t.id}`,
      });
    }
    return { ...t, assignedTo: assigned };
  }

  /** Chooses the team member with the fewest open tickets for the category's role, assigns, and tells them. */
  private async autoAssign(ticketId: string, category: string, subject: string): Promise<string | null> {
    const role = roleFor(category);
    const people = await this.prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE', roles: { some: { role: { name: role } } } },
      select: { id: true },
      take: 200,
    });
    // Open tickets per candidate, counted from the ticket table (assigned_to carries no foreign key).
    const loads = await this.prisma.supportTicket.groupBy({
      by: ['assignedTo'],
      where: { assignedTo: { in: people.map((p) => p.id) }, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_STUDENT'] } },
      _count: { _all: true },
    });
    const open = new Map(loads.map((l) => [l.assignedTo ?? '', l._count._all]));
    const pick = leastLoaded(people.map((p) => ({ id: p.id, open: open.get(p.id) ?? 0 })));
    if (!pick) return null;
    const r = await this.prisma.supportTicket.updateMany({ where: { id: ticketId, status: 'OPEN' }, data: { assignedTo: pick, status: 'ASSIGNED' } });
    if (r.count === 0) return null;
    await this.notify.notifyUser(pick, 'SUPPORT_TICKET_UPDATED', 'A support ticket was assigned to you', subject, { entityType: 'TICKET', entityId: ticketId, link: `/admin/tickets/${ticketId}` });
    return pick;
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
    await this.notify.notifyPermission('ticket.manage', 'TICKET_REPLY', 'Student replied to a ticket', t.subject, {
      entityType: 'TICKET', entityId: id, link: `/admin/tickets/${id}`,
    });
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
      if (!input.internal && (t.status === 'OPEN' || t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS')) await tx.supportTicket.update({ where: { id }, data: { status: 'WAITING_FOR_STUDENT' } });
    });
    if (!input.internal) await this.notify.notifyUser(t.studentId, 'TICKET_REPLY', `Support replied: ${t.subject}`, input.body.slice(0, 500), {
      email: true, entityType: 'TICKET', entityId: id, link: `/student/support/${id}`,
    });
    return { ok: true };
  }
}

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });
const listQuery = z.object({
  status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_STUDENT', 'RESOLVED', 'CLOSED']).optional(),
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

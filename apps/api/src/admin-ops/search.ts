import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

const query = z.object({ q: z.string().trim().min(2).max(80), take: z.coerce.number().int().min(1).max(10).default(5) });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SearchItem { id: string; label: string; sub?: string; href: string }
export interface SearchSection { type: string; items: SearchItem[] }

/**
 * Global search. A section appears only when the caller holds its permission, so a role never learns a kind of
 * record exists. Teachers see students and batches only within their own batches; anything else is simply not
 * found, so existence is not leaked. Matches use indexed lower-case comparisons.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(u: { id: string; mentorId?: string; permissions: Set<string>; canOverseeAll: boolean }, q: string, take: number): Promise<SearchSection[]> {
    const p = u.permissions;
    const term = q.trim().toLowerCase();
    const like = { contains: term, mode: 'insensitive' as const };
    const mentorBatches = u.mentorId && !u.canOverseeAll
      ? (await this.prisma.batchMentor.findMany({ where: { mentorId: u.mentorId }, select: { batchId: true } })).map((b) => b.batchId)
      : null;
    const sections: Promise<SearchSection | null>[] = [];

    const teacherOrStaffStudents = p.has('student.view') || (mentorBatches !== null && p.has('teaching.view'));
    if (teacherOrStaffStudents) {
      sections.push(this.prisma.studentProfile.findMany({
        where: {
          OR: [{ firstName: like }, { lastName: like }, { user: { email: like } }, { user: { phone: like } }],
          ...(mentorBatches !== null ? { enrollments: { some: { batchId: { in: mentorBatches }, deletedAt: null } } } : {}),
        },
        take, select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } },
      }).then((rows) => ({ type: 'Students', items: rows.map((r) => ({ id: r.id, label: `${r.firstName} ${r.lastName}`.trim(), sub: r.user.email, href: `/admin/students/${r.id}` })) })));
    }

    if (p.has('batch.view') || (mentorBatches !== null && p.has('teaching.view'))) {
      sections.push(this.prisma.batch.findMany({
        where: { deletedAt: null, name: like, ...(mentorBatches !== null ? { id: { in: mentorBatches } } : {}) },
        take, select: { id: true, name: true, status: true },
      }).then((rows) => ({ type: 'Batches', items: rows.map((b) => ({ id: b.id, label: b.name, sub: b.status, href: `/admin/batches/${b.id}` })) })));
    }

    if (p.has('teacher.manage') && mentorBatches === null) {
      sections.push(this.prisma.mentorProfile.findMany({
        where: { displayName: like }, take, select: { id: true, displayName: true, user: { select: { email: true } } },
      }).then((rows) => ({ type: 'Teachers', items: rows.map((t) => ({ id: t.id, label: t.displayName, sub: t.user.email, href: `/admin/teachers` })) })));
    }

    if (p.has('enrollment.view') && mentorBatches === null) {
      const orders = await this.prisma.order.findMany({ where: { reference: { equals: q.trim(), mode: 'insensitive' } }, take, select: { id: true, reference: true, status: true } });
      const byId = UUID_RE.test(q.trim()) ? await this.prisma.order.findMany({ where: { id: q.trim() }, take: 1, select: { id: true, reference: true, status: true } }) : [];
      const merged = [...orders, ...byId.filter((b) => !orders.some((o) => o.id === b.id))];
      sections.push(Promise.resolve({ type: 'Applications & orders', items: merged.map((o) => ({ id: o.id, label: o.reference, sub: o.status, href: `/admin/orders?open=${o.id}` })) }));
    }

    if (p.has('payment.view') && mentorBatches === null) {
      sections.push(this.prisma.paymentProof.findMany({
        where: { bankTxnReference: { equals: q.trim(), mode: 'insensitive' } }, take,
        select: { id: true, status: true, bankTxnReference: true, payment: { select: { order: { select: { reference: true } } } } },
      }).then((rows) => ({ type: 'Payments', items: rows.map((r) => ({ id: r.id, label: r.bankTxnReference, sub: `${r.payment.order.reference} · ${r.status}`, href: `/admin/applications?proof=${r.id}` })) })));
    }

    if (p.has('student.view') && mentorBatches === null) {
      sections.push(this.prisma.certificate.findMany({
        where: { code: { equals: q.trim(), mode: 'insensitive' } }, take, select: { id: true, code: true, studentName: true, courseTitle: true },
      }).then((rows) => ({ type: 'Certificates', items: rows.map((c) => ({ id: c.id, label: c.code, sub: `${c.studentName} · ${c.courseTitle}`, href: `/verify/${c.code}` })) })));
    }

    if (p.has('ticket.manage') && mentorBatches === null) {
      const where: Prisma.SupportTicketWhereInput = UUID_RE.test(q.trim()) ? { id: q.trim() } : { subject: like };
      sections.push(this.prisma.supportTicket.findMany({ where, take, select: { id: true, subject: true, status: true } })
        .then((rows) => ({ type: 'Support tickets', items: rows.map((t) => ({ id: t.id, label: t.subject, sub: t.status, href: `/admin/tickets/${t.id}` })) })));
    }

    if (p.has('content.manage') && mentorBatches === null) {
      sections.push(this.prisma.assignment.findMany({
        where: { contentItem: { title: like } }, take, select: { id: true, skill: true, contentItem: { select: { title: true } } },
      }).then((rows) => ({ type: 'Assignments', items: rows.map((a) => ({ id: a.id, label: a.contentItem.title, sub: a.skill, href: `/admin/course` })) })));
    }

    const resolved = (await Promise.all(sections)).filter((s): s is SearchSection => !!s && s.items.length > 0);
    return resolved.map((s) => ({ ...s, items: s.items.slice(0, take) }));
  }
}

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService, private readonly ctx: UserContextService) {}

  @Get()
  async run(@Query(new ZodPipe(query)) q: z.infer<typeof query>, @CurrentUser() u: AuthUser) {
    const c = (await this.ctx.get(u.id))!;
    return this.search.search({ id: u.id, mentorId: u.mentorId, permissions: c.permissions, canOverseeAll: c.permissions.has('batch.create') }, q.q, q.take);
  }
}

@Module({ controllers: [SearchController], providers: [SearchService], exports: [SearchService] })
export class SearchModule {}

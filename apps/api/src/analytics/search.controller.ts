import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { UserContextService } from '../roles/user-context.service';
import { PrismaService } from '../prisma/prisma.service';

const searchQuery = z.object({ q: z.string().trim().min(2).max(80), take: z.coerce.number().int().min(1).max(10).default(5) });

/**
 * Global search. Each section is returned only when the caller holds that section's permission;
 * otherwise it is null. A role never learns that a section exists beyond the null.
 */
@Controller('admin/search')
export class AdminSearchController {
  constructor(private readonly prisma: PrismaService, private readonly ctx: UserContextService) {}

  @RequirePermission('dashboard.view')
  @Get()
  async search(@CurrentUser() u: AuthUser, @Query(new ZodPipe(searchQuery)) q: z.infer<typeof searchQuery>) {
    const perms = (await this.ctx.get(u.id))!.permissions;
    const contains = { contains: q.q, mode: 'insensitive' as const };
    const [students, batches] = await Promise.all([
      perms.has('student.view')
        ? this.prisma.studentProfile.findMany({
          where: { OR: [{ firstName: contains }, { lastName: contains }, { user: { email: contains } }] },
          take: q.take, select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } },
        })
        : Promise.resolve(null),
      perms.has('batch.view')
        ? this.prisma.batch.findMany({ where: { name: contains, deletedAt: null }, take: q.take, select: { id: true, name: true, status: true } })
        : Promise.resolve(null),
    ]);
    return {
      students: students?.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), email: s.user.email, href: `/admin/students/${s.id}` })) ?? null,
      batches: batches?.map((b) => ({ id: b.id, name: b.name, status: b.status, href: `/admin/batches/${b.id}` })) ?? null,
    };
  }
}

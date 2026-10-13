import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { forbidden } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

const sid = (u: AuthUser) => {
  if (!u.studentId) throw forbidden('Only student accounts can do this.');
  return u.studentId;
};

/**
 * Grammar tracker (spec §25): read-only here — issues are written only from teacher-reviewed
 * writing submissions (wired into the grading flow), never auto-detected or invented. An empty
 * list is a true empty state, not a placeholder.
 */
@Injectable()
export class GrammarService {
  constructor(private readonly prisma: PrismaService) {}

  async list(studentId: string) {
    const rows = await this.prisma.grammarIssue.findMany({
      where: { studentId }, orderBy: { createdAt: 'desc' },
      include: { submission: { select: { id: true, assignmentId: true } } },
    });
    const byCategory = new Map<string, typeof rows>();
    for (const r of rows) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    return {
      total: rows.length,
      categories: [...byCategory.entries()].map(([category, issues]) => ({
        category, count: issues.length, resolvedCount: issues.filter((i) => i.resolvedAt).length,
        recent: issues.slice(0, 5).map((i) => ({ id: i.id, excerpt: i.excerpt, note: i.note, submissionId: i.submissionId, resolvedAt: i.resolvedAt, createdAt: i.createdAt })),
      })),
    };
  }
}

@Controller('me/grammar-issues')
export class GrammarController {
  constructor(private readonly grammar: GrammarService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) { return this.grammar.list(sid(u)); }
}

@Module({ controllers: [GrammarController], providers: [GrammarService], exports: [GrammarService] })
export class GrammarModule {}

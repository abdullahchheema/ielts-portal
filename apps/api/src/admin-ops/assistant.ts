import { Body, Controller, Get, HttpCode, Injectable, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from '../ai/ai.service';
import { forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';
import { slaState } from '../support/routing';

const SUPPORT_INSTRUCTIONS = [
  'You help academy staff answer students. You suggest a reply; a person decides and sends it.',
  'Use only the KNOWLEDGE and TICKET sections. If they do not answer the question, say so and suggest who to ask.',
  'You cannot approve payments, reject applications, issue refunds, change grades, remove users or change permissions. Do not offer to.',
  'Return one JSON object with keys: suggestion (a reply the staff member can adapt) and sources (titles of the knowledge used).',
].join(' ');

const answerSchema = z.object({ suggestion: z.string().trim().min(10).max(2000), sources: z.array(z.string().max(200)).max(5) });
export const knowledgeSchema = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(20_000),
  audience: z.enum(['STAFF', 'STUDENT', 'BOTH']).default('STAFF'),
});

/**
 * Staff support assistant. It drafts a suggested reply from approved academy guidance and the ticket's own facts.
 * It has no write tools: every decision stays with a person, and nothing is sent or changed on its say-so.
 */
@Injectable()
export class SupportAssistantService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiService) {}

  async answer(userId: string, perms: Set<string>, question: string, ticketId?: string) {
    if (!perms.has('ai.support.use')) throw forbidden('You do not have access to the support assistant.');
    const articles = await this.prisma.$queryRaw<{ id: string; title: string; body: string }[]>`
      SELECT "id", "title", "body" FROM "knowledge_articles"
       WHERE "status" = 'APPROVED' AND "audience" IN ('STAFF', 'BOTH')
         AND to_tsvector('english', "title" || ' ' || "body") @@ plainto_tsquery('english', ${question})
       LIMIT 3`;
    let ticket: Record<string, unknown> | null = null;
    if (ticketId) {
      if (!perms.has('ticket.manage')) throw forbidden('You cannot view this ticket.');
      const t = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { category: true, priority: true, status: true, subject: true, createdAt: true, slaDueAt: true, firstResponseAt: true } });
      if (!t) throw notFound('Ticket');
      ticket = { category: t.category, priority: t.priority, status: t.status, subject: t.subject, sla: slaState(t, new Date()) };
    }
    const knowledge = articles.map((a) => `${a.title}\n${a.body.slice(0, 1500)}`).join('\n\n') || 'No approved guidance matches this question.';
    const out = await this.ai.json({
      feature: 'support.assist',
      userId,
      system: this.ai.systemPrompt('support.assist', SUPPORT_INSTRUCTIONS),
      user: [this.ai.wrapForPrompt('QUESTION', question), this.ai.wrapForPrompt('KNOWLEDGE', knowledge), this.ai.wrapForPrompt('TICKET', JSON.stringify(ticket ?? {}))].join('\n\n'),
      schema: answerSchema,
      mock: () => ({
        suggestion: articles.length
          ? `Based on “${articles[0].title}”: ${articles[0].body.slice(0, 300)}`
          : 'No approved guidance matches this question yet. Check with an academic admin before replying to the student.',
        sources: articles.map((a) => a.title),
      }),
      maxTokens: 700,
    });
    return { ...out.data, provider: out.provider };
  }

  async listKnowledge(perms: Set<string>) {
    if (!perms.has('knowledge.manage')) throw forbidden();
    return this.prisma.knowledgeArticle.findMany({ orderBy: { updatedAt: 'desc' }, take: 200, select: { id: true, title: true, audience: true, status: true, updatedAt: true } });
  }

  async addKnowledge(userId: string, perms: Set<string>, input: z.infer<typeof knowledgeSchema>) {
    if (!perms.has('knowledge.manage')) throw forbidden();
    return this.prisma.knowledgeArticle.create({ data: { ...input, status: 'APPROVED', updatedById: userId }, select: { id: true, title: true } });
  }
}

const askSchema = z.object({ question: z.string().trim().min(3).max(1000), ticketId: z.string().uuid().optional() });

@Controller('admin/support')
export class SupportAssistantController {
  constructor(private readonly assistant: SupportAssistantService, private readonly ctx: UserContextService) {}

  @RequirePermission('ai.support.use') @HttpCode(200) @Post('assistant')
  async ask(@Body(new ZodPipe(askSchema)) body: z.infer<typeof askSchema>, @CurrentUser() u: AuthUser) {
    return this.assistant.answer(u.id, (await this.ctx.get(u.id))!.permissions, body.question, body.ticketId);
  }
}

@Controller('admin/knowledge')
export class KnowledgeController {
  constructor(private readonly assistant: SupportAssistantService, private readonly ctx: UserContextService) {}

  @RequirePermission('knowledge.manage') @Get()
  async list(@CurrentUser() u: AuthUser) { return this.assistant.listKnowledge((await this.ctx.get(u.id))!.permissions); }

  @RequirePermission('knowledge.manage') @Post()
  async add(@Body(new ZodPipe(knowledgeSchema)) body: z.infer<typeof knowledgeSchema>, @CurrentUser() u: AuthUser) {
    return this.assistant.addKnowledge(u.id, (await this.ctx.get(u.id))!.permissions, body);
  }
}

@Module({ controllers: [SupportAssistantController, KnowledgeController], providers: [SupportAssistantService], exports: [SupportAssistantService] })
export class SupportAssistantModule {}

import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from '../ai/ai.service';
import { forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const uuid = new ParseUUIDPipe();
const MODES = ['GENERAL', 'READING', 'WRITING', 'SPEAKING', 'GRAMMAR', 'VOCABULARY'] as const;

const TUTOR_INSTRUCTIONS = [
  'You are an IELTS tutor for an academy student. Explain clearly and briefly, and encourage practice.',
  'Use only the KNOWLEDGE section for facts about IELTS and the academy. If it does not cover the question, say you are not sure and suggest asking a teacher. Never invent rules or scores.',
  'The STUDENT section holds the student’s own target and estimate. Use it only to make advice relevant.',
  'Return one JSON object with keys: answer (string) and sources (titles of knowledge used).',
].join(' ');

const answerSchema = z.object({ answer: z.string().trim().min(5).max(4000), sources: z.array(z.string().max(200)).max(5) });
const newSchema = z.object({ mode: z.enum(MODES).default('GENERAL'), title: z.string().trim().min(1).max(120).optional() });
const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });
const messageSchema = z.object({ content: z.string().trim().min(1).max(1000) });

/**
 * The student tutor. Answers come from approved academy knowledge and approved vocabulary, with only the student's
 * own target and estimate as context. A student's conversations are private to them and never shared with staff
 * through this path.
 */
@Injectable()
export class TutorService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiService) {}

  private async own(userId: string, id: string) {
    const c = await this.prisma.aiConversation.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, title: true, mode: true } });
    if (!c) throw notFound('Conversation');
    return c;
  }

  list(userId: string) {
    return this.prisma.aiConversation.findMany({ where: { userId, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, title: true, mode: true, updatedAt: true } });
  }

  create(userId: string, input: z.infer<typeof newSchema>) {
    return this.prisma.aiConversation.create({ data: { userId, mode: input.mode, title: input.title ?? 'New chat' }, select: { id: true, title: true, mode: true } });
  }

  async messages(userId: string, id: string) {
    await this.own(userId, id);
    return this.prisma.aiMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'asc' }, take: 200, select: { id: true, role: true, content: true, sources: true, createdAt: true } });
  }

  async rename(userId: string, id: string, title: string) {
    await this.own(userId, id);
    return this.prisma.aiConversation.update({ where: { id }, data: { title }, select: { id: true, title: true } });
  }

  async remove(userId: string, id: string) {
    await this.own(userId, id);
    await this.prisma.aiConversation.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  async ask(userId: string, id: string, question: string) {
    const conv = await this.own(userId, id);
    const student = await this.prisma.studentProfile.findUnique({ where: { userId }, select: { targetBand: true, currentBand: true } });
    if (!student) throw forbidden('The tutor is for students.');
    const articles = await this.prisma.$queryRaw<{ title: string; body: string }[]>`
      SELECT "title", "body" FROM "knowledge_articles"
       WHERE "status" = 'APPROVED' AND "audience" IN ('STUDENT', 'BOTH')
         AND to_tsvector('english', "title" || ' ' || "body") @@ plainto_tsquery('english', ${question})
       LIMIT 3`;
    const words = [...new Set((question.toLowerCase().match(/[a-z]{4,}/g) ?? []))].slice(0, 10);
    const vocab = words.length
      ? await this.prisma.vocabularyItem.findMany({ where: { status: 'APPROVED', word: { in: words, mode: 'insensitive' } }, select: { word: true, definition: true }, take: 5 })
      : [];
    const knowledge = [
      ...articles.map((a) => `${a.title}\n${a.body.slice(0, 1200)}`),
      ...vocab.map((v) => `Word: ${v.word} — ${v.definition}`),
    ].join('\n\n') || 'No approved material matches this question.';
    const studentContext = JSON.stringify({ target: student.targetBand === null ? null : Number(student.targetBand), estimate: student.currentBand === null ? null : Number(student.currentBand), mode: conv.mode });

    await this.prisma.aiMessage.create({ data: { conversationId: id, role: 'USER', content: question } });
    const out = await this.ai.json({
      feature: 'tutor.answer',
      userId,
      system: this.ai.systemPrompt('tutor.answer', TUTOR_INSTRUCTIONS),
      user: [this.ai.wrapForPrompt('QUESTION', question), this.ai.wrapForPrompt('KNOWLEDGE', knowledge), this.ai.wrapForPrompt('STUDENT', studentContext)].join('\n\n'),
      schema: answerSchema,
      mock: () => ({
        answer: articles.length || vocab.length
          ? `Here is what the academy material says: ${(articles[0]?.body ?? vocab[0].definition).slice(0, 400)}`
          : 'I do not have approved material on this yet. Ask your teacher, and they can add it to the academy guidance.',
        sources: [...articles.map((a) => a.title), ...vocab.map((v) => v.word)],
      }),
      maxTokens: 900,
    });
    const reply = await this.prisma.aiMessage.create({ data: { conversationId: id, role: 'ASSISTANT', content: out.data.answer, sources: out.data.sources } });
    await this.prisma.aiConversation.update({ where: { id }, data: { updatedAt: new Date(), ...(conv.title === 'New chat' ? { title: question.slice(0, 60) } : {}) } });
    return { id: reply.id, answer: reply.content, sources: out.data.sources, provider: out.provider };
  }
}

@Controller('me/tutor/conversations')
export class TutorController {
  constructor(private readonly tutor: TutorService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.tutor.list(u.id); }

  @HttpCode(201) @Post()
  create(@Body(new ZodPipe(newSchema)) body: z.infer<typeof newSchema>, @CurrentUser() u: AuthUser) { return this.tutor.create(u.id, body); }

  @Get(':id') messages(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.tutor.messages(u.id, id); }

  @Patch(':id') rename(@Param('id', uuid) id: string, @Body(new ZodPipe(renameSchema)) body: { title: string }, @CurrentUser() u: AuthUser) { return this.tutor.rename(u.id, id, body.title); }

  @Delete(':id') remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.tutor.remove(u.id, id); }

  @HttpCode(200) @Post(':id/messages')
  ask(@Param('id', uuid) id: string, @Body(new ZodPipe(messageSchema)) body: { content: string }, @CurrentUser() u: AuthUser) { return this.tutor.ask(u.id, id, body.content); }
}

@Module({ controllers: [TutorController], providers: [TutorService], exports: [TutorService] })
export class TutorModule {}

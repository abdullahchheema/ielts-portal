import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { STUDY_EVIDENCE, StudyEvidence } from '../study-plan/evidence';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { correctRate, reviewCard } from './sm2';

type Actor = { userId: string; ip?: string; userAgent?: string };
const uuid = new ParseUUIDPipe();

const itemSchema = z.object({
  word: z.string().trim().min(1).max(60).regex(/^[A-Za-z][A-Za-z '-]*$/, 'Letters only'),
  definition: z.string().trim().min(3).max(400),
  partOfSpeech: z.enum(['noun', 'verb', 'adjective', 'adverb', 'phrase']).nullable().optional(),
  synonyms: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  antonyms: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  ieltsRelevance: z.string().trim().max(300).nullable().optional(),
  example: z.string().trim().max(300).nullable().optional(),
  topic: z.string().trim().max(60).nullable().optional(),
  difficulty: z.number().int().min(1).max(5).default(3),
});

const reviewSchema = z.object({ correct: z.boolean() });
const suggestionQuery = z.object({ text: z.string().max(20_000).default('') });

/**
 * Vocabulary. Only curated (APPROVED) items can be saved or suggested, so nothing unvalidated reaches a student.
 * Review history is append-only; the schedule and the correct rate come from it.
 */
@Injectable()
export class VocabularyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly events: EventEmitter2) {}

  // ───────── curation (staff) ─────────
  async listItems(q: { status?: string; take?: number }) {
    return this.prisma.vocabularyItem.findMany({
      where: q.status ? { status: q.status } : {}, orderBy: { word: 'asc' }, take: q.take ?? 100,
      select: { id: true, word: true, definition: true, partOfSpeech: true, topic: true, difficulty: true, status: true },
    });
  }

  async createItem(input: z.infer<typeof itemSchema>, actor: Actor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.vocabularyItem.create({
          data: {
            word: input.word, definition: input.definition, partOfSpeech: input.partOfSpeech ?? null, synonyms: input.synonyms, antonyms: input.antonyms,
            ieltsRelevance: input.ieltsRelevance ?? null, example: input.example ?? null, topic: input.topic ?? null, difficulty: input.difficulty,
            status: 'APPROVED', createdById: actor.userId,
          },
          select: { id: true, word: true, status: true },
        });
        await this.audit.record({ ...actor, action: 'ADMIN_ADDED_VOCABULARY', entityType: 'VocabularyItem', entityId: item.id, after: { word: item.word } }, tx);
        return item;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw conflict('CONFLICT', 'This word is already in the list.');
      throw e;
    }
  }

  // ───────── student ─────────
  async mine(studentId: string) {
    const cards = await this.prisma.studentVocabulary.findMany({
      where: { studentId }, orderBy: [{ nextReviewAt: 'asc' }],
      select: { id: true, status: true, nextReviewAt: true, reviewCount: true, correctCount: true, lastReviewedAt: true, item: { select: { word: true, definition: true, partOfSpeech: true, example: true, synonyms: true } } },
    });
    const now = Date.now();
    return {
      due: cards.filter((c) => c.nextReviewAt && c.nextReviewAt.getTime() <= now).length,
      cards: cards.map((c) => ({ ...c, correctRate: correctRate(c.reviewCount, c.correctCount) })),
    };
  }

  async save(studentId: string, itemId: string) {
    const item = await this.prisma.vocabularyItem.findUnique({ where: { id: itemId }, select: { id: true, status: true } });
    if (!item || item.status !== 'APPROVED') throw notFound('Word');
    try {
      const card = await this.prisma.studentVocabulary.create({ data: { studentId, itemId, status: 'SAVED', nextReviewAt: new Date() }, select: { id: true } });
      return { id: card.id, saved: true };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { id: null, saved: false };
      throw e;
    }
  }

  async review(studentId: string, cardId: string, correct: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.studentVocabulary.findFirst({ where: { id: cardId, studentId } });
      if (!card) throw notFound('Word');
      const next = reviewCard({ ease: Number(card.ease), intervalDays: card.intervalDays, reviewCount: card.reviewCount, correctCount: card.correctCount }, correct, new Date());
      const claimed = await tx.studentVocabulary.updateMany({
        where: { id: cardId, reviewCount: card.reviewCount },
        data: {
          ease: next.ease, intervalDays: next.intervalDays, nextReviewAt: next.nextReviewAt, status: next.status,
          reviewCount: { increment: 1 }, correctCount: correct ? { increment: 1 } : undefined, lastReviewedAt: new Date(),
        },
      });
      if (claimed.count === 0) throw new AppError('CONFLICT', 409, 'This word was just reviewed. Refresh and try again.');
      await tx.vocabularyReview.create({ data: { studentVocabularyId: cardId, correct } });
      this.events.emit(STUDY_EVIDENCE, { studentId, refType: 'VOCABULARY_REVIEW', refId: cardId } satisfies StudyEvidence);
      return { status: next.status, nextReviewAt: next.nextReviewAt, intervalDays: next.intervalDays };
    });
  }

  /** Approved words that appear in the student's own text and are not yet saved. Never invents a word. */
  async suggestionsFor(studentId: string, text: string) {
    const words = [...new Set((text.toLowerCase().match(/[a-z]+/g) ?? []))];
    if (words.length === 0) return [];
    const [items, saved] = await Promise.all([
      this.prisma.vocabularyItem.findMany({ where: { status: 'APPROVED', word: { in: words, mode: 'insensitive' } }, select: { id: true, word: true, definition: true }, take: 20 }),
      this.prisma.studentVocabulary.findMany({ where: { studentId }, select: { itemId: true } }),
    ]);
    const have = new Set(saved.map((s) => s.itemId));
    return items.filter((i) => !have.has(i.id));
  }

  async stats(studentId: string) {
    const agg = await this.prisma.studentVocabulary.aggregate({ where: { studentId }, _sum: { reviewCount: true, correctCount: true }, _count: { _all: true } });
    const byStatus = await this.prisma.studentVocabulary.groupBy({ by: ['status'], where: { studentId }, _count: { _all: true } });
    return {
      saved: agg._count._all,
      reviews: agg._sum.reviewCount ?? 0,
      correctRate: correctRate(agg._sum.reviewCount ?? 0, agg._sum.correctCount ?? 0),
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    };
  }
}

const sid = (u: AuthUser) => { if (!u.studentId) throw forbidden(); return u.studentId; };
const actorOf = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller('me/vocabulary')
export class StudentVocabularyController {
  constructor(private readonly vocab: VocabularyService) {}
  @Get() mine(@CurrentUser() u: AuthUser) { return this.vocab.mine(sid(u)); }
  @Get('stats') stats(@CurrentUser() u: AuthUser) { return this.vocab.stats(sid(u)); }
  @Get('suggestions') suggestions(@Query(new ZodPipe(suggestionQuery)) q: { text: string }, @CurrentUser() u: AuthUser) { return this.vocab.suggestionsFor(sid(u), q.text); }
  @HttpCode(201) @Post(':itemId') save(@Param('itemId', uuid) itemId: string, @CurrentUser() u: AuthUser) { return this.vocab.save(sid(u), itemId); }
  @HttpCode(200) @Post('cards/:id/review') review(@Param('id', uuid) id: string, @Body(new ZodPipe(reviewSchema)) body: { correct: boolean }, @CurrentUser() u: AuthUser) {
    return this.vocab.review(sid(u), id, body.correct);
  }
}

@Controller('admin/vocabulary')
export class AdminVocabularyController {
  constructor(private readonly vocab: VocabularyService) {}
  @RequirePermission('knowledge.manage') @Get()
  list(@Query('status') status?: string) { return this.vocab.listItems({ status: status === 'APPROVED' || status === 'DRAFT' ? status : undefined }); }
  @RequirePermission('knowledge.manage') @Post()
  create(@Body(new ZodPipe(itemSchema)) body: z.infer<typeof itemSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.vocab.createItem(body, actorOf(u, req));
  }
}

@Module({ controllers: [StudentVocabularyController, AdminVocabularyController], providers: [VocabularyService], exports: [VocabularyService] })
export class VocabularyModule {}

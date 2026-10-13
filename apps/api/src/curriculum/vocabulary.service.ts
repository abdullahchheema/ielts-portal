import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { UpdateVocabularyEntryInput, VocabularyEntryInput, updateVocabularyEntrySchema, vocabularyEntrySchema } from '@ielts/validation';
import { forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const sid = (u: AuthUser) => {
  if (!u.studentId) throw forbidden('Only student accounts can do this.');
  return u.studentId;
};

/** Personal vocabulary bank (spec §26): students save words from lessons, reading, and feedback, and review them over time. */
@Injectable()
export class VocabularyService {
  constructor(private readonly prisma: PrismaService) {}

  list(studentId: string, reviewStatus?: string) {
    return this.prisma.vocabularyEntry.findMany({
      where: { studentId, ...(reviewStatus ? { reviewStatus } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(studentId: string, input: VocabularyEntryInput) {
    const existing = await this.prisma.vocabularyEntry.findFirst({ where: { studentId, term: { equals: input.term, mode: 'insensitive' } } });
    if (existing) return existing; // idempotent: saving the same word twice just returns the existing entry
    return this.prisma.vocabularyEntry.create({ data: { studentId, ...input } });
  }

  async update(studentId: string, id: string, input: UpdateVocabularyEntryInput) {
    const existing = await this.prisma.vocabularyEntry.findFirst({ where: { id, studentId } });
    if (!existing) throw notFound('Vocabulary entry');
    const reviewIncrement = input.reviewStatus && input.reviewStatus !== existing.reviewStatus;
    return this.prisma.vocabularyEntry.update({
      where: { id },
      data: { ...input, ...(reviewIncrement ? { reviewCount: { increment: 1 } } : {}) },
    });
  }

  async remove(studentId: string, id: string) {
    const { count } = await this.prisma.vocabularyEntry.deleteMany({ where: { id, studentId } });
    if (!count) throw notFound('Vocabulary entry');
  }
}

const uuid = new ParseUUIDPipe();

@Controller('me/vocabulary')
export class VocabularyController {
  constructor(private readonly vocab: VocabularyService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) { return this.vocab.list(sid(u)); }

  @Post()
  create(@Body(new ZodPipe(vocabularyEntrySchema)) body: VocabularyEntryInput, @CurrentUser() u: AuthUser) {
    return this.vocab.create(sid(u), body);
  }

  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateVocabularyEntrySchema)) body: UpdateVocabularyEntryInput, @CurrentUser() u: AuthUser) {
    return this.vocab.update(sid(u), id, body);
  }

  @HttpCode(204) @Delete(':id')
  async remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { await this.vocab.remove(sid(u), id); }
}

@Module({ controllers: [VocabularyController], providers: [VocabularyService], exports: [VocabularyService] })
export class VocabularyModule {}

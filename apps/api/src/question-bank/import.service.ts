import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { BulkImportInput, ImportCommitResult, ImportPreviewResult, ImportQuestionIssue, ImportSetPreview, flattenSetQuestions } from '@ielts/validation';
import { QuestionType, normalizeText, validateQuestionDefinition } from '../assessments/grading';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { Actor, graderType, usesKey } from './question-bank.service';

/**
 * Bulk import of question sets + questions from a structured JSON payload. Two-step: `preview()`
 * validates and flags duplicates without touching the database; `commit()` persists everything
 * inside one transaction, reusing the same writeVersion() that the direct authoring API uses, so
 * imported content is graded exactly like hand-authored content. Every imported set lands
 * PUBLISHED (commit() already blocks on the same per-question completeness problems setStatusTx's
 * publish guard checks) but not studentFacing, so an admin still has to flip that on per set before
 * it's actually eligible for rotation or any student-visible view.
 */
@Injectable()
export class QuestionImportService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async preview(input: BulkImportInput): Promise<ImportPreviewResult> {
    const existingByNormalizedText = await this.loadExistingPromptIndex();
    const sets: ImportSetPreview[] = input.sets.map((set, setIndex) => {
      const issues: ImportQuestionIssue[] = [];
      const duplicates: ImportSetPreview['duplicates'] = [];
      const flat = flattenSetQuestions(set);
      flat.forEach(({ question: q }, questionIndex) => {
        const grader = graderType(q.ieltsType);
        if (grader !== 'NONE') {
          const problems = validateQuestionDefinition({
            type: grader as QuestionType, options: q.options ?? [], answerKey: q.answerKey ?? null,
          });
          for (const message of problems) issues.push({ questionIndex, path: 'question', message });
        }

        const norm = normalizeText(q.prompt.text);
        const match = norm ? existingByNormalizedText.get(norm) : undefined;
        if (match) duplicates.push({ questionIndex, matchedQuestionId: match.questionId, matchedPrompt: match.promptText });
      });
      return { setIndex, title: set.title, questionCount: flat.length, issues, duplicates };
    });
    return {
      sets,
      totalQuestions: sets.reduce((n, s) => n + s.questionCount, 0),
      totalIssues: sets.reduce((n, s) => n + s.issues.length, 0),
      totalDuplicates: sets.reduce((n, s) => n + s.duplicates.length, 0),
    };
  }

  /**
   * Builds every row in memory first (ids generated client-side, same trick the direct authoring
   * API uses for ORDERING's option ids), then writes each table in one bulk `createMany` — a
   * handful of round-trips total instead of ~3 per question. A large import (dozens of questions)
   * done one row at a time was slow enough over a cross-region connection to time out the request
   * entirely; this makes the write cost roughly constant regardless of import size.
   */
  async commit(input: BulkImportInput, actor: Actor): Promise<ImportCommitResult> {
    const preview = await this.preview(input);
    const blocking = preview.sets.find((s) => s.issues.length > 0);
    if (blocking) throw new AppError('VALIDATION_ERROR', 422, `Set "${blocking.title}" has ${blocking.issues.length} invalid question(s). Fix them and re-import.`);

    const setRows: Prisma.QuestionSetCreateManyInput[] = [];
    const questionRows: Prisma.QuestionCreateManyInput[] = [];
    const versionRows: Prisma.QuestionVersionCreateManyInput[] = [];
    const optionRows: Prisma.QuestionOptionCreateManyInput[] = [];
    const created: ImportCommitResult['created'] = [];

    for (const set of input.sets) {
      const setId = randomUUID();
      // A sectioned set (several passages) stores its sections' own metadata — title, instructions,
      // passage — as stimulus.sections[]; audio is attached afterward, per section, via attachSetAudio.
      const stimulus = set.sections
        ? { sections: set.sections.map(({ title, instructions, passage, cueCard, instructionGroups, contentBlocks }) => ({ title, instructions, passage, cueCard, instructionGroups, contentBlocks })) }
        : (set.stimulus ?? Prisma.JsonNull);
      setRows.push({
        id: setId, title: set.title, skill: set.skill, module: set.module, topic: set.topic ?? null, difficulty: set.difficulty,
        source: set.source ?? null, stimulus, status: 'PUBLISHED', studentFacing: input.publish ?? false,
        createdById: actor.userId ?? null,
      });
      let sequence = 0;
      for (const { question: q, sectionIndex } of flattenSetQuestions(set)) {
        const grader = graderType(q.ieltsType);
        // Pre-generate option ids so ORDERING's correctOrder (given as labels in the import file)
        // can be translated to real ids before persistence.
        const optionsWithIds = (q.options ?? []).map((o) => ({ id: randomUUID(), label: o.label, isCorrect: o.isCorrect }));
        let answerKey = q.answerKey ?? null;
        if (grader === 'ORDERING' && answerKey?.correctOrder) {
          const idByLabel = new Map(optionsWithIds.map((o) => [o.label, o.id]));
          answerKey = { ...answerKey, correctOrder: answerKey.correctOrder.map((label) => idByLabel.get(label) ?? label) };
        }
        const questionId = randomUUID();
        const versionId = randomUUID();
        questionRows.push({ id: questionId, questionSetId: setId, questionType: grader, ieltsType: q.ieltsType, sequence: sequence++, bankSectionIndex: sectionIndex });

        // Same storage rules writeVersion() applies for a single question — replicated here since
        // createMany can't call a per-row helper.
        const matchingWithMappings = grader === 'MATCHING' && Array.isArray((answerKey as { mappings?: unknown[] } | null)?.mappings)
          && ((answerKey as { mappings?: unknown[] } | null)?.mappings?.length ?? 0) > 0;
        const storeAnswerKey = usesKey(grader) || grader === 'ORDERING' || matchingWithMappings;
        const storeOptions = !matchingWithMappings && !usesKey(grader);
        versionRows.push({
          id: versionId, questionId, version: 1, prompt: q.prompt as Prisma.InputJsonValue,
          answerKey: storeAnswerKey && answerKey ? (answerKey as Prisma.InputJsonValue) : Prisma.DbNull,
          marks: new Prisma.Decimal(q.marks), partialCredit: q.partialCredit ?? false,
        });
        if (storeOptions && optionsWithIds.length) {
          optionRows.push(...optionsWithIds.map((o, i) => ({ id: o.id, questionVersionId: versionId, label: o.label, isCorrect: o.isCorrect, sequence: i })));
        }
      }
      created.push({ setId, title: set.title, questionCount: sequence });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.questionSet.createMany({ data: setRows });
      if (questionRows.length) await tx.question.createMany({ data: questionRows });
      if (versionRows.length) await tx.questionVersion.createMany({ data: versionRows });
      if (optionRows.length) await tx.questionOption.createMany({ data: optionRows });
      for (const c of created) {
        await this.audit.record({ ...actor, action: 'ADMIN_IMPORTED_QUESTION_SET', entityType: 'QuestionSet', entityId: c.setId, after: { title: c.title, questionCount: c.questionCount } }, tx);
      }
    });
    return { created };
  }

  /** One normalized-prompt -> source question map, built once per preview call. Bounded by the
   *  bank's realistic scale (a few thousand questions), so a single in-memory pass is simplest. */
  private async loadExistingPromptIndex() {
    const rows = await this.prisma.questionVersion.findMany({
      where: { question: { deletedAt: null } },
      select: { questionId: true, prompt: true },
      orderBy: { version: 'desc' },
    });
    const byNormalized = new Map<string, { questionId: string; promptText: string }>();
    for (const r of rows) {
      const text = (r.prompt as { text?: string } | null)?.text;
      if (!text) continue;
      const norm = normalizeText(text);
      if (norm && !byNormalized.has(norm)) byNormalized.set(norm, { questionId: r.questionId, promptText: text });
    }
    return byNormalized;
  }
}

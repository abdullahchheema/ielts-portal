import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { BulkImportInput, ImportCommitResult, ImportPreviewResult, ImportQuestionIssue, ImportSetPreview } from '@ielts/validation';
import { QuestionType, normalizeText, validateQuestionDefinition } from '../assessments/grading';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { Actor, graderType, writeVersion } from './question-bank.service';

/**
 * Bulk import of question sets + questions from a structured JSON payload. Two-step: `preview()`
 * validates and flags duplicates without touching the database; `commit()` persists everything
 * created as DRAFT sets inside one transaction, reusing the same writeVersion() that the direct
 * authoring API uses, so imported content is graded exactly like hand-authored content.
 */
@Injectable()
export class QuestionImportService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async preview(input: BulkImportInput): Promise<ImportPreviewResult> {
    const existingByNormalizedText = await this.loadExistingPromptIndex();
    const sets: ImportSetPreview[] = input.sets.map((set, setIndex) => {
      const issues: ImportQuestionIssue[] = [];
      const duplicates: ImportSetPreview['duplicates'] = [];
      set.questions.forEach((q, questionIndex) => {
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
      return { setIndex, title: set.title, questionCount: set.questions.length, issues, duplicates };
    });
    return {
      sets,
      totalQuestions: sets.reduce((n, s) => n + s.questionCount, 0),
      totalIssues: sets.reduce((n, s) => n + s.issues.length, 0),
      totalDuplicates: sets.reduce((n, s) => n + s.duplicates.length, 0),
    };
  }

  async commit(input: BulkImportInput, actor: Actor): Promise<ImportCommitResult> {
    const preview = await this.preview(input);
    const blocking = preview.sets.find((s) => s.issues.length > 0);
    if (blocking) throw new AppError('VALIDATION_ERROR', 422, `Set "${blocking.title}" has ${blocking.issues.length} invalid question(s). Fix them and re-import.`);

    return this.prisma.$transaction(async (tx) => {
      const created: ImportCommitResult['created'] = [];
      for (const set of input.sets) {
        const row = await tx.questionSet.create({
          data: {
            title: set.title, skill: set.skill, module: set.module, topic: set.topic ?? null, difficulty: set.difficulty,
            source: set.source ?? null, stimulus: set.stimulus ?? Prisma.JsonNull, status: 'DRAFT', studentFacing: false,
            createdById: actor.userId ?? null,
          },
        });
        let sequence = 0;
        for (const q of set.questions) {
          const grader = graderType(q.ieltsType);
          // Pre-generate option ids so ORDERING's correctOrder (given as labels in the import file)
          // can be translated to real ids before persistence — the same id-up-front trick the direct
          // authoring API uses when a caller supplies option ids itself.
          const optionsWithIds = (q.options ?? []).map((o) => ({ id: randomUUID(), label: o.label, isCorrect: o.isCorrect }));
          let answerKey = q.answerKey ?? null;
          if (grader === 'ORDERING' && answerKey?.correctOrder) {
            const idByLabel = new Map(optionsWithIds.map((o) => [o.label, o.id]));
            answerKey = { ...answerKey, correctOrder: answerKey.correctOrder.map((label) => idByLabel.get(label) ?? label) };
          }
          const question = await tx.question.create({ data: { questionSetId: row.id, questionType: grader, ieltsType: q.ieltsType, sequence: sequence++ } });
          await writeVersion(tx, question.id, 1, {
            prompt: q.prompt as Prisma.InputJsonValue, marks: q.marks, answerKey: answerKey as Prisma.InputJsonValue | null,
            options: optionsWithIds, grader, partialCredit: q.partialCredit,
          });
        }
        await this.audit.record({ ...actor, action: 'ADMIN_IMPORTED_QUESTION_SET', entityType: 'QuestionSet', entityId: row.id, after: { title: row.title, questionCount: set.questions.length } }, tx);
        created.push({ setId: row.id, title: row.title, questionCount: set.questions.length });
      }
      return { created };
    });
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

import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import {
  BankPickInput, BankQuestionInput, IELTS_ITEM_TYPES, IeltsItemType, PracticeSessionInput, QUESTION_SET_TRANSITIONS, QuestionSetCreateInput,
  QuestionSetStatus, QuestionSetStatusInput, QuestionSetUpdateInput,
} from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { BankCandidate, selectCandidates } from './selection';

type Actor = { userId?: string; ip?: string; userAgent?: string };
type Tx = Prisma.TransactionClient;
const EDITABLE: QuestionSetStatus[] = ['DRAFT', 'APPROVED'];

const graderType = (t: IeltsItemType) => IELTS_ITEM_TYPES[t].grader;
const usesKey = (grader: string) => ['TFNG', 'YNNG', 'COMPLETION'].includes(grader);

/** Writes one question version plus its options. Used for new questions, edits and copies. */
async function writeVersion(
  tx: Tx, questionId: string, version: number,
  body: { prompt: Prisma.InputJsonValue; marks: number; answerKey?: Prisma.InputJsonValue | null; options?: { label: string; isCorrect: boolean }[]; grader: string },
) {
  const qv = await tx.questionVersion.create({
    data: {
      questionId, version, prompt: body.prompt, marks: new Prisma.Decimal(body.marks),
      answerKey: usesKey(body.grader) && body.answerKey ? body.answerKey : Prisma.DbNull,
    },
  });
  if (!usesKey(body.grader) && body.options?.length) {
    await tx.questionOption.createMany({ data: body.options.map((o, i) => ({ questionVersionId: qv.id, label: o.label, isCorrect: o.isCorrect, sequence: i })) });
  }
  return qv;
}

@Injectable()
export class QuestionBankService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ───────── sets ─────────
  async listSets(q: { skill?: string; status?: string; topic?: string; skip: number; take: number }) {
    const where: Prisma.QuestionSetWhereInput = {
      ...(q.skill ? { skill: q.skill } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.topic ? { topic: q.topic } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.questionSet.findMany({
        where, orderBy: { updatedAt: 'desc' }, skip: q.skip, take: q.take,
        select: { id: true, title: true, skill: true, module: true, topic: true, difficulty: true, bandTarget: true, status: true, studentFacing: true, version: true, updatedAt: true, questions: { where: { deletedAt: null }, select: { id: true } } },
      }),
      this.prisma.questionSet.count({ where }),
    ]);
    return { total, items: rows.map(({ questions, ...r }) => ({ ...r, questionCount: questions.length })) };
  }

  async getSet(id: string) {
    const set = await this.prisma.questionSet.findUnique({
      where: { id },
      include: {
        questions: {
          where: { deletedAt: null }, orderBy: { sequence: 'asc' },
          include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { options: { orderBy: { sequence: 'asc' } } } } },
        },
      },
    });
    if (!set) throw notFound('Question set');
    return set;
  }

  async createSet(input: QuestionSetCreateInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const set = await tx.questionSet.create({ data: this.setData(input, actor) as Prisma.QuestionSetUncheckedCreateInput });
      await this.audit.record({ ...actor, action: 'ADMIN_CREATED_QUESTION_SET', entityType: 'QuestionSet', entityId: set.id, after: { title: set.title, skill: set.skill } }, tx);
      return set;
    });
  }

  async updateSet(id: string, input: QuestionSetUpdateInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.questionSet.findUnique({ where: { id } });
      if (!before) throw notFound('Question set');
      if (!EDITABLE.includes(before.status as QuestionSetStatus)) {
        throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Published and archived sets cannot be edited. Clone the set to make a new draft.');
      }
      const after = await tx.questionSet.update({ where: { id }, data: this.setData(input, actor, true) as Prisma.QuestionSetUncheckedUpdateInput });
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_QUESTION_SET', entityType: 'QuestionSet', entityId: id, before: { title: before.title, difficulty: before.difficulty }, after: { title: after.title, difficulty: after.difficulty } }, tx);
      return after;
    });
  }

  /** Moves a set through DRAFT → APPROVED → PUBLISHED → ARCHIVED. Publishing checks the content first. */
  async setStatus(id: string, input: QuestionSetStatusInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const set = await tx.questionSet.findUnique({ where: { id }, include: { questions: { where: { deletedAt: null }, select: { id: true, questionType: true, ieltsType: true, versions: { select: { answerKey: true, options: { select: { isCorrect: true } } }, orderBy: { version: 'desc' }, take: 1 } } } } });
      if (!set) throw notFound('Question set');
      const from = set.status as QuestionSetStatus;
      if (from === input.status) throw conflict('CONFLICT', 'The set already has that status.');
      if (!QUESTION_SET_TRANSITIONS[from].includes(input.status)) {
        throw conflict('CONFLICT', `A ${from.toLowerCase()} set cannot become ${input.status.toLowerCase()}.`);
      }
      if (input.status === 'PUBLISHED') {
        if (set.questions.length === 0) throw new AppError('VALIDATION_ERROR', 422, 'Add at least one question before publishing.');
        const incomplete = set.questions.filter((q) => {
          const v = q.versions[0];
          if (!v) return true;
          const grader = q.ieltsType ? graderType(q.ieltsType as IeltsItemType) : q.questionType;
          if (grader === 'NONE') return false;
          if (usesKey(grader)) return !v.answerKey;
          return v.options.length < 2 || !v.options.some((o) => o.isCorrect);
        });
        if (incomplete.length > 0) throw new AppError('VALIDATION_ERROR', 422, `${incomplete.length} question(s) are missing an answer key or correct option.`);
      }
      const studentFacing = input.status === 'PUBLISHED' ? (input.studentFacing ?? set.studentFacing) : false;
      const after = await tx.questionSet.update({
        where: { id },
        data: { status: input.status, studentFacing, publishedAt: input.status === 'PUBLISHED' ? new Date() : set.publishedAt },
      });
      await this.audit.record({
        ...actor, action: 'ADMIN_CHANGED_QUESTION_SET_STATUS', entityType: 'QuestionSet', entityId: id,
        before: { status: from, studentFacing: set.studentFacing }, after: { status: input.status, studentFacing, note: input.note ?? null },
      }, tx);
      return after;
    });
  }

  /** A new draft copy of any set, with copied questions that remember where they came from. */
  async cloneSet(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const src = await tx.questionSet.findUnique({ where: { id }, include: { questions: { where: { deletedAt: null }, orderBy: { sequence: 'asc' }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { options: { orderBy: { sequence: 'asc' } } } } } } } });
      if (!src) throw notFound('Question set');
      const copy = await tx.questionSet.create({
        data: {
          title: `${src.title} (copy)`, skill: src.skill, module: src.module, sectionNumber: src.sectionNumber, topic: src.topic,
          difficulty: src.difficulty, bandTarget: src.bandTarget, tags: src.tags, source: src.source, timeEstimateMin: src.timeEstimateMin,
          stimulus: src.stimulus ?? Prisma.JsonNull, version: src.version + 1, status: 'DRAFT', studentFacing: false, createdById: actor.userId ?? null,
        },
      });
      for (const q of src.questions) {
        const v = q.versions[0];
        const grader = q.ieltsType ? graderType(q.ieltsType as IeltsItemType) : q.questionType;
        const nq = await tx.question.create({
          data: { questionSetId: copy.id, questionType: q.questionType, ieltsType: q.ieltsType, sequence: q.sequence, sourceQuestionId: q.id },
        });
        if (v) {
          await writeVersion(tx, nq.id, 1, {
            prompt: v.prompt as Prisma.InputJsonValue, marks: Number(v.marks), answerKey: v.answerKey as Prisma.InputJsonValue | null,
            options: v.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })), grader,
          });
        }
      }
      await this.audit.record({ ...actor, action: 'ADMIN_CLONED_QUESTION_SET', entityType: 'QuestionSet', entityId: copy.id, before: { sourceId: id } }, tx);
      return copy;
    });
  }

  // ───────── questions inside a set ─────────
  async addQuestion(setId: string, input: BankQuestionInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const set = await tx.questionSet.findUnique({ where: { id: setId } });
      if (!set) throw notFound('Question set');
      if (!EDITABLE.includes(set.status as QuestionSetStatus)) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Clone the set before adding questions.');
      const grader = graderType(input.ieltsType);
      const sequence = await tx.question.count({ where: { questionSetId: setId, deletedAt: null } });
      const q = await tx.question.create({ data: { questionSetId: setId, questionType: grader, ieltsType: input.ieltsType, sequence } });
      await writeVersion(tx, q.id, 1, { prompt: input.prompt, marks: input.marks, answerKey: input.answerKey as Prisma.InputJsonValue | undefined, options: input.options, grader });
      await this.audit.record({ ...actor, action: 'ADMIN_ADDED_BANK_QUESTION', entityType: 'Question', entityId: q.id, after: { setId, ieltsType: input.ieltsType } }, tx);
      return { id: q.id };
    });
  }

  /** Editing creates a new version, so earlier attempts keep the question they actually answered. */
  async updateQuestion(id: string, input: BankQuestionInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const q = await tx.question.findFirst({ where: { id, deletedAt: null }, include: { questionSet: true, versions: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!q || !q.questionSet) throw notFound('Question');
      if (!EDITABLE.includes(q.questionSet.status as QuestionSetStatus)) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Clone the set before editing its questions.');
      const grader = graderType(input.ieltsType);
      await tx.question.update({ where: { id }, data: { questionType: grader, ieltsType: input.ieltsType } });
      const next = (q.versions[0]?.version ?? 0) + 1;
      await writeVersion(tx, id, next, { prompt: input.prompt, marks: input.marks, answerKey: input.answerKey as Prisma.InputJsonValue | undefined, options: input.options, grader });
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_BANK_QUESTION', entityType: 'Question', entityId: id, after: { version: next } }, tx);
      return { id, version: next };
    });
  }

  async removeQuestion(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const q = await tx.question.findFirst({ where: { id, deletedAt: null }, include: { questionSet: true } });
      if (!q || !q.questionSet) throw notFound('Question');
      if (!EDITABLE.includes(q.questionSet.status as QuestionSetStatus)) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Clone the set before removing questions.');
      // Soft delete: attempts that already used the question still resolve it.
      await tx.question.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record({ ...actor, action: 'ADMIN_REMOVED_BANK_QUESTION', entityType: 'Question', entityId: id }, tx);
      return { ok: true };
    });
  }

  // ───────── picking ─────────
  /** Candidates from published, student-facing sets only. Admin pickers pass `studentFacing: false` to see everything published. */
  async candidates(input: { skill: string; topic?: string; difficulty?: { min: number; max: number }; ieltsTypes?: string[] }, studentFacing: boolean): Promise<BankCandidate[]> {
    const rows = await this.prisma.question.findMany({
      where: {
        deletedAt: null,
        questionSet: {
          skill: input.skill, status: 'PUBLISHED',
          ...(studentFacing ? { studentFacing: true } : {}),
          ...(input.topic ? { topic: input.topic } : {}),
          ...(input.difficulty ? { difficulty: { gte: input.difficulty.min, lte: input.difficulty.max } } : {}),
        },
        ...(input.ieltsTypes?.length ? { ieltsType: { in: input.ieltsTypes } } : {}),
      },
      select: { id: true, questionSetId: true, ieltsType: true, questionSet: { select: { difficulty: true, topic: true } } },
      take: 2000,
    });
    return rows.filter((r) => r.questionSetId && r.questionSet).map((r) => ({
      id: r.id, setId: r.questionSetId!, difficulty: r.questionSet!.difficulty, topic: r.questionSet!.topic, ieltsType: r.ieltsType ?? '',
    }));
  }

  async pickForAdmin(input: BankPickInput) {
    const cands = await this.candidates(input, false);
    const ids = selectCandidates(cands, { count: input.count, seed: `admin:${input.skill}:${input.topic ?? ''}:${input.count}`, ieltsTypes: input.ieltsTypes, topic: input.topic, difficulty: input.difficultyMin && input.difficultyMax ? { min: input.difficultyMin, max: input.difficultyMax } : undefined });
    return { ids, available: cands.length };
  }

  /** Copies chosen bank questions into an assessment section that is still a draft. The copies keep a link to their source. */
  async copyIntoSection(sectionId: string, questionIds: string[], actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const section = await tx.assessmentSection.findUnique({ where: { id: sectionId }, include: { version: true } });
      if (!section) throw notFound('Section');
      if (section.version.publishedAt) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'This version is published. Create a new version first.');
      const sources = await tx.question.findMany({
        where: { id: { in: questionIds }, deletedAt: null, questionSetId: { not: null } },
        include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { options: { orderBy: { sequence: 'asc' } } } } },
      });
      if (sources.length !== questionIds.length) throw notFound('Question');
      let sequence = await tx.question.count({ where: { sectionId, deletedAt: null } });
      for (const src of sources) {
        const v = src.versions[0];
        if (!v) continue;
        const grader = src.ieltsType ? graderType(src.ieltsType as IeltsItemType) : src.questionType;
        const q = await tx.question.create({ data: { sectionId, questionType: grader, sequence: sequence++, sourceQuestionId: src.id, ieltsType: src.ieltsType } });
        await writeVersion(tx, q.id, 1, {
          prompt: v.prompt as Prisma.InputJsonValue, marks: Number(v.marks), answerKey: v.answerKey as Prisma.InputJsonValue | null,
          options: v.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })), grader,
        });
      }
      await this.audit.record({ ...actor, action: 'ASSESSMENT_QUESTIONS_FROM_BANK', entityType: 'AssessmentSection', entityId: sectionId, after: { count: sources.length } }, tx);
      return { added: sources.length };
    });
  }

  // ───────── student practice ─────────
  /**
   * Builds a personal practice assessment from published, student-facing questions, then the student starts it
   * with the normal attempt flow (autosave, timing and grading are unchanged).
   */
  async createPractice(studentId: string, input: PracticeSessionInput) {
    const day = new Date().toISOString().slice(0, 10);
    const recent = await this.prisma.attemptAnswer.findMany({
      where: { attempt: { studentId, submittedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } },
      select: { questionVersion: { select: { questionId: true } } }, take: 2000,
    });
    const exclude = new Set(recent.map((r) => r.questionVersion.questionId));
    const cands = await this.candidates({ skill: input.skill, topic: input.topic, difficulty: input.difficulty ? { min: Math.max(1, input.difficulty - 1), max: Math.min(5, input.difficulty + 1) } : undefined }, true);
    const ids = selectCandidates(cands, { count: input.count, seed: `${studentId}|${day}|${input.skill}`, topic: input.topic, exclude });
    if (ids.length === 0) throw notFound('Practice questions for this selection');

    const sources = await this.prisma.question.findMany({
      where: { id: { in: ids } },
      include: { questionSet: true, versions: { orderBy: { version: 'desc' }, take: 1, include: { options: { orderBy: { sequence: 'asc' } } } } },
    });
    const byId = new Map(sources.map((s) => [s.id, s]));
    const ordered = ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s && !!s.questionSet && !!s.versions[0]);
    const bySet = new Map<string, typeof ordered>();
    for (const q of ordered) bySet.set(q.questionSetId!, [...(bySet.get(q.questionSetId!) ?? []), q]);
    const minutes = ordered.reduce((sum, q) => sum + (q.questionSet?.timeEstimateMin ?? 2), 0);

    return this.prisma.$transaction(async (tx) => {
      const a = await tx.assessment.create({
        data: {
          type: 'PRACTICE', title: `Practice · ${input.skill.toLowerCase()} · ${day}`, skill: input.skill, passPercent: 0, showAnswers: true,
          origin: 'ADAPTIVE', generatedForStudentId: studentId, libraryVisible: false, timeLimitMin: Math.min(180, Math.max(5, minutes)),
        },
      });
      const version = await tx.assessmentVersion.create({ data: { assessmentId: a.id, version: 1, publishedAt: new Date() } });
      let sectionSeq = 0;
      for (const qs of bySet.values()) {
        const set = qs[0].questionSet!;
        const stimulus = (set.stimulus ?? {}) as Prisma.InputJsonValue;
        const section = await tx.assessmentSection.create({ data: { assessmentVersionId: version.id, title: set.title, sequence: sectionSeq++, content: stimulus } });
        let seq = 0;
        for (const src of qs) {
          const v = src.versions[0];
          const grader = src.ieltsType ? graderType(src.ieltsType as IeltsItemType) : src.questionType;
          const q = await tx.question.create({ data: { sectionId: section.id, questionType: grader, sequence: seq++, sourceQuestionId: src.id, ieltsType: src.ieltsType } });
          await writeVersion(tx, q.id, 1, {
            prompt: v.prompt as Prisma.InputJsonValue, marks: Number(v.marks), answerKey: v.answerKey as Prisma.InputJsonValue | null,
            options: v.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })), grader,
          });
        }
      }
      return { assessmentId: a.id, questionCount: ordered.length };
    });
  }

  // ───────── helpers ─────────
  private setData(input: QuestionSetCreateInput | QuestionSetUpdateInput, actor: Actor, partial = false): Record<string, unknown> {
    const data: Record<string, unknown> = {
      title: input.title, skill: input.skill, module: input.module, sectionNumber: input.sectionNumber, topic: input.topic,
      difficulty: input.difficulty, bandTarget: input.bandTarget, tags: input.tags, source: input.source, timeEstimateMin: input.timeEstimateMin,
      stimulus: input.stimulus === undefined ? undefined : input.stimulus === null ? Prisma.JsonNull : input.stimulus,
    };
    if (!partial) data.createdById = actor.userId ?? null;
    for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
    return data;
  }
}

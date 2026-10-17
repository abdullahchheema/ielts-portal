import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import {
  BankPickInput, BankQuestionInput, IELTS_ITEM_TYPES, IeltsItemType, PracticeSessionInput, QUESTION_SET_TRANSITIONS, QuestionSetCreateInput,
  QuestionSetStatus, QuestionSetStatusInput, QuestionSetUpdateInput,
} from '@ielts/validation';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, notFound } from '../common/app-error';
import { StorageService, sniffFileType } from '../integrations/storage.service';
import { EntitlementService } from '../plans/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { BankCandidate, selectCandidates } from './selection';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

export type Actor = { userId?: string; ip?: string; userAgent?: string };
type Tx = Prisma.TransactionClient;
const EDITABLE: QuestionSetStatus[] = ['DRAFT', 'APPROVED'];

export const graderType = (t: IeltsItemType) => IELTS_ITEM_TYPES[t].grader;
/** Graders whose correctness lives entirely in the answer key (no options table rows). */
export const usesKey = (grader: string) => ['TFNG', 'YNNG', 'COMPLETION', 'NUMERICAL', 'MULTI_BLANK'].includes(grader);

/**
 * Writes one question version plus its options. Used for new questions, edits, copies and bulk import.
 * Options may carry a caller-supplied `id` (so ORDERING's answerKey.correctOrder can name an
 * option within the same request, before the server would otherwise generate one).
 */
export async function writeVersion(
  tx: Tx, questionId: string, version: number,
  body: {
    prompt: Prisma.InputJsonValue; marks: number; answerKey?: Prisma.InputJsonValue | null;
    options?: { id?: string; label: string; isCorrect: boolean }[]; grader: string; partialCredit?: boolean;
  },
) {
  // MATCHING can be either options-based (one correct option, legacy) or mappings-based (answer key only).
  const matchingWithMappings = body.grader === 'MATCHING' && Array.isArray((body.answerKey as { mappings?: unknown[] } | null | undefined)?.mappings)
    && ((body.answerKey as { mappings?: unknown[] }).mappings?.length ?? 0) > 0;
  // ORDERING keeps its options (the orderable items) and also needs the correct order recorded as an answer key.
  const storeAnswerKey = usesKey(body.grader) || body.grader === 'ORDERING' || matchingWithMappings;
  const storeOptions = !matchingWithMappings && !usesKey(body.grader);
  const qv = await tx.questionVersion.create({
    data: {
      questionId, version, prompt: body.prompt, marks: new Prisma.Decimal(body.marks),
      answerKey: storeAnswerKey && body.answerKey ? body.answerKey : Prisma.DbNull,
      partialCredit: body.partialCredit ?? false,
    },
  });
  if (storeOptions && body.options?.length) {
    await tx.questionOption.createMany({ data: body.options.map((o, i) => ({ id: o.id ?? randomUUID(), questionVersionId: qv.id, label: o.label, isCorrect: o.isCorrect, sequence: i })) });
  }
  return qv;
}

@Injectable()
export class QuestionBankService {
  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly storage: StorageService,
    private readonly entitlements: EntitlementService,
  ) {}

  // ───────── images ─────────
  /** A stimulus image attached to a whole set (e.g. a map or chart shared by several questions). */
  async attachSetImage(setId: string, file: { buffer: Buffer; size: number } | undefined, altText: string | undefined, actor: Actor) {
    const set = await this.prisma.questionSet.findUnique({ where: { id: setId } });
    if (!set) throw notFound('Question set');
    if (!EDITABLE.includes(set.status as QuestionSetStatus)) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Clone the set before adding images.');
    const image = await this.storeImage(file, altText, { questionSetId: setId });
    await this.audit.record({ ...actor, action: 'ADMIN_ADDED_QUESTION_IMAGE', entityType: 'QuestionSet', entityId: setId, after: { imageId: image.id } });
    return image;
  }

  /** Listening audio for a set, stored alongside its stimulus. Must be attached before publishing —
   *  same rule as the assessment-side equivalent — since a published set is otherwise immutable. */
  async attachSetAudio(setId: string, file: { buffer: Buffer; size: number } | undefined, actor: Actor) {
    if (!file) throw new AppError('VALIDATION_ERROR', 422, 'Attach an MP3 file.', { file: 'Required.' });
    if (file.size > MAX_AUDIO_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The audio file is larger than 100 MB.');
    const set = await this.prisma.questionSet.findUnique({ where: { id: setId } });
    if (!set) throw notFound('Question set');
    if (!EDITABLE.includes(set.status as QuestionSetStatus)) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Clone the set before adding audio.');
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed || sniffed.mime !== 'audio/mpeg') throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only MP3 audio is accepted.');
    const audioKey = `question-sets/${setId}/${randomUUID()}.mp3`;
    await this.storage.put(audioKey, file.buffer, 'audio/mpeg');
    const stimulus = { ...((set.stimulus as object) ?? {}), audioKey };
    await this.prisma.questionSet.update({ where: { id: setId }, data: { stimulus } });
    await this.audit.record({ ...actor, action: 'ADMIN_ADDED_QUESTION_SET_AUDIO', entityType: 'QuestionSet', entityId: setId, after: { audioKey } });
    return { ok: true };
  }

  /** An image attached to one question's current version (e.g. a diagram for diagram labelling). */
  async attachQuestionImage(questionId: string, file: { buffer: Buffer; size: number } | undefined, altText: string | undefined, actor: Actor) {
    const q = await this.prisma.question.findFirst({ where: { id: questionId, deletedAt: null }, include: { questionSet: true, versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!q || !q.questionSet) throw notFound('Question');
    if (!EDITABLE.includes(q.questionSet.status as QuestionSetStatus)) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Clone the set before adding images.');
    const qv = q.versions[0];
    if (!qv) throw notFound('Question version');
    const image = await this.storeImage(file, altText, { questionVersionId: qv.id });
    await this.audit.record({ ...actor, action: 'ADMIN_ADDED_QUESTION_IMAGE', entityType: 'Question', entityId: questionId, after: { imageId: image.id } });
    return image;
  }

  async removeImage(imageId: string, actor: Actor) {
    const image = await this.prisma.questionImage.findUnique({ where: { id: imageId } });
    if (!image) throw notFound('Image');
    await this.prisma.questionImage.delete({ where: { id: imageId } });
    await this.audit.record({ ...actor, action: 'ADMIN_REMOVED_QUESTION_IMAGE', entityType: 'QuestionImage', entityId: imageId });
    return { ok: true };
  }

  private async storeImage(file: { buffer: Buffer; size: number } | undefined, altText: string | undefined, target: { questionSetId?: string; questionVersionId?: string }) {
    if (!file) throw new AppError('VALIDATION_ERROR', 422, 'Attach an image file.', { file: 'Required.' });
    if (file.size > MAX_IMAGE_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The image is larger than 5 MB.');
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed || !IMAGE_MIMES.has(sniffed.mime)) throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only JPEG, PNG or WebP images are accepted.');
    const fileKey = `question-images/${target.questionSetId ?? target.questionVersionId}/${randomUUID()}.${sniffed.ext}`;
    await this.storage.put(fileKey, file.buffer, sniffed.mime);
    const sequence = await this.prisma.questionImage.count({ where: target });
    return this.prisma.questionImage.create({ data: { ...target, fileKey, fileMime: sniffed.mime, altText, sequence } });
  }

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
        images: { orderBy: { sequence: 'asc' } },
        questions: {
          where: { deletedAt: null }, orderBy: { sequence: 'asc' },
          include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { options: { orderBy: { sequence: 'asc' } }, images: { orderBy: { sequence: 'asc' } } } } },
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
          // Mapping-based MATCHING already carries its answer key; options are optional in that mode.
          if (grader === 'MATCHING' && v.answerKey) return false;
          if (usesKey(grader) || grader === 'ORDERING') return !v.answerKey;
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
            options: v.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })), grader, partialCredit: v.partialCredit,
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
      await writeVersion(tx, q.id, 1, { prompt: input.prompt, marks: input.marks, answerKey: input.answerKey as Prisma.InputJsonValue | undefined, options: input.options, grader, partialCredit: input.partialCredit });
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
      await writeVersion(tx, id, next, { prompt: input.prompt, marks: input.marks, answerKey: input.answerKey as Prisma.InputJsonValue | undefined, options: input.options, grader, partialCredit: input.partialCredit });
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
          options: v.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })), grader, partialCredit: v.partialCredit,
        });
      }
      await this.audit.record({ ...actor, action: 'ASSESSMENT_QUESTIONS_FROM_BANK', entityType: 'AssessmentSection', entityId: sectionId, after: { count: sources.length } }, tx);
      return { added: sources.length };
    });
  }

  // ───────── student practice ─────────
  /**
   * Builds the sections and questions of a paper from bank questions. One section per source passage, and
   * every question is a copy that remembers its source. Shared by practice sessions and mock composition.
   */
  async buildPaper(tx: Prisma.TransactionClient, assessmentId: string, questionIds: string[], publish: boolean) {
    const sources = await tx.question.findMany({
      where: { id: { in: questionIds } },
      include: { questionSet: true, versions: { orderBy: { version: 'desc' }, take: 1, include: { options: { orderBy: { sequence: 'asc' } } } } },
    });
    const byId = new Map(sources.map((s) => [s.id, s]));
    const ordered = questionIds.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s && !!s.questionSet && !!s.versions[0]);
    const bySet = new Map<string, typeof ordered>();
    for (const q of ordered) bySet.set(q.questionSetId!, [...(bySet.get(q.questionSetId!) ?? []), q]);

    const version = await tx.assessmentVersion.create({ data: { assessmentId, version: 1, publishedAt: publish ? new Date() : null } });
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
          options: v.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })), grader, partialCredit: v.partialCredit,
        });
      }
    }
    return { versionId: version.id, questionCount: ordered.length, minutes: ordered.reduce((sum, q) => sum + (q.questionSet?.timeEstimateMin ?? 2), 0) };
  }

  /**
   * Builds a personal practice assessment from published, student-facing questions, then the student starts it
   * with the normal attempt flow (autosave, timing and grading are unchanged).
   */
  async createPractice(studentId: string, input: PracticeSessionInput) {
    if (!await this.entitlements.can(studentId, 'practice.unlimited')) {
      throw new AppError('PLAN_UPGRADE_REQUIRED', 403, 'Unlimited practice requires the Starter plan or above.');
    }
    const day = new Date().toISOString().slice(0, 10);
    const recent = await this.prisma.attemptAnswer.findMany({
      where: { attempt: { studentId, submittedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } },
      select: { questionVersion: { select: { questionId: true } } }, take: 2000,
    });
    const exclude = new Set(recent.map((r) => r.questionVersion.questionId));
    const cands = await this.candidates({ skill: input.skill, topic: input.topic, difficulty: input.difficulty ? { min: Math.max(1, input.difficulty - 1), max: Math.min(5, input.difficulty + 1) } : undefined }, true);
    const ids = selectCandidates(cands, { count: input.count, seed: `${studentId}|${day}|${input.skill}`, topic: input.topic, exclude });
    if (ids.length === 0) throw notFound('Practice questions for this selection');

    return this.prisma.$transaction(async (tx) => {
      const a = await tx.assessment.create({
        data: {
          type: 'PRACTICE', title: `Practice · ${input.skill.toLowerCase()} · ${day}`, skill: input.skill, passPercent: 0, showAnswers: true,
          origin: 'ADAPTIVE', generatedForStudentId: studentId, libraryVisible: false, timeLimitMin: 5,
        },
      });
      const paper = await this.buildPaper(tx, a.id, ids, true);
      await tx.assessment.update({ where: { id: a.id }, data: { timeLimitMin: Math.min(180, Math.max(5, paper.minutes)) } });
      return { assessmentId: a.id, questionCount: paper.questionCount };
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

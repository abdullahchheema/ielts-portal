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
// PUBLISHED is intentionally editable: an admin fixing a typo or adding an image to a live module
// shouldn't have to clone, re-archive and re-publish a whole new set just to change one word. What a
// published set must never do is silently desync from its already-built wrapper Assessment (the
// actual copy free-test claims serve) — see invalidateWrapperIfPublished() below, called after every
// mutation here. ARCHIVED stays immutable: that's the deliberate "done being used" signal.
const EDITABLE: QuestionSetStatus[] = ['PUBLISHED'];

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

  /** A content edit to an already-published Listening/Reading set must not silently desync from its
   *  already-built wrapper Assessment (the live copy free-test claims actually serve) — clearing this
   *  makes the next pick rebuild fresh from the edited content. Already-started student attempts are
   *  unaffected: they reference the old wrapper Assessment row directly, which still exists untouched.
   *  A no-op for a non-PUBLISHED set or one with no wrapper yet (Writing/Speaking never get one). */
  private async invalidateWrapperIfPublished(db: Tx | PrismaService, setId: string) {
    await db.questionSet.updateMany({ where: { id: setId, status: 'PUBLISHED', wrapperAssessmentId: { not: null } }, data: { wrapperAssessmentId: null } });
  }

  // ───────── images ─────────
  /** A stimulus image attached to a whole set, or to one section of a multi-passage set when
   *  `sectionIndex` is given (e.g. a map labelled A-G that several of that section's questions all
   *  refer to) — shown once above that section's questions, the image equivalent of a passage. */
  async attachSetImage(setId: string, file: { buffer: Buffer; size: number } | undefined, altText: string | undefined, actor: Actor, sectionIndex?: number) {
    const set = await this.prisma.questionSet.findUnique({ where: { id: setId } });
    if (!set) throw notFound('Question set');
    if (!EDITABLE.includes(set.status as QuestionSetStatus)) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Clone the set before adding images.');
    if (sectionIndex !== undefined) {
      const stimulus = set.stimulus as { sections?: unknown[] } | null;
      if (!stimulus?.sections?.[sectionIndex]) throw notFound('Section');
    }
    const image = await this.storeImage(file, altText, { questionSetId: setId, sectionIndex });
    await this.invalidateWrapperIfPublished(this.prisma, setId);
    await this.audit.record({ ...actor, action: 'ADMIN_ADDED_QUESTION_IMAGE', entityType: 'QuestionSet', entityId: setId, after: { imageId: image.id, sectionIndex } });
    return image;
  }

  /** Listening audio for a set, stored alongside its stimulus. Can be attached any time, including
   *  after publishing — adding it later just (safely) invalidates the live wrapper so it rebuilds. For
   *  a multi-passage set, `sectionIndex` says which of `stimulus.sections[]` the file belongs to
   *  (a real Listening paper often has a separate track per section); omitted for a single-passage set.
   *  Only used as a fallback when direct upload isn't available (presignSetAudio() below is preferred —
   *  a full test recording easily exceeds the 4.5 MB request body limit a serverless function enforces). */
  async attachSetAudio(setId: string, file: { buffer: Buffer; size: number } | undefined, actor: Actor, sectionIndex?: number) {
    if (!file) throw new AppError('VALIDATION_ERROR', 422, 'Attach an MP3 file.', { file: 'Required.' });
    if (file.size > MAX_AUDIO_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The audio file is larger than 100 MB.');
    await this.getEditableSet(setId, sectionIndex);
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed || sniffed.mime !== 'audio/mpeg') throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only MP3 audio is accepted.');
    const audioKey = `question-sets/${setId}/${randomUUID()}.mp3`;
    await this.storage.put(audioKey, file.buffer, 'audio/mpeg');
    await this.mergeSetAudioKey(setId, audioKey, sectionIndex);
    await this.audit.record({ ...actor, action: 'ADMIN_ADDED_QUESTION_SET_AUDIO', entityType: 'QuestionSet', entityId: setId, after: { audioKey, sectionIndex } });
    return { ok: true };
  }

  /** Direct browser upload to private storage, bypassing the serverless function's body size limit —
   *  the same pattern speaking recordings already use. Falls back to the multipart route above when
   *  no S3 bucket is configured (local dev). */
  async presignSetAudio(setId: string, actor: Actor, sectionIndex?: number) {
    await this.getEditableSet(setId, sectionIndex);
    const audioKey = `question-sets/${setId}/${randomUUID()}.mp3`;
    const put = await this.storage.presignPut(audioKey, 'audio/mpeg');
    const qs = sectionIndex !== undefined ? `?sectionIndex=${sectionIndex}` : '';
    if (!put) return { mode: 'multipart' as const, url: `/admin/question-sets/${setId}/audio${qs}` };
    return { mode: 'direct' as const, url: put.url, headers: put.headers, key: audioKey };
  }

  /** After a direct upload: verify the object really exists, is within the size limit, and is audio,
   *  then wire it into the set's stimulus — the same checks `complete()` does for speaking recordings. */
  async completeSetAudio(setId: string, key: string, actor: Actor, sectionIndex?: number) {
    const meta = await this.storage.head(key);
    if (!meta) throw new AppError('UPLOAD_FAILED', 422, 'The audio did not arrive. Please try again.');
    if (meta.size <= 0 || meta.size > MAX_AUDIO_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The audio file is larger than 100 MB.');
    const sniffed = sniffFileType(await this.storage.readHead(key, 64));
    if (!sniffed || sniffed.mime !== 'audio/mpeg') {
      await this.storage.remove(key);
      throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only MP3 audio is accepted.');
    }
    await this.getEditableSet(setId, sectionIndex);
    await this.mergeSetAudioKey(setId, key, sectionIndex);
    await this.audit.record({ ...actor, action: 'ADMIN_ADDED_QUESTION_SET_AUDIO', entityType: 'QuestionSet', entityId: setId, after: { audioKey: key, sectionIndex } });
    return { ok: true };
  }

  /** The set, after confirming it's still editable and (if given) that sectionIndex names a real
   *  section — the shared guard every audio-attach path needs. */
  private async getEditableSet(setId: string, sectionIndex?: number) {
    const set = await this.prisma.questionSet.findUnique({ where: { id: setId } });
    if (!set) throw notFound('Question set');
    if (!EDITABLE.includes(set.status as QuestionSetStatus)) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Clone the set before adding audio.');
    if (sectionIndex !== undefined) {
      const stimulus = set.stimulus as { sections?: unknown[] } | null;
      if (!stimulus?.sections?.[sectionIndex]) throw notFound('Section');
    }
    return set;
  }

  private async mergeSetAudioKey(setId: string, audioKey: string, sectionIndex?: number) {
    const set = await this.prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    const current = (set.stimulus as { sections?: Record<string, unknown>[] } | null) ?? {};
    const stimulus = sectionIndex !== undefined
      ? { ...current, sections: current.sections!.map((s, i) => (i === sectionIndex ? { ...s, audioKey } : s)) }
      : { ...current, audioKey };
    await this.prisma.questionSet.update({ where: { id: setId }, data: { stimulus: stimulus as Prisma.InputJsonValue } });
    await this.invalidateWrapperIfPublished(this.prisma, setId);
  }

  /** An image attached to one question's current version (e.g. a diagram for diagram labelling). */
  async attachQuestionImage(questionId: string, file: { buffer: Buffer; size: number } | undefined, altText: string | undefined, actor: Actor) {
    const q = await this.prisma.question.findFirst({ where: { id: questionId, deletedAt: null }, include: { questionSet: true, versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!q || !q.questionSet) throw notFound('Question');
    if (!EDITABLE.includes(q.questionSet.status as QuestionSetStatus)) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Clone the set before adding images.');
    const qv = q.versions[0];
    if (!qv) throw notFound('Question version');
    const image = await this.storeImage(file, altText, { questionVersionId: qv.id });
    await this.invalidateWrapperIfPublished(this.prisma, q.questionSet.id);
    await this.audit.record({ ...actor, action: 'ADMIN_ADDED_QUESTION_IMAGE', entityType: 'Question', entityId: questionId, after: { imageId: image.id } });
    return image;
  }

  async removeImage(imageId: string, actor: Actor) {
    const image = await this.prisma.questionImage.findUnique({
      where: { id: imageId }, include: { questionVersion: { select: { question: { select: { questionSetId: true } } } } },
    });
    if (!image) throw notFound('Image');
    const setId = image.questionSetId ?? image.questionVersion?.question.questionSetId;
    await this.prisma.questionImage.delete({ where: { id: imageId } });
    if (setId) await this.invalidateWrapperIfPublished(this.prisma, setId);
    await this.audit.record({ ...actor, action: 'ADMIN_REMOVED_QUESTION_IMAGE', entityType: 'QuestionImage', entityId: imageId });
    return { ok: true };
  }

  private async storeImage(file: { buffer: Buffer; size: number } | undefined, altText: string | undefined, target: { questionSetId?: string; questionVersionId?: string; sectionIndex?: number }) {
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
        select: { id: true, title: true, skill: true, module: true, topic: true, difficulty: true, bandTarget: true, status: true, studentFacing: true, createdAt: true, updatedAt: true, questions: { where: { deletedAt: null }, select: { id: true } } },
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
    const setLevelImages = set.images.filter((img) => img.sectionIndex === null);
    const sectionImagesByIndex = new Map<number, typeof set.images>();
    for (const img of set.images) {
      if (img.sectionIndex === null) continue;
      sectionImagesByIndex.set(img.sectionIndex, [...(sectionImagesByIndex.get(img.sectionIndex) ?? []), img]);
    }
    const [stimulus, images, questions] = await Promise.all([
      this.resolveStimulusAudio(set.stimulus, sectionImagesByIndex),
      Promise.all(setLevelImages.map(async (img) => ({ ...img, url: await this.storage.signedUrl(img.fileKey, 3600) }))),
      Promise.all(set.questions.map(async (q) => ({
        ...q,
        versions: await Promise.all(q.versions.map(async (v) => ({
          ...v, images: await Promise.all(v.images.map(async (img) => ({ ...img, url: await this.storage.signedUrl(img.fileKey, 3600) }))),
        }))),
      }))),
    ]);
    return { ...set, stimulus, images, questions };
  }

  /** Swaps every raw `audioKey` in a set's stimulus (top-level, or per-section) for a short-lived
   *  signed `audioUrl`, and attaches each section's own shared images (resolved to signed URLs) —
   *  the admin UI never handles a raw storage key. */
  private async resolveStimulusAudio(stimulus: unknown, sectionImagesByIndex: Map<number, { id: string; fileKey: string; altText: string | null }[]>) {
    const s = stimulus as { audioKey?: string; sections?: { audioKey?: string }[] } | null;
    if (!s) return s;
    const [audioUrl, sections] = await Promise.all([
      s.audioKey ? this.storage.signedUrl(s.audioKey, 3600) : undefined,
      s.sections
        ? Promise.all(s.sections.map(async (sec, i) => {
            const imgs = sectionImagesByIndex.get(i) ?? [];
            const [withAudio, resolvedImages] = await Promise.all([
              sec.audioKey ? this.storage.signedUrl(sec.audioKey, 3600) : undefined,
              Promise.all(imgs.map(async (img) => ({ id: img.id, altText: img.altText, url: await this.storage.signedUrl(img.fileKey, 3600) }))),
            ]);
            return { ...sec, ...(withAudio ? { audioUrl: withAudio } : {}), images: resolvedImages };
          }))
        : undefined,
    ]);
    return { ...s, ...(audioUrl ? { audioUrl } : {}), ...(sections ? { sections } : {}) };
  }

  async createSet(input: QuestionSetCreateInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const set = await tx.questionSet.create({ data: this.setData(input, actor) as Prisma.QuestionSetUncheckedCreateInput });
      await this.audit.record({ ...actor, action: 'ADMIN_CREATED_QUESTION_SET', entityType: 'QuestionSet', entityId: set.id, after: { title: set.title, skill: set.skill } }, tx);
      return set;
    });
  }

  /** Permanently removes a set and everything in it, at any status including PUBLISHED — a
   *  free-test wrapper or a mock exam only ever holds its own independent *copy* of the content
   *  (QuestionBankService.copyIntoSection(), used by both), so deleting the bank originals never
   *  touches what's actually shown to students. Those copies do keep a provenance pointer back to
   *  the bank question they were copied from (Question.sourceQuestionId, a blocking FK) — cleared
   *  below before the originals are deleted, rather than left to surface as a raw foreign-key
   *  violation. The one other real constraint is MockExam.listeningSetId/readingSetId, a direct
   *  (not copied) FK to the set itself — guarded below too. */
  async deleteSet(id: string, actor: Actor) {
    await this.prisma.$transaction((tx) => this.deleteSetTx(tx, id, actor));
    return { ok: true };
  }

  /** Same guard and audit entry as deleteSet(), reused inside a shared transaction by bulkDelete()
   *  so every item in a batch either all deletes or all rolls back together. */
  private async deleteSetTx(tx: Tx, id: string, actor: Actor) {
    const set = await tx.questionSet.findUnique({ where: { id }, include: { questions: { select: { id: true } } } });
    if (!set) throw notFound('Question set');
    // A set currently picked into a mock exam is referenced by MockExam.listeningSetId/
    // readingSetId (a required FK, ON DELETE RESTRICT) — without this check the delete would hit
    // a raw foreign-key violation instead of a clear error. Composing a new mock exam picks a
    // different module instead (least-used), so this only ever blocks the exact set in use.
    const usedByMockExam = await tx.mockExam.findFirst({ where: { OR: [{ listeningSetId: id }, { readingSetId: id }] }, select: { id: true } });
    if (usedByMockExam) throw conflict('CONFLICT', 'This set is used by a mock exam and cannot be deleted.');
    const questionIds = set.questions.map((q) => q.id);
    // Every free-test/mock-exam copy ever made from one of these questions still points back to
    // it via sourceQuestionId (blocking FK) — drop that pointer so the copy (and the student
    // result it belongs to) is untouched, but no longer blocks deleting the original.
    await tx.question.updateMany({ where: { sourceQuestionId: { in: questionIds } }, data: { sourceQuestionId: null } });
    // Writing/Speaking have no copy mechanism — SimulatorService picks a bank question directly,
    // so a student's WritingResponse/SpeakingResponse references it by questionId (also a
    // blocking FK). Clear that too; the student's actual essay/recording is untouched.
    await tx.writingResponse.updateMany({ where: { questionId: { in: questionIds } }, data: { questionId: null } });
    await tx.speakingResponse.updateMany({ where: { questionId: { in: questionIds } }, data: { questionId: null } });
    const versionIds = (await tx.questionVersion.findMany({ where: { questionId: { in: questionIds } }, select: { id: true } })).map((v) => v.id);
    await tx.questionImage.deleteMany({ where: { OR: [{ questionSetId: id }, { questionVersionId: { in: versionIds } }] } });
    await tx.questionOption.deleteMany({ where: { questionVersionId: { in: versionIds } } });
    await tx.questionVersion.deleteMany({ where: { id: { in: versionIds } } });
    await tx.question.deleteMany({ where: { id: { in: questionIds } } });
    await tx.questionSet.delete({ where: { id } });
    await this.audit.record({ ...actor, action: 'ADMIN_DELETED_QUESTION_SET', entityType: 'QuestionSet', entityId: id, before: { title: set.title, questionCount: questionIds.length } }, tx);
  }

  /** Deletes several sets in one all-or-nothing transaction: one invalid id aborts the whole batch
   *  rather than leaving a partial result. Unlike deleteSetTx() (which does ~7 round trips per set,
   *  fine for a single delete), this batches every independent query across the whole id list —
   *  one findMany/updateMany/deleteMany per step instead of one per set — so a large batch stays
   *  well under Prisma's interactive-transaction timeout (the same shape of fix already applied to
   *  copyIntoSection() below for the same reason). */
  async bulkDelete(ids: string[], actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const sets = await tx.questionSet.findMany({ where: { id: { in: ids } }, include: { questions: { select: { id: true } } } });
      const foundIds = new Set(sets.map((s) => s.id));
      const missing = ids.find((id) => !foundIds.has(id));
      if (missing) throw notFound('Question set');

      const usedByMockExam = await tx.mockExam.findFirst({ where: { OR: [{ listeningSetId: { in: ids } }, { readingSetId: { in: ids } }] }, select: { id: true } });
      if (usedByMockExam) throw conflict('CONFLICT', 'This set is used by a mock exam and cannot be deleted.');

      const questionIds = sets.flatMap((s) => s.questions.map((q) => q.id));
      await tx.question.updateMany({ where: { sourceQuestionId: { in: questionIds } }, data: { sourceQuestionId: null } });
      await tx.writingResponse.updateMany({ where: { questionId: { in: questionIds } }, data: { questionId: null } });
      await tx.speakingResponse.updateMany({ where: { questionId: { in: questionIds } }, data: { questionId: null } });
      const versionIds = (await tx.questionVersion.findMany({ where: { questionId: { in: questionIds } }, select: { id: true } })).map((v) => v.id);
      await tx.questionImage.deleteMany({ where: { OR: [{ questionSetId: { in: ids } }, { questionVersionId: { in: versionIds } }] } });
      await tx.questionOption.deleteMany({ where: { questionVersionId: { in: versionIds } } });
      await tx.questionVersion.deleteMany({ where: { id: { in: versionIds } } });
      await tx.question.deleteMany({ where: { id: { in: questionIds } } });
      await tx.questionSet.deleteMany({ where: { id: { in: ids } } });

      // Audit rows stay one-per-set (cheap inserts, not the round-trip bottleneck the batching above
      // targets) so each deleted set keeps its own before-state in the log.
      for (const s of sets) {
        await this.audit.record({ ...actor, action: 'ADMIN_DELETED_QUESTION_SET', entityType: 'QuestionSet', entityId: s.id, before: { title: s.title, questionCount: s.questions.length } }, tx);
      }
      return { ok: true, count: ids.length };
    });
  }

  async updateSet(id: string, input: QuestionSetUpdateInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.questionSet.findUnique({ where: { id } });
      if (!before) throw notFound('Question set');
      if (!EDITABLE.includes(before.status as QuestionSetStatus)) {
        throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'Archived sets cannot be edited. Clone the set to make a new draft.');
      }
      const after = await tx.questionSet.update({ where: { id }, data: this.setData(input, actor, true) as Prisma.QuestionSetUncheckedUpdateInput });
      await this.invalidateWrapperIfPublished(tx, id);
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_QUESTION_SET', entityType: 'QuestionSet', entityId: id, before: { title: before.title, difficulty: before.difficulty }, after: { title: after.title, difficulty: after.difficulty } }, tx);
      return after;
    });
  }

  /** Toggles a set between PUBLISHED and ARCHIVED. Publishing checks the content first. */
  async setStatus(id: string, input: QuestionSetStatusInput, actor: Actor) {
    return this.prisma.$transaction((tx) => this.setStatusTx(tx, id, input, actor));
  }

  /** Same guards and audit entry as setStatus(), but reused inside a shared transaction by bulk
   *  status changes so every item in a batch either all applies or all rolls back together. */
  private async setStatusTx(tx: Tx, id: string, input: QuestionSetStatusInput, actor: Actor) {
    const set = await tx.questionSet.findUnique({ where: { id }, include: { questions: { where: { deletedAt: null }, select: { id: true, questionType: true, ieltsType: true, versions: { select: { answerKey: true, options: { select: { isCorrect: true } } }, orderBy: { version: 'desc' }, take: 1 } } } } });
    if (!set) throw notFound('Question set');
    const from = set.status as QuestionSetStatus;
    // A same-status call is only a true no-op (and refused as one) when studentFacing isn't moving
    // either. Every new set now lands PUBLISHED-but-hidden by default (no draft stage to build it
    // in first), so "flip studentFacing on" for a brand-new set is a same-status PUBLISHED call —
    // it still has to go through here, and through the completeness check below, not be rejected
    // outright just because `status` itself isn't changing.
    const studentFacingChanging = input.studentFacing !== undefined && input.studentFacing !== set.studentFacing;
    if (from === input.status && !studentFacingChanging) throw conflict('CONFLICT', 'The set already has that status.');
    if (from !== input.status && !QUESTION_SET_TRANSITIONS[from].includes(input.status)) {
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
  }

  /** Applies the same status change to several sets in one all-or-nothing transaction: one bad id
   *  aborts the whole batch (with that id's own error) rather than leaving a partial result. */
  async bulkSetStatus(ids: string[], input: QuestionSetStatusInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const id of ids) results.push(await this.setStatusTx(tx, id, input, actor));
      return { ok: true, count: results.length };
    });
  }

  /** A new copy of any set, with copied questions that remember where they came from. The copy
   *  inherits the source's status (a published set clones as published, ready to edit in place
   *  per EDITABLE; an archived set clones as archived) rather than always landing in some
   *  intermediate state — there's no more draft stage to land a fresh copy in. It's never
   *  student-facing on arrival, even if the source was, so a clone never silently doubles up a
   *  live module's rotation weight until an admin opts it in. */
  async cloneSet(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const src = await tx.questionSet.findUnique({ where: { id }, include: { questions: { where: { deletedAt: null }, orderBy: { sequence: 'asc' }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { options: { orderBy: { sequence: 'asc' } } } } } } } });
      if (!src) throw notFound('Question set');
      const copy = await tx.questionSet.create({
        data: {
          title: `${src.title} (copy)`, skill: src.skill, module: src.module, sectionNumber: src.sectionNumber, topic: src.topic,
          difficulty: src.difficulty, bandTarget: src.bandTarget, tags: src.tags, source: src.source, timeEstimateMin: src.timeEstimateMin,
          stimulus: src.stimulus ?? Prisma.JsonNull, status: src.status, studentFacing: false, createdById: actor.userId ?? null,
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
      await this.invalidateWrapperIfPublished(tx, setId);
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
      await this.invalidateWrapperIfPublished(tx, q.questionSet.id);
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
      await this.invalidateWrapperIfPublished(tx, q.questionSet.id);
      await this.audit.record({ ...actor, action: 'ADMIN_REMOVED_BANK_QUESTION', entityType: 'Question', entityId: id }, tx);
      return { ok: true };
    });
  }

  // ───────── picking ─────────
  /** Candidates from published, student-facing sets only. Admin pickers pass `studentFacing: false` to see everything published.
   *  `rotationEligibleOnly` additionally restricts to sets an admin hasn't opted out of free-test
   *  rotation — only the free-test path passes this; every other caller leaves it unset so the
   *  authenticated practice/simulator pool is unaffected by that toggle. */
  async candidates(input: { skill: string; topic?: string; difficulty?: { min: number; max: number }; ieltsTypes?: string[] }, studentFacing: boolean, rotationEligibleOnly = false): Promise<BankCandidate[]> {
    const rows = await this.prisma.question.findMany({
      where: {
        deletedAt: null,
        questionSet: {
          skill: input.skill, status: 'PUBLISHED',
          ...(studentFacing ? { studentFacing: true } : {}),
          ...(rotationEligibleOnly ? { eligibleForFreeTestRotation: true } : {}),
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

  /** Copies chosen bank questions into an assessment section that is still a draft. The copies keep a
   *  link to their source. Rows are built in memory (ids generated client-side) and written with
   *  `createMany` — one row-at-a-time loop here was slow enough over a cross-region connection to blow
   *  past Prisma's interactive-transaction timeout once a section held more than a handful of
   *  questions (same failure already fixed for bulk import; see QuestionImportService.commit()). */
  async copyIntoSection(sectionId: string, questionIds: string[], actor: Actor) {
    const section = await this.prisma.assessmentSection.findUnique({ where: { id: sectionId }, include: { version: true } });
    if (!section) throw notFound('Section');
    if (section.version.publishedAt) throw conflict('VERSION_PUBLISHED_IMMUTABLE', 'This version is published. Create a new version first.');
    const sources = await this.prisma.question.findMany({
      where: { id: { in: questionIds }, deletedAt: null, questionSetId: { not: null } },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { options: { orderBy: { sequence: 'asc' } }, images: { orderBy: { sequence: 'asc' } } } } },
    });
    if (sources.length !== questionIds.length) throw notFound('Question');
    const byId = new Map(sources.map((s) => [s.id, s]));
    const ordered = questionIds.map((id) => byId.get(id)!);
    let sequence = await this.prisma.question.count({ where: { sectionId, deletedAt: null } });

    const questionRows: Prisma.QuestionCreateManyInput[] = [];
    const versionRows: Prisma.QuestionVersionCreateManyInput[] = [];
    const optionRows: Prisma.QuestionOptionCreateManyInput[] = [];
    const imageRows: Prisma.QuestionImageCreateManyInput[] = [];
    let added = 0;
    for (const src of ordered) {
      const v = src.versions[0];
      if (!v) continue;
      const grader = src.ieltsType ? graderType(src.ieltsType as IeltsItemType) : src.questionType;
      const matchingWithMappings = grader === 'MATCHING' && Array.isArray((v.answerKey as { mappings?: unknown[] } | null)?.mappings)
        && ((v.answerKey as { mappings?: unknown[] } | null)?.mappings?.length ?? 0) > 0;
      const storeAnswerKey = usesKey(grader) || grader === 'ORDERING' || matchingWithMappings;
      const storeOptions = !matchingWithMappings && !usesKey(grader);
      const questionId = randomUUID();
      const versionId = randomUUID();
      questionRows.push({ id: questionId, sectionId, questionType: grader, sequence: sequence++, sourceQuestionId: src.id, ieltsType: src.ieltsType });
      versionRows.push({
        id: versionId, questionId, version: 1, prompt: v.prompt as Prisma.InputJsonValue,
        answerKey: storeAnswerKey && v.answerKey ? (v.answerKey as Prisma.InputJsonValue) : Prisma.DbNull,
        marks: new Prisma.Decimal(Number(v.marks)), partialCredit: v.partialCredit ?? false,
      });
      if (storeOptions && v.options.length) {
        optionRows.push(...v.options.map((o, i) => ({ id: randomUUID(), questionVersionId: versionId, label: o.label, isCorrect: o.isCorrect, sequence: i })));
      }
      // A diagram/photo attached directly to this question (e.g. map labelling) must follow it into
      // the assessment copy — otherwise the student sees the question with no image at all.
      if (v.images.length) {
        imageRows.push(...v.images.map((img) => ({
          questionVersionId: versionId, fileKey: img.fileKey, fileMime: img.fileMime, altText: img.altText,
          width: img.width, height: img.height, sequence: img.sequence,
        })));
      }
      added++;
    }

    await this.prisma.$transaction(async (tx) => {
      if (questionRows.length) await tx.question.createMany({ data: questionRows });
      if (versionRows.length) await tx.questionVersion.createMany({ data: versionRows });
      if (optionRows.length) await tx.questionOption.createMany({ data: optionRows });
      if (imageRows.length) await tx.questionImage.createMany({ data: imageRows });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_QUESTIONS_FROM_BANK', entityType: 'AssessmentSection', entityId: sectionId, after: { count: added } }, tx);
    });
    return { added };
  }

  // ───────── student practice ─────────
  /**
   * Builds the sections and questions of a paper from bank questions. One section per source passage, and
   * every question is a copy that remembers its source. Shared by practice sessions and mock composition.
   */
  async buildPaper(tx: Prisma.TransactionClient, assessmentId: string, questionIds: string[], publish: boolean) {
    const sources = await tx.question.findMany({
      where: { id: { in: questionIds } },
      include: { questionSet: true, versions: { orderBy: { version: 'desc' }, take: 1, include: { options: { orderBy: { sequence: 'asc' } }, images: { orderBy: { sequence: 'asc' } } } } },
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
        const qv = await writeVersion(tx, q.id, 1, {
          prompt: v.prompt as Prisma.InputJsonValue, marks: Number(v.marks), answerKey: v.answerKey as Prisma.InputJsonValue | null,
          options: v.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })), grader, partialCredit: v.partialCredit,
        });
        // Same copy as copyIntoSection: a question's own image (e.g. a diagram-labelling figure) must
        // follow it into the built paper, or the student sees the question with no image at all.
        if (v.images.length) {
          await tx.questionImage.createMany({ data: v.images.map((img) => ({
            questionVersionId: qv.id, fileKey: img.fileKey, fileMime: img.fileMime, altText: img.altText,
            width: img.width, height: img.height, sequence: img.sequence,
          })) });
        }
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

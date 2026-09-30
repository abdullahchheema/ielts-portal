import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { randomUUID } from 'node:crypto';
import type {
  AssessmentSectionInput, BandTableInput, CreateAssessmentInput, QuestionInput, UpdateAssessmentInput, UpdateAssessmentSectionInput, UpdateQuestionInput,
} from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, notFound } from '../common/app-error';
import { Actor } from '../courses/courses.service';
import { StorageService, sniffFileType } from '../integrations/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionType, validateQuestionDefinition } from './grading';

type Tx = Prisma.TransactionClient;
const invalid = (field: string, msg: string) => new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { [field]: msg });
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const VERSION_FULL = {
  sections: {
    orderBy: [{ sequence: 'asc' }, { title: 'asc' }],
    include: {
      questions: {
        where: { deletedAt: null }, orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
        include: { versions: { include: { options: { orderBy: { sequence: 'asc' } } } } },
      },
    },
  },
} satisfies Prisma.AssessmentVersionInclude;

@Injectable()
export class AssessmentsAdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly storage: StorageService) {}

  // ───────── assessments ─────────
  list() {
    return this.prisma.assessment.findMany({
      orderBy: { createdAt: 'desc' },
      include: { versions: { select: { id: true, version: true, publishedAt: true }, orderBy: { version: 'desc' } }, _count: { select: { attempts: true } } },
    });
  }

  async get(id: string) {
    const a = await this.prisma.assessment.findUnique({ where: { id }, include: { versions: { orderBy: { version: 'desc' } }, _count: { select: { attempts: true } } } });
    if (!a) throw notFound('Assessment');
    return a;
  }

  async create(input: CreateAssessmentInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.assessment.create({ data: { ...input } });
      await tx.assessmentVersion.create({ data: { assessmentId: a.id, version: 1 } });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_CREATED', entityType: 'Assessment', entityId: a.id, after: a }, tx);
      return a;
    });
  }

  async update(id: string, input: UpdateAssessmentInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.assessment.findUnique({ where: { id } });
      if (!before) throw notFound('Assessment');
      const after = await tx.assessment.update({ where: { id }, data: input });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_UPDATED', entityType: 'Assessment', entityId: id, before, after }, tx);
      return after;
    });
  }

  async getVersion(versionId: string) {
    const v = await this.prisma.assessmentVersion.findUnique({ where: { id: versionId }, include: { assessment: true, ...VERSION_FULL } });
    if (!v) throw notFound('Assessment version');
    return {
      id: v.id, version: v.version, publishedAt: v.publishedAt, assessment: v.assessment,
      sections: v.sections.map((s) => ({
        id: s.id, title: s.title, sequence: s.sequence, content: s.content,
        questions: s.questions.map((q) => {
          const qv = q.versions[0];
          return { id: q.id, type: q.questionType, sequence: q.sequence, prompt: qv?.prompt, marks: qv?.marks, answerKey: qv?.answerKey, options: qv?.options.map((o) => ({ id: o.id, label: o.label, isCorrect: o.isCorrect })) ?? [] };
        }),
      })),
    };
  }

  private async assertDraft(tx: Tx | PrismaService, versionId: string) {
    const v = await tx.assessmentVersion.findUnique({ where: { id: versionId }, select: { publishedAt: true } });
    if (!v) throw notFound('Assessment version');
    if (v.publishedAt) throw new AppError('VERSION_PUBLISHED_IMMUTABLE', 409, 'Published versions are read-only. Create a new version to make changes.');
  }

  /** New draft version = deep copy of the latest one, so completed attempts keep pointing at frozen content. */
  async createVersion(assessmentId: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const versions = await tx.assessmentVersion.findMany({ where: { assessmentId }, orderBy: { version: 'desc' } });
      if (versions.length === 0) throw notFound('Assessment');
      if (versions.some((v) => !v.publishedAt)) throw new AppError('CONFLICT', 409, 'This assessment already has a draft version.');
      const src = await tx.assessmentVersion.findUniqueOrThrow({ where: { id: versions[0].id }, include: { sections: { include: { questions: { where: { deletedAt: null }, include: { versions: { include: { options: true } } } } } } } });
      const created = await tx.assessmentVersion.create({ data: { assessmentId, version: versions[0].version + 1 } });
      for (const s of src.sections) {
        const ns = await tx.assessmentSection.create({ data: { assessmentVersionId: created.id, title: s.title, sequence: s.sequence, content: (s.content ?? undefined) as Prisma.InputJsonValue | undefined } });
        for (const q of s.questions) {
          const qv = q.versions[0];
          const nq = await tx.question.create({ data: { sectionId: ns.id, questionType: q.questionType, sequence: q.sequence } });
          const nqv = await tx.questionVersion.create({ data: { questionId: nq.id, version: 1, prompt: qv.prompt as Prisma.InputJsonValue, answerKey: (qv.answerKey ?? undefined) as Prisma.InputJsonValue | undefined, marks: qv.marks } });
          if (qv.options.length) await tx.questionOption.createMany({ data: qv.options.map((o) => ({ questionVersionId: nqv.id, label: o.label, isCorrect: o.isCorrect, sequence: o.sequence })) });
        }
      }
      await this.audit.record({ ...actor, action: 'ASSESSMENT_VERSION_CREATED', entityType: 'AssessmentVersion', entityId: created.id, after: { assessmentId, version: created.version } }, tx);
      return created;
    });
  }

  async publishVersion(versionId: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDraft(tx, versionId);
      const v = await tx.assessmentVersion.findUniqueOrThrow({ where: { id: versionId }, include: VERSION_FULL });
      const questions = v.sections.flatMap((s) => s.questions);
      if (questions.length === 0) throw invalid('questions', 'Add at least one question before publishing.');
      for (const q of questions) {
        const qv = q.versions[0];
        const problems = validateQuestionDefinition({ type: q.questionType as QuestionType, options: qv.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })), answerKey: qv.answerKey as never });
        if (problems.length) throw invalid('questions', `“${(qv.prompt as { text?: string }).text?.slice(0, 40)}”: ${problems.join(' ')}`);
      }
      const published = await tx.assessmentVersion.update({ where: { id: versionId }, data: { publishedAt: new Date() } });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_VERSION_PUBLISHED', entityType: 'AssessmentVersion', entityId: versionId, after: { questions: questions.length } }, tx);
      return published;
    });
  }

  // ───────── sections ─────────
  async createSection(versionId: string, input: AssessmentSectionInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDraft(tx, versionId);
      const sequence = await tx.assessmentSection.count({ where: { assessmentVersionId: versionId } });
      const s = await tx.assessmentSection.create({ data: { assessmentVersionId: versionId, title: input.title, sequence, content: input.content as Prisma.InputJsonValue | undefined } });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_SECTION_CREATED', entityType: 'AssessmentSection', entityId: s.id }, tx);
      return s;
    });
  }

  async updateSection(id: string, input: UpdateAssessmentSectionInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.assessmentSection.findUnique({ where: { id } });
      if (!s) throw notFound('Section');
      await this.assertDraft(tx, s.assessmentVersionId);
      // Keep uploaded audio when only the passage/instructions change.
      const content = input.content ? { ...((s.content as object) ?? {}), ...input.content } : undefined;
      const after = await tx.assessmentSection.update({ where: { id }, data: { title: input.title, sequence: input.sequence, content: content as Prisma.InputJsonValue | undefined } });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_SECTION_UPDATED', entityType: 'AssessmentSection', entityId: id }, tx);
      return after;
    });
  }

  async deleteSection(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.assessmentSection.findUnique({ where: { id }, include: { questions: { include: { versions: true } } } });
      if (!s) throw notFound('Section');
      await this.assertDraft(tx, s.assessmentVersionId);
      for (const q of s.questions) await this.removeQuestion(tx, q.id);
      await tx.assessmentSection.delete({ where: { id } });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_SECTION_DELETED', entityType: 'AssessmentSection', entityId: id }, tx);
    });
  }

  /** Listening audio for a section. Content-sniffed like every other upload. */
  async attachAudio(sectionId: string, file: { buffer: Buffer; size: number; originalname: string } | undefined, actor: Actor) {
    if (!file) throw invalid('file', 'Attach an MP3 file.');
    if (file.size > MAX_AUDIO_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The audio file is larger than 100 MB.');
    const s = await this.prisma.assessmentSection.findUnique({ where: { id: sectionId } });
    if (!s) throw notFound('Section');
    await this.assertDraft(this.prisma, s.assessmentVersionId);
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed || sniffed.mime !== 'audio/mpeg') throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only MP3 audio is accepted.');
    const audioKey = `assessments/${s.assessmentVersionId}/${s.id}/${randomUUID()}.mp3`;
    await this.storage.put(audioKey, file.buffer, 'audio/mpeg');
    return this.prisma.$transaction(async (tx) => {
      const content = { ...((s.content as object) ?? {}), audioKey };
      await tx.assessmentSection.update({ where: { id: sectionId }, data: { content } });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_AUDIO_ATTACHED', entityType: 'AssessmentSection', entityId: sectionId, after: { audioKey } }, tx);
      return { ok: true };
    });
  }

  // ───────── questions ─────────
  private checkDefinition(input: { type: QuestionType; options?: { label: string; isCorrect: boolean }[]; answerKey?: { value?: string; accepted?: string[] } | null }) {
    const problems = validateQuestionDefinition({ type: input.type, options: input.options ?? [], answerKey: input.answerKey ?? null });
    if (problems.length) throw invalid('question', problems.join(' '));
  }

  async createQuestion(sectionId: string, input: QuestionInput, actor: Actor) {
    this.checkDefinition(input);
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.assessmentSection.findUnique({ where: { id: sectionId } });
      if (!s) throw notFound('Section');
      await this.assertDraft(tx, s.assessmentVersionId);
      const sequence = await tx.question.count({ where: { sectionId, deletedAt: null } });
      const q = await tx.question.create({ data: { sectionId, questionType: input.type, sequence } });
      const usesKey = ['TFNG', 'YNNG', 'COMPLETION'].includes(input.type);
      const qv = await tx.questionVersion.create({ data: { questionId: q.id, version: 1, prompt: input.prompt, marks: input.marks, answerKey: usesKey ? (input.answerKey as Prisma.InputJsonValue) : undefined } });
      if (!usesKey && input.options?.length) await tx.questionOption.createMany({ data: input.options.map((o, i) => ({ questionVersionId: qv.id, label: o.label, isCorrect: o.isCorrect, sequence: i })) });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_QUESTION_CREATED', entityType: 'Question', entityId: q.id }, tx);
      return { id: q.id };
    });
  }

  async updateQuestion(id: string, input: UpdateQuestionInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const q = await tx.question.findFirst({ where: { id, deletedAt: null }, include: { section: true, versions: { include: { options: { orderBy: { sequence: 'asc' } } } } } });
      if (!q || !q.section) throw notFound('Question');
      await this.assertDraft(tx, q.section.assessmentVersionId);
      const qv = q.versions[0];
      const type = (input.type ?? q.questionType) as QuestionType;
      const merged = {
        type,
        options: input.options ?? qv.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
        answerKey: (input.answerKey ?? (qv.answerKey as { value?: string; accepted?: string[] } | null)) ?? null,
      };
      this.checkDefinition(merged);
      const usesKey = ['TFNG', 'YNNG', 'COMPLETION'].includes(type);
      await tx.question.update({ where: { id }, data: { questionType: type } });
      await tx.questionVersion.update({ where: { id: qv.id }, data: { prompt: input.prompt ?? undefined, marks: input.marks, answerKey: usesKey ? (merged.answerKey as Prisma.InputJsonValue) : Prisma.DbNull } });
      await tx.questionOption.deleteMany({ where: { questionVersionId: qv.id } });
      if (!usesKey) await tx.questionOption.createMany({ data: merged.options.map((o, i) => ({ questionVersionId: qv.id, label: o.label, isCorrect: o.isCorrect, sequence: i })) });
      await this.audit.record({ ...actor, action: 'ASSESSMENT_QUESTION_UPDATED', entityType: 'Question', entityId: id }, tx);
      return { id };
    });
  }

  async deleteQuestion(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const q = await tx.question.findFirst({ where: { id, deletedAt: null }, include: { section: true } });
      if (!q || !q.section) throw notFound('Question');
      await this.assertDraft(tx, q.section.assessmentVersionId);
      await this.removeQuestion(tx, id);
      await this.audit.record({ ...actor, action: 'ASSESSMENT_QUESTION_DELETED', entityType: 'Question', entityId: id }, tx);
    });
  }

  private async removeQuestion(tx: Tx, questionId: string) {
    const versions = await tx.questionVersion.findMany({ where: { questionId }, select: { id: true } });
    const ids = versions.map((v) => v.id);
    await tx.questionOption.deleteMany({ where: { questionVersionId: { in: ids } } });
    await tx.questionVersion.deleteMany({ where: { questionId } });
    await tx.question.delete({ where: { id: questionId } });
  }

  // ───────── band conversion ─────────
  async listBandTables() {
    const rows = await this.prisma.bandConversionTable.findMany({ orderBy: [{ testType: 'asc' }, { version: 'desc' }, { rawMin: 'desc' }] });
    const byType: Record<string, { version: number; effectiveDate: Date; rows: { rawMin: number; rawMax: number; band: string }[] }[]> = {};
    for (const r of rows) {
      const list = (byType[r.testType] ??= []);
      let v = list.find((x) => x.version === r.version);
      if (!v) list.push((v = { version: r.version, effectiveDate: r.effectiveDate, rows: [] }));
      v.rows.push({ rawMin: r.rawMin, rawMax: r.rawMax, band: r.band.toString() });
    }
    return byType;
  }

  /** Publishes a new version of a conversion table. Old versions are kept so past scores stay explainable. */
  async saveBandTable(input: BandTableInput, actor: Actor) {
    const covered = new Array<number>(41).fill(0);
    for (const r of input.rows) {
      if (r.rawMin > r.rawMax) throw invalid('rows', `Row ${r.rawMin}-${r.rawMax} has min above max.`);
      for (let i = r.rawMin; i <= r.rawMax; i++) covered[i]++;
    }
    const gap = covered.findIndex((c) => c === 0);
    const overlap = covered.findIndex((c) => c > 1);
    if (gap !== -1) throw invalid('rows', `Raw score ${gap} is not covered.`);
    if (overlap !== -1) throw invalid('rows', `Raw score ${overlap} is covered more than once.`);

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.bandConversionTable.aggregate({ where: { testType: input.testType }, _max: { version: true } });
      const version = (latest._max.version ?? 0) + 1;
      await tx.bandConversionTable.createMany({ data: input.rows.map((r) => ({ testType: input.testType, rawMin: r.rawMin, rawMax: r.rawMax, band: r.band, version, effectiveDate: new Date() })) });
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_BAND_CONVERSION', entityType: 'BandConversionTable', entityId: input.testType, after: { version, rows: input.rows.length } }, tx);
      return { testType: input.testType, version };
    });
  }
}

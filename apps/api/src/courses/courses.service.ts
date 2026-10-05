import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import type {
  CreateCourseInput, CreateItemInput, CreateSectionInput, UpdateCourseInput, UpdateItemInput, UpdateSectionInput,
} from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, notFound } from '../common/app-error';
import { StorageService, sniffFileType } from '../integrations/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export const MAX_CONTENT_FILE_BYTES = 50 * 1024 * 1024;

export interface Actor { userId: string; ip?: string; userAgent?: string }

const TREE_INCLUDE = {
  sections: {
    orderBy: [{ sequence: 'asc' }, { title: 'asc' }],
    include: { items: { orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }] } },
  },
} satisfies Prisma.CourseVersionInclude;

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly storage: StorageService) {}

  // ───────── courses ─────────
  listAdmin() {
    return this.prisma.course.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { versions: { select: { id: true, versionNumber: true, status: true }, orderBy: { versionNumber: 'desc' } } },
    });
  }

  /** The academy's one live course with all its versions (404 if none has been created yet). */
  async getMain() {
    const found = await this.prisma.course.findFirst({ where: { deletedAt: null, status: { not: 'ARCHIVED' } }, include: { versions: { orderBy: { versionNumber: 'desc' } } } });
    if (!found) throw notFound('Course');
    return found;
  }

  async getAdmin(id: string) {
    const course = await this.prisma.course.findFirst({
      where: { id, deletedAt: null },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    });
    if (!course) throw notFound('Course');
    return course;
  }

  async create(input: CreateCourseInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      // The academy sells one course. (A database index enforces this too.)
      const existing = await tx.course.findFirst({ where: { deletedAt: null, status: { not: 'ARCHIVED' } } });
      if (existing) throw conflict('CONFLICT', 'The academy already has its course. Edit it instead of creating another.');
      const course = await tx.course
        .create({ data: input })
        .catch((e) => {
          if (e?.code === 'P2002') throw conflict('CONFLICT', 'A course with this code or slug already exists.');
          throw e;
        });
      // Every course starts with an empty draft version 1 so content can be built immediately.
      await tx.courseVersion.create({ data: { courseId: course.id, versionNumber: 1 } });
      await this.audit.record({ ...actor, action: 'COURSE_CREATED', entityType: 'Course', entityId: course.id, after: course }, tx);
      return course;
    });
  }

  async update(id: string, input: UpdateCourseInput, actor: Actor) {
    const before = await this.prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Course');

    if (input.status === 'PUBLISHED') {
      const published = await this.prisma.courseVersion.count({ where: { courseId: id, status: 'PUBLISHED' } });
      if (!published) throw new AppError('COURSE_UNPUBLISHED', 409, 'Publish a course version before listing the course for sale.');
    }

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.course.update({ where: { id }, data: input }).catch((e) => {
        if (e?.code === 'P2002') throw conflict('CONFLICT', 'A course with this code or slug already exists.');
        throw e;
      });
      await this.audit.record({ ...actor, action: 'COURSE_UPDATED', entityType: 'Course', entityId: id, before, after }, tx);
      return after;
    });
  }


  // ───────── versions ─────────
  /** Creates the next draft version, cloning the tree from `cloneFromVersionId` (default: latest version). */
  async createVersion(courseId: string, cloneFromVersionId: string | undefined, actor: Actor) {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) throw notFound('Course');

    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.courseVersion.findFirst({ where: { courseId, status: 'DRAFT' } });
      if (draft) throw conflict('CONFLICT', 'This course already has a draft version. Publish or discard it first.');

      const latest = await tx.courseVersion.findFirst({ where: { courseId }, orderBy: { versionNumber: 'desc' } });
      const source = cloneFromVersionId
        ? await tx.courseVersion.findFirst({ where: { id: cloneFromVersionId, courseId } })
        : latest;
      if (cloneFromVersionId && !source) throw notFound('Source version');

      const version = await tx.courseVersion.create({
        data: { courseId, versionNumber: (latest?.versionNumber ?? 0) + 1 },
      });
      if (source) await this.cloneTree(tx, source.id, version.id);

      await this.audit.record(
        { ...actor, action: 'COURSE_VERSION_CREATED', entityType: 'CourseVersion', entityId: version.id, after: { courseId, from: source?.id } },
        tx,
      );
      return version;
    }, { timeout: 20_000, maxWait: 10_000 });
  }

  private async cloneTree(tx: Prisma.TransactionClient, fromVersionId: string, toVersionId: string) {
    const sections = await tx.courseSection.findMany({ where: { courseVersionId: fromVersionId }, include: { items: true } });
    const sectionMap = new Map<string, string>();
    const itemMap = new Map<string, string>();

    // Parents first so parentSectionId can be remapped.
    const byParent = (parent: string | null) => sections.filter((s) => s.parentSectionId === parent);
    const walk = async (parent: string | null, newParent: string | null) => {
      for (const s of byParent(parent)) {
        const created = await tx.courseSection.create({
          data: {
            courseVersionId: toVersionId, parentSectionId: newParent, title: s.title,
            description: s.description, sequence: s.sequence, status: s.status,
          },
        });
        sectionMap.set(s.id, created.id);
        for (const i of s.items) {
          const item = await tx.contentItem.create({
            data: {
              sectionId: created.id, title: i.title, contentType: i.contentType, sequence: i.sequence,
              isRequired: i.isRequired, estimatedMinutes: i.estimatedMinutes, releaseType: i.releaseType,
              releaseValue: i.releaseValue ?? undefined, status: i.status, metadataJson: i.metadataJson ?? undefined,
            },
          });
          itemMap.set(i.id, item.id);
        }
        await walk(s.id, created.id);
      }
    };
    await walk(null, null);

    // Prerequisites point at item ids — remap them to the cloned items.
    for (const [oldId, newId] of itemMap) {
      const item = await tx.contentItem.findUniqueOrThrow({ where: { id: newId } });
      const rv = item.releaseValue as { requiredItemId?: string } | null;
      if (item.releaseType === 'PREREQUISITE' && rv?.requiredItemId) {
        const mapped = itemMap.get(rv.requiredItemId);
        await tx.contentItem.update({ where: { id: newId }, data: { releaseValue: { ...rv, requiredItemId: mapped ?? null } } });
      }
      void oldId;
    }
  }

  async publishVersion(versionId: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.courseVersion.findUnique({ where: { id: versionId } });
      if (!version) throw notFound('Course version');
      if (version.status !== 'DRAFT') throw new AppError('VERSION_PUBLISHED_IMMUTABLE', 409, 'Only a draft version can be published.');

      const items = await tx.contentItem.count({ where: { section: { courseVersionId: versionId }, status: 'PUBLISHED' } });
      if (!items) throw new AppError('VALIDATION_ERROR', 422, 'Add at least one published content item before publishing.');

      await tx.courseVersion.updateMany({
        where: { courseId: version.courseId, status: 'PUBLISHED' },
        data: { status: 'RETIRED' },
      });
      const published = await tx.courseVersion.update({
        where: { id: versionId },
        data: { status: 'PUBLISHED', publishedAt: new Date(), revision: { increment: 1 } },
      });
      await this.audit.record(
        { ...actor, action: 'COURSE_VERSION_PUBLISHED', entityType: 'CourseVersion', entityId: versionId, before: version, after: published },
        tx,
      );
      return published;
    });
  }

  async tree(versionId: string) {
    const version = await this.prisma.courseVersion.findUnique({ where: { id: versionId }, include: TREE_INCLUDE });
    if (!version) throw notFound('Course version');
    return { ...version, sections: this.nest(version.sections) };
  }

  private nest<T extends { id: string; parentSectionId: string | null }>(flat: T[]): (T & { children: unknown[] })[] {
    const nodes = new Map(flat.map((s) => [s.id, { ...s, children: [] as unknown[] }]));
    const roots: (T & { children: unknown[] })[] = [];
    for (const n of nodes.values()) {
      const parent = n.parentSectionId ? nodes.get(n.parentSectionId) : undefined;
      (parent ? parent.children : roots).push(n);
    }
    return roots;
  }

  /** Throws unless the version is a DRAFT; published/retired versions are immutable. */
  private async assertDraft(tx: Prisma.TransactionClient | PrismaService, versionId: string) {
    const v = await tx.courseVersion.findUnique({ where: { id: versionId }, select: { status: true } });
    if (!v) throw notFound('Course version');
    if (v.status !== 'DRAFT') {
      throw new AppError('VERSION_PUBLISHED_IMMUTABLE', 409, 'Published versions cannot be edited. Create a new version instead.');
    }
  }

  // ───────── sections ─────────
  async createSection(versionId: string, input: CreateSectionInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDraft(tx, versionId);
      if (input.parentSectionId) {
        const parent = await tx.courseSection.findFirst({ where: { id: input.parentSectionId, courseVersionId: versionId } });
        if (!parent) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { parentSectionId: 'Parent section not found in this version.' });
      }
      const sequence = input.sequence ?? (await tx.courseSection.count({ where: { courseVersionId: versionId, parentSectionId: input.parentSectionId ?? null } }));
      const section = await tx.courseSection.create({
        data: { courseVersionId: versionId, parentSectionId: input.parentSectionId ?? null, title: input.title, description: input.description, sequence },
      });
      await this.audit.record({ ...actor, action: 'SECTION_CREATED', entityType: 'CourseSection', entityId: section.id, after: section }, tx);
      return section;
    });
  }

  async updateSection(id: string, input: UpdateSectionInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.courseSection.findUnique({ where: { id } });
      if (!before) throw notFound('Section');
      await this.assertDraft(tx, before.courseVersionId);

      if (input.parentSectionId !== undefined && input.parentSectionId !== before.parentSectionId) {
        await this.assertNoCycle(tx, id, input.parentSectionId, before.courseVersionId);
      }
      const after = await tx.courseSection.update({ where: { id }, data: input });
      await this.audit.record({ ...actor, action: 'SECTION_UPDATED', entityType: 'CourseSection', entityId: id, before, after }, tx);
      return after;
    });
  }

  private async assertNoCycle(tx: Prisma.TransactionClient, sectionId: string, newParentId: string | null | undefined, versionId: string) {
    let cursor = newParentId ?? null;
    while (cursor) {
      if (cursor === sectionId) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { parentSectionId: 'A section cannot be moved inside itself.' });
      const p = await tx.courseSection.findFirst({ where: { id: cursor, courseVersionId: versionId }, select: { parentSectionId: true } });
      if (!p) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { parentSectionId: 'Parent section not found in this version.' });
      cursor = p.parentSectionId;
    }
  }

  async deleteSection(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const section = await tx.courseSection.findUnique({ where: { id } });
      if (!section) throw notFound('Section');
      await this.assertDraft(tx, section.courseVersionId);

      // Collect the subtree, then delete leaves first (no cascade in schema; drafts have no learner progress).
      const ids: string[] = [id];
      for (let i = 0; i < ids.length; i++) {
        const kids = await tx.courseSection.findMany({ where: { parentSectionId: ids[i] }, select: { id: true } });
        ids.push(...kids.map((k) => k.id));
      }
      await tx.contentItem.deleteMany({ where: { sectionId: { in: ids } } });
      for (const sid of ids.reverse()) await tx.courseSection.delete({ where: { id: sid } });
      await this.audit.record({ ...actor, action: 'SECTION_DELETED', entityType: 'CourseSection', entityId: id, before: section }, tx);
    });
  }

  async reorderSections(versionId: string, ids: string[], actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDraft(tx, versionId);
      const found = await tx.courseSection.count({ where: { id: { in: ids }, courseVersionId: versionId } });
      if (found !== ids.length) throw new AppError('VALIDATION_ERROR', 422, 'Some sections do not belong to this version.');
      await Promise.all(ids.map((sid, sequence) => tx.courseSection.update({ where: { id: sid }, data: { sequence } })));
      await this.audit.record({ ...actor, action: 'SECTIONS_REORDERED', entityType: 'CourseVersion', entityId: versionId, after: { ids } }, tx);
    });
  }

  // ───────── content items ─────────
  async createItem(sectionId: string, input: CreateItemInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const section = await tx.courseSection.findUnique({ where: { id: sectionId } });
      if (!section) throw notFound('Section');
      await this.assertDraft(tx, section.courseVersionId);
      await this.assertRelease(tx, section.courseVersionId, input.releaseType, input.releaseValue);

      const sequence = input.sequence ?? (await tx.contentItem.count({ where: { sectionId } }));
      const item = await tx.contentItem.create({
        data: {
          sectionId, title: input.title, contentType: input.contentType, sequence, isRequired: input.isRequired,
          estimatedMinutes: input.estimatedMinutes, releaseType: input.releaseType,
          releaseValue: (input.releaseValue ?? undefined) as Prisma.InputJsonValue | undefined,
          status: input.status, metadataJson: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await this.audit.record({ ...actor, action: 'CONTENT_ITEM_CREATED', entityType: 'ContentItem', entityId: item.id, after: item }, tx);
      return item;
    });
  }

  async updateItem(id: string, input: UpdateItemInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.contentItem.findUnique({ where: { id }, include: { section: true } });
      if (!before) throw notFound('Content item');
      await this.assertDraft(tx, before.section.courseVersionId);

      const releaseType = input.releaseType ?? before.releaseType;
      const releaseValue = input.releaseValue ?? (before.releaseValue as never);
      await this.assertRelease(tx, before.section.courseVersionId, releaseType, releaseValue, id);

      const { metadata, releaseValue: rv, ...rest } = input;
      const after = await tx.contentItem.update({
        where: { id },
        data: {
          ...rest,
          ...(rv !== undefined ? { releaseValue: rv as Prisma.InputJsonValue } : {}),
          ...(metadata !== undefined ? { metadataJson: metadata as Prisma.InputJsonValue } : {}),
        },
      });
      const { section: _s, ...beforeItem } = before;
      await this.audit.record({ ...actor, action: 'CONTENT_ITEM_UPDATED', entityType: 'ContentItem', entityId: id, before: beforeItem, after }, tx);
      return after;
    });
  }

  async deleteItem(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.contentItem.findUnique({ where: { id }, include: { section: true } });
      if (!before) throw notFound('Content item');
      await this.assertDraft(tx, before.section.courseVersionId);
      await tx.contentItem.delete({ where: { id } });
      const { section: _s, ...beforeItem } = before;
      await this.audit.record({ ...actor, action: 'CONTENT_ITEM_DELETED', entityType: 'ContentItem', entityId: id, before: beforeItem }, tx);
    });
  }

  async reorderItems(sectionId: string, ids: string[], actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const section = await tx.courseSection.findUnique({ where: { id: sectionId } });
      if (!section) throw notFound('Section');
      await this.assertDraft(tx, section.courseVersionId);
      const found = await tx.contentItem.count({ where: { id: { in: ids }, sectionId } });
      if (found !== ids.length) throw new AppError('VALIDATION_ERROR', 422, 'Some items do not belong to this section.');
      await Promise.all(ids.map((iid, sequence) => tx.contentItem.update({ where: { id: iid }, data: { sequence } })));
      await this.audit.record({ ...actor, action: 'ITEMS_REORDERED', entityType: 'CourseSection', entityId: sectionId, after: { ids } }, tx);
    });
  }

  /** Attaches an uploaded PDF/audio/image to a draft content item. Content is sniffed, never trusted by name or MIME. */
  async attachFile(itemId: string, file: { buffer: Buffer; size: number; originalname: string } | undefined, actor: Actor) {
    if (!file) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { file: 'Attach a file.' });
    if (file.size > MAX_CONTENT_FILE_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'The file is larger than 50 MB.');

    const item = await this.prisma.contentItem.findUnique({ where: { id: itemId }, include: { section: true } });
    if (!item) throw notFound('Content item');
    await this.assertDraft(this.prisma, item.section.courseVersionId);

    const allowed: Record<string, string[]> = { PDF: ['application/pdf'], AUDIO: ['audio/mpeg'], DOWNLOAD: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] };
    const mimes = allowed[item.contentType];
    if (!mimes) throw new AppError('VALIDATION_ERROR', 422, 'This item type does not take a file.', { contentType: item.contentType });
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed || !mimes.includes(sniffed.mime)) throw new AppError('UNSUPPORTED_FILE_TYPE', 415, `${item.contentType} items accept: ${mimes.join(', ')}.`);

    const fileKey = `content/${item.section.courseVersionId}/${item.id}/${randomUUID()}.${sniffed.ext}`;
    await this.storage.put(fileKey, file.buffer, sniffed.mime);
    // Display name only (the stored key is generated): strip any path and unsafe characters.
    const fileName = file.originalname.replace(/^.*[\\/]/, '').replace(/[^\w. -]/g, '_').slice(0, 100) || `file.${sniffed.ext}`;

    return this.prisma.$transaction(async (tx) => {
      const before = item.metadataJson;
      const after = await tx.contentItem.update({
        where: { id: itemId },
        data: { metadataJson: { ...((before as object) ?? {}), fileKey, fileName, fileMime: sniffed.mime } },
      });
      await this.audit.record({ ...actor, action: 'CONTENT_FILE_ATTACHED', entityType: 'ContentItem', entityId: itemId, before, after: { fileKey, fileName } }, tx);
      return { id: after.id, fileName, fileMime: sniffed.mime };
    });
  }

  private async assertRelease(
    tx: Prisma.TransactionClient, versionId: string, type: string,
    value?: { date?: string; days?: number; requiredItemId?: string } | null, selfId?: string,
  ) {
    const bad = (field: string, msg: string) => new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { [field]: msg });
    if (type === 'BATCH_DATE' && !value?.date) throw bad('releaseValue', 'BATCH_DATE needs a date.');
    if (type === 'RELATIVE' && value?.days == null) throw bad('releaseValue', 'RELATIVE needs a number of days.');
    if (type === 'SCORE_BASED') {
      if (!value?.requiredItemId) throw bad('releaseValue', 'SCORE_BASED needs requiredItemId (the test item to score on).');
      if (typeof (value as { minScorePercent?: number }).minScorePercent !== 'number') throw bad('releaseValue', 'SCORE_BASED needs minScorePercent.');
      if (value.requiredItemId === selfId) throw bad('releaseValue', 'An item cannot require itself.');
      const req = await tx.contentItem.findFirst({ where: { id: value.requiredItemId, section: { courseVersionId: versionId } } });
      if (!req) throw bad('releaseValue', 'Required item not found in this version.');
    }
    if (type === 'PREREQUISITE') {
      if (!value?.requiredItemId) throw bad('releaseValue', 'PREREQUISITE needs requiredItemId.');
      if (value.requiredItemId === selfId) throw bad('releaseValue', 'An item cannot require itself.');
      const req = await tx.contentItem.findFirst({ where: { id: value.requiredItemId, section: { courseVersionId: versionId } } });
      if (!req) throw bad('releaseValue', 'Required item not found in this version.');
    }
  }
}

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContentType, Enrollment, Prisma, ProgressStatus } from '@ielts/db';
import { LIFECYCLE_SIGNAL } from '../student-lifecycle/lifecycle.service';
import { z } from 'zod';
import { studentProfileSchema } from '@ielts/validation';
import { AppError, notFound } from '../common/app-error';
import { ieltsSummary } from '../common/ielts';
import { StorageService } from '../integrations/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReleaseState, evaluateRelease, progressPercent } from './release';

/** Item types a learner can finish by simply consuming them. Tests/assignments complete via the assessment engine (later pass). */
const SELF_COMPLETABLE: ReadonlySet<ContentType> = new Set(['TEXT', 'VIDEO', 'PDF', 'AUDIO', 'DOWNLOAD', 'EXTERNAL_LINK']);
const SKILLS = ['listening', 'reading', 'writing', 'speaking'] as const;
const MAX_TIME_DELTA_SEC = 300; // per call — stops a client inflating time-on-task

export const progressBodySchema = z.object({
  progressPercent: z.number().int().min(0).max(100).optional(),
  lastPosition: z.number().int().min(0).max(1_000_000).optional(),
  timeSpentSeconds: z.number().int().min(0).max(MAX_TIME_DELTA_SEC).optional(),
});
export type ProgressBody = z.infer<typeof progressBodySchema>;

export interface SectionNode {
  id: string; title: string; description: string | null; sequence: number; parentSectionId: string | null;
  items: Array<{
    id: string; title: string; contentType: ContentType; isRequired: boolean; estimatedMinutes: number | null;
    state: ItemState; progressPercent: number; lock?: Omit<Extract<ReleaseState, { unlocked: false }>, 'unlocked'>;
  }>;
  children: SectionNode[];
  totals: { required: number; completedRequired: number };
}

type ItemState = 'LOCKED' | 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

@Injectable()
export class LearningService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly events: EventEmitter2) {}

  // ───────── access ─────────
  /** Enrollment must be ACTIVE/COMPLETED and inside its access window. Throws a specific error otherwise. */
  private assertAccess(e: Pick<Enrollment, 'status' | 'accessStartsAt' | 'accessEndsAt'>, now = new Date()) {
    if (e.status === 'EXPIRED') throw new AppError('ACCESS_EXPIRED', 403, 'Your access to this course has expired.');
    if (e.status === 'PENDING_PAYMENT') throw new AppError('PAYMENT_PENDING', 403, 'Your payment is still being verified. The course opens as soon as it is confirmed.');
    if (e.status !== 'ACTIVE' && e.status !== 'COMPLETED') throw new AppError('ACCESS_DENIED', 403, 'Your enrollment is not active.');
    if (e.accessStartsAt && e.accessStartsAt > now) throw new AppError('ACCESS_DENIED', 403, 'Your access has not started yet.');
    if (e.accessEndsAt && e.accessEndsAt <= now) throw new AppError('ACCESS_EXPIRED', 403, 'Your access to this course has expired.');
  }

  private async ownEnrollment(studentId: string, enrollmentId: string) {
    const e = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, studentId, deletedAt: null },
      include: { batch: { select: { startAt: true, name: true } }, course: { select: { title: true, slug: true } } },
    });
    if (!e) throw notFound('Enrollment');
    return e;
  }

  // ───────── enrollments / course tree ─────────
  async listEnrollments(studentId: string) {
    const rows = await this.prisma.enrollment.findMany({
      where: { studentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { course: { select: { title: true, slug: true } }, batch: { select: { id: true, name: true, startAt: true } } },
    });
    return rows.map((e) => ({
      id: e.id, status: e.status, progressPercent: e.progressPercent, enrolledAt: e.enrolledAt,
      accessStartsAt: e.accessStartsAt, accessEndsAt: e.accessEndsAt, course: e.course, batch: e.batch,
    }));
  }

  async getCourse(studentId: string, enrollmentId: string) {
    const enrollment = await this.ownEnrollment(studentId, enrollmentId);
    this.assertAccess(enrollment);
    const state = await this.courseState(enrollment);
    return {
      enrollment: { id: enrollment.id, status: enrollment.status, progressPercent: enrollment.progressPercent, accessEndsAt: enrollment.accessEndsAt },
      course: enrollment.course, batch: enrollment.batch, sections: state.tree,
    };
  }

  /** Builds the section/item tree with per-item lock state and progress for one enrollment. */
  private async courseState(enrollment: Pick<Enrollment, 'id' | 'courseVersionId' | 'studentId'> & { batch: { startAt: Date } }) {
    const [sections, progressRows] = await Promise.all([
      this.prisma.courseSection.findMany({
        where: { courseVersionId: enrollment.courseVersionId, status: 'PUBLISHED' },
        orderBy: [{ sequence: 'asc' }, { title: 'asc' }],
        include: { items: { where: { status: 'PUBLISHED' }, orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }] } },
      }),
      this.prisma.contentProgress.findMany({ where: { enrollmentId: enrollment.id } }),
    ]);
    const progress = new Map(progressRows.map((p) => [p.contentItemId, p]));
    const completed = new Set(progressRows.filter((p) => p.status === 'COMPLETED').map((p) => p.contentItemId));
    const published = new Set(sections.flatMap((s) => s.items.map((i) => i.id)));
    const bestScores = await this.bestScores(enrollment.studentId, sections.flatMap((s) => s.items));
    const now = new Date();

    const nodes = new Map<string, SectionNode>();
    for (const s of sections) {
      nodes.set(s.id, {
        id: s.id, title: s.title, description: s.description, sequence: s.sequence, parentSectionId: s.parentSectionId,
        items: s.items.map((i) => {
          const release = evaluateRelease({ releaseType: i.releaseType, releaseValue: i.releaseValue }, {
            now, batchStartAt: enrollment.batch.startAt, completedItemIds: completed, publishedItemIds: published, bestScorePercentByItemId: bestScores,
          });
          const p = progress.get(i.id);
          const done = p?.status === 'COMPLETED';
          // A completed item stays visibly completed even if its release rule later changes.
          const state: ItemState = done ? 'COMPLETED' : !release.unlocked ? 'LOCKED' : p?.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'NOT_STARTED';
          const lock = !release.unlocked && !done ? { code: release.code, reason: release.reason, availableAt: release.availableAt, requiredItemId: release.requiredItemId } : undefined;
          return {
            id: i.id, title: i.title, contentType: i.contentType, isRequired: i.isRequired, estimatedMinutes: i.estimatedMinutes,
            state, progressPercent: p?.progressPercent ?? 0, lock,
          };
        }),
        children: [], totals: { required: 0, completedRequired: 0 },
      });
    }
    const roots: SectionNode[] = [];
    for (const n of nodes.values()) {
      const parent = n.parentSectionId ? nodes.get(n.parentSectionId) : undefined;
      (parent ? parent.children : roots).push(n);
    }
    const sum = (n: SectionNode) => {
      let required = n.items.filter((i) => i.isRequired).length;
      let done = n.items.filter((i) => i.isRequired && i.state === 'COMPLETED').length;
      for (const c of n.children) { const t = sum(c); required += t.required; done += t.completedRequired; }
      n.totals = { required, completedRequired: done };
      return n.totals;
    };
    roots.forEach(sum);
    return { tree: roots, published };
  }

  // ───────── single item ─────────
  /** Resolves an item + the student's enrollment for it, enforcing enrollment access, publication and release rules. */
  private async resolveItem(studentId: string, itemId: string) {
    const item = await this.prisma.contentItem.findUnique({ where: { id: itemId }, include: { section: true } });
    if (!item) throw new AppError('CONTENT_NOT_FOUND', 404, 'Content not found.');

    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId, courseVersionId: item.section.courseVersionId, deletedAt: null },
      include: { batch: { select: { startAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // Not enrolled in this version: indistinguishable from "does not exist" so ids cannot be probed.
    if (enrollments.length === 0) throw new AppError('CONTENT_NOT_FOUND', 404, 'Content not found.');
    const enrollment = enrollments.find((e) => e.status === 'ACTIVE' || e.status === 'COMPLETED') ?? enrollments[0];
    this.assertAccess(enrollment);

    if (item.status !== 'PUBLISHED' || item.section.status !== 'PUBLISHED') throw new AppError('CONTENT_UNPUBLISHED', 404, 'This content is not available.');

    const [completedRows, publishedRows] = await Promise.all([
      this.prisma.contentProgress.findMany({ where: { enrollmentId: enrollment.id, status: 'COMPLETED' }, select: { contentItemId: true } }),
      this.prisma.contentItem.findMany({ where: { status: 'PUBLISHED', section: { courseVersionId: item.section.courseVersionId, status: 'PUBLISHED' } }, select: { id: true, metadataJson: true } }),
    ]);
    const bestScores = await this.bestScores(studentId, publishedRows);
    const release = evaluateRelease({ releaseType: item.releaseType, releaseValue: item.releaseValue }, {
      now: new Date(), batchStartAt: enrollment.batch.startAt,
      completedItemIds: new Set(completedRows.map((r) => r.contentItemId)), publishedItemIds: new Set(publishedRows.map((r) => r.id)), bestScorePercentByItemId: bestScores,
    });
    if (!release.unlocked) {
      throw new AppError(release.code, 403, release.reason, { availableAt: release.availableAt?.toISOString(), requiredItemId: release.requiredItemId });
    }
    return { item, enrollment };
  }

  /** Access + release check for an item, for other modules (assessments). Throws the specific reason if closed. */
  assertItemAccess(studentId: string, itemId: string) {
    return this.resolveItem(studentId, itemId);
  }

  /** Best submitted percentage per content item that links to an assessment. */
  private async bestScores(studentId: string, items: { id: string; metadataJson: unknown }[]): Promise<Map<string, number>> {
    const byAssessment = new Map<string, string[]>();
    for (const i of items) {
      const aid = (i.metadataJson as { assessmentId?: unknown } | null)?.assessmentId;
      if (typeof aid === 'string') byAssessment.set(aid, [...(byAssessment.get(aid) ?? []), i.id]);
    }
    const out = new Map<string, number>();
    if (byAssessment.size === 0) return out;
    const rows = await this.prisma.assessmentAttempt.groupBy({
      by: ['assessmentId'], where: { studentId, assessmentId: { in: [...byAssessment.keys()] }, submittedAt: { not: null }, percent: { not: null } }, _max: { percent: true },
    });
    for (const r of rows) for (const itemId of byAssessment.get(r.assessmentId) ?? []) out.set(itemId, Number(r._max.percent));
    return out;
  }

  /** Marks an item completed as a side effect of something else (a passed assessment) and refreshes course progress. */
  async markCompletedBySystem(studentId: string, enrollmentId: string, itemId: string) {
    const now = new Date();
    await this.prisma.contentProgress.upsert({
      where: { studentId_enrollmentId_contentItemId: { studentId, enrollmentId, contentItemId: itemId } },
      create: { studentId, enrollmentId, contentItemId: itemId, status: 'COMPLETED', progressPercent: 100, startedAt: now, completedAt: now },
      update: { status: 'COMPLETED', progressPercent: 100, completedAt: now },
    });
    return this.recalculateEnrollment(enrollmentId, studentId);
  }

  async openItem(studentId: string, itemId: string) {
    const { item, enrollment } = await this.resolveItem(studentId, itemId);
    const meta = (item.metadataJson ?? {}) as { body?: string; url?: string; fileKey?: string; fileName?: string; assessmentId?: string };
    const progress = await this.prisma.contentProgress.findUnique({
      where: { studentId_enrollmentId_contentItemId: { studentId, enrollmentId: enrollment.id, contentItemId: itemId } },
    });

    // Tests/quizzes: summarise the student's attempts so the UI can offer Start / Resume / Review.
    let assessment: Record<string, unknown> | undefined;
    if (typeof meta.assessmentId === 'string') {
      const a = await this.prisma.assessment.findUnique({ where: { id: meta.assessmentId }, include: { versions: { where: { publishedAt: { not: null } }, take: 1 } } });
      if (a && a.versions.length) {
        const attempts = await this.prisma.assessmentAttempt.findMany({
          where: { assessmentId: a.id, studentId, status: { not: 'INVALIDATED' } }, orderBy: { attemptNumber: 'desc' },
          select: { id: true, status: true, percent: true, bandScore: true, attemptNumber: true },
        });
        const done = attempts.filter((t) => t.status !== 'IN_PROGRESS');
        assessment = {
          id: a.id, title: a.title, type: a.type, skill: a.skill, timeLimitMin: a.timeLimitMin, maxAttempts: a.maxAttempts, passPercent: a.passPercent,
          attemptsUsed: attempts.length, inProgressAttemptId: attempts.find((t) => t.status === 'IN_PROGRESS')?.id ?? null,
          latestAttemptId: done[0]?.id ?? null,
          bestPercent: done.length ? Math.max(...done.map((t) => Number(t.percent ?? 0))) : null,
          bestBand: done.some((t) => t.bandScore !== null) ? Math.max(...done.map((t) => Number(t.bandScore ?? 0))) : null,
        };
      }
    }
    // Writing / speaking tasks: what to submit, the criteria it is marked on, and the student's submissions so far.
    let assignment: Record<string, unknown> | undefined;
    const asg = await this.prisma.assignment.findUnique({ where: { contentItemId: itemId }, include: { rubric: { include: { criteria: { orderBy: { sequence: 'asc' } } } } } });
    if (asg) {
      const subs = await this.prisma.submission.findMany({ where: { assignmentId: asg.id, studentId }, orderBy: { submittedAt: 'desc' }, select: { id: true, status: true, body: true, revision: true, submittedAt: true, finalBand: true } });
      const open = subs.find((s) => s.status === 'DRAFT' || s.status === 'SUBMITTED');
      assignment = {
        id: asg.id, skill: asg.skill, instructions: asg.instructions, dueAt: asg.dueAt, minWords: asg.minWords,
        criteria: asg.rubric?.criteria.map((c) => c.name) ?? [],
        current: open ? { id: open.id, status: open.status, body: open.status === 'DRAFT' ? open.body : undefined, revision: open.revision } : null,
        history: subs.filter((s) => s.status !== 'DRAFT').map((s) => ({ id: s.id, status: s.status, submittedAt: s.submittedAt, finalBand: s.finalBand === null ? null : Number(s.finalBand) })),
      };
    }
    return {
      id: item.id, title: item.title, contentType: item.contentType, isRequired: item.isRequired, assessment, assignment,
      content: {
        body: meta.body, url: meta.url, fileName: meta.fileName,
        fileUrl: meta.fileKey ? await this.storage.signedUrl(meta.fileKey, 300) : undefined, // short-lived, per view
      },
      progress: progress
        ? { status: progress.status, progressPercent: progress.progressPercent, lastPosition: progress.lastPosition, timeSpentSeconds: progress.timeSpentSeconds }
        : { status: 'NOT_STARTED' as ProgressStatus, progressPercent: 0, lastPosition: null, timeSpentSeconds: 0 },
    };
  }

  // ───────── progress events ─────────
  async start(studentId: string, itemId: string) {
    const { enrollment } = await this.resolveItem(studentId, itemId);
    const where = { studentId_enrollmentId_contentItemId: { studentId, enrollmentId: enrollment.id, contentItemId: itemId } };
    const row = await this.prisma.contentProgress.upsert({
      where,
      create: { studentId, enrollmentId: enrollment.id, contentItemId: itemId, status: 'IN_PROGRESS', startedAt: new Date() },
      update: {}, // never regress an item that is already further along
    });
    if (row.status === 'NOT_STARTED') {
      await this.prisma.contentProgress.update({ where: { id: row.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    }
    return { ok: true };
  }

  async progress(studentId: string, itemId: string, body: ProgressBody) {
    const { enrollment } = await this.resolveItem(studentId, itemId);
    const key = { studentId_enrollmentId_contentItemId: { studentId, enrollmentId: enrollment.id, contentItemId: itemId } };
    const existing = await this.prisma.contentProgress.findUnique({ where: key });

    if (existing?.status === 'COMPLETED') {
      // Completed stays completed; only accumulate study time.
      if (body.timeSpentSeconds) await this.prisma.contentProgress.update({ where: key, data: { timeSpentSeconds: { increment: body.timeSpentSeconds } } });
      return { ok: true };
    }
    const percent = Math.min(99, Math.max(existing?.progressPercent ?? 0, body.progressPercent ?? 0)); // 100% is only reached by /complete
    await this.prisma.contentProgress.upsert({
      where: key,
      create: {
        studentId, enrollmentId: enrollment.id, contentItemId: itemId, status: 'IN_PROGRESS', startedAt: new Date(),
        progressPercent: percent, lastPosition: body.lastPosition, timeSpentSeconds: body.timeSpentSeconds ?? 0,
      },
      update: {
        status: 'IN_PROGRESS', progressPercent: percent,
        ...(body.lastPosition !== undefined ? { lastPosition: body.lastPosition } : {}),
        ...(body.timeSpentSeconds ? { timeSpentSeconds: { increment: body.timeSpentSeconds } } : {}),
      },
    });
    return { ok: true };
  }

  async complete(studentId: string, itemId: string) {
    const { item, enrollment } = await this.resolveItem(studentId, itemId);
    if (!SELF_COMPLETABLE.has(item.contentType)) {
      throw new AppError('VALIDATION_ERROR', 422, 'This item is completed by submitting it, not by marking it done.', { contentType: item.contentType });
    }
    const key = { studentId_enrollmentId_contentItemId: { studentId, enrollmentId: enrollment.id, contentItemId: itemId } };
    const now = new Date();
    await this.prisma.contentProgress.upsert({
      where: key,
      create: { studentId, enrollmentId: enrollment.id, contentItemId: itemId, status: 'COMPLETED', progressPercent: 100, startedAt: now, completedAt: now },
      update: { status: 'COMPLETED', progressPercent: 100, completedAt: now },
    });
    const overall = await this.recalculateEnrollment(enrollment.id, studentId);
    return { ok: true, enrollmentProgressPercent: overall };
  }

  /** completed required / total required over PUBLISHED items of the enrollment's version. */
  async recalculateEnrollment(enrollmentId: string, studentId: string): Promise<number> {
    const enrollment = await this.prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    const requiredWhere: Prisma.ContentItemWhereInput = { isRequired: true, status: 'PUBLISHED', section: { courseVersionId: enrollment.courseVersionId, status: 'PUBLISHED' } };
    const [total, done] = await Promise.all([
      this.prisma.contentItem.count({ where: requiredWhere }),
      this.prisma.contentProgress.count({ where: { enrollmentId, status: 'COMPLETED', contentItem: requiredWhere } }),
    ]);
    const percent = progressPercent(done, total);
    await this.prisma.enrollment.update({ where: { id: enrollmentId }, data: { progressPercent: percent } });

    if (total > 0 && done >= total && enrollment.status === 'ACTIVE') {
      const closed = await this.prisma.enrollment.updateMany({ where: { id: enrollmentId, status: 'ACTIVE' }, data: { status: 'COMPLETED', completedAt: new Date() } });
      if (closed.count) {
        await this.prisma.studentTimelineEvent.create({ data: { studentId, type: 'COURSE_COMPLETED', summary: 'Completed all required content', meta: { enrollmentId } } });
        this.events.emit(LIFECYCLE_SIGNAL, { studentId, to: 'COMPLETED', reason: 'Completed all required content' });
      }
    }
    return percent;
  }

  // ───────── dashboard / profile ─────────
  async dashboard(studentId: string) {
    const [profile, enrollments, pendingOrders] = await Promise.all([
      this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId } }),
      this.prisma.enrollment.findMany({
        where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        include: { course: { select: { title: true, slug: true } }, batch: { select: { id: true, name: true, startAt: true } } },
      }),
      this.prisma.order.findMany({ where: { studentId, status: { in: ['AWAITING_PAYMENT', 'PENDING_REVIEW'] } }, select: { id: true, reference: true, status: true }, orderBy: { createdAt: 'desc' } }),
    ]);

    const courses = await Promise.all(enrollments.map(async (e) => {
      const { tree } = await this.courseState({ id: e.id, courseVersionId: e.courseVersionId, studentId: e.studentId, batch: e.batch });
      const skills: Record<string, number | null> = {};
      for (const skill of SKILLS) {
        const root = tree.find((n) => n.title.toLowerCase().startsWith(skill));
        skills[skill] = root ? progressPercent(root.totals.completedRequired, root.totals.required) : null;
      }
      return {
        enrollmentId: e.id, status: e.status, course: e.course, batch: e.batch, progressPercent: e.progressPercent,
        accessEndsAt: e.accessEndsAt, skills,
      };
    }));
    const active = courses.filter((c) => c.status === 'ACTIVE');
    const overall = active.length ? Math.round((active.reduce((s, c) => s + Number(c.progressPercent), 0) / active.length) * 100) / 100 : 0;

    return {
      profile: {
        firstName: profile.firstName, lastName: profile.lastName, currentBand: profile.currentBand, targetBand: profile.targetBand,
        ieltsExamDate: profile.ieltsExamDate, academicOrGeneral: profile.academicOrGeneral,
        ielts: ieltsSummary(profile),
      },
      overallProgressPercent: overall, courses, pendingOrders,
    };
  }

  async getProfile(studentId: string) {
    const p = await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, include: { user: { select: { email: true, phone: true } } } });
    const { user, ...rest } = p;
    return { ...rest, email: user.email, phone: user.phone, ielts: ieltsSummary(p) };
  }

  async updateProfile(studentId: string, input: z.infer<typeof studentProfileSchema>) {
    const { ieltsExamDate, ieltsTestDate, dateOfBirth, phone, ieltsHistory, ieltsOverall, ...rest } = input;
    return this.prisma.$transaction(async (tx) => {
      // Mirror the deprecated currentBand field from the new ielts* fields so existing band
      // charts/reports keep working: TAKEN -> currentBand = overall, NEVER -> currentBand = null.
      const bandMirror =
        ieltsHistory === 'NEVER'
          ? {
              currentBand: null,
              ieltsOverall: null,
              ieltsListening: null,
              ieltsReading: null,
              ieltsWriting: null,
              ieltsSpeaking: null,
              ieltsTestDate: null,
              ieltsAttempts: null,
            }
          : ieltsHistory === 'TAKEN' && ieltsOverall !== undefined
            ? { currentBand: ieltsOverall }
            : {};
      const profile = await tx.studentProfile.update({
        where: { id: studentId },
        data: {
          ...rest,
          ...(ieltsHistory !== undefined ? { ieltsHistory } : {}),
          ...(ieltsOverall !== undefined ? { ieltsOverall } : {}),
          ...bandMirror,
          ...(ieltsExamDate ? { ieltsExamDate: new Date(ieltsExamDate) } : {}),
          ...(ieltsTestDate ? { ieltsTestDate: new Date(ieltsTestDate) } : {}),
          ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
        },
      });
      if (phone) await tx.user.update({ where: { id: profile.userId }, data: { phone } });
      return profile;
    });
  }
}

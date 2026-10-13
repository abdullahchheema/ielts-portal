import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { StudyPlanItemInput, UpdateStudyPlanItemInput, studyPlanItemSchema, updateStudyPlanItemSchema } from '@ielts/validation';
import { z } from 'zod';
import { forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { RecommendableItem, SkillEvidence, deriveSkillStates, recommendNext } from '../learning/pathway';
import { PrismaService } from '../prisma/prisma.service';

const sid = (u: AuthUser) => {
  if (!u.studentId) throw forbidden('Only student accounts can do this.');
  return u.studentId;
};

@Injectable()
export class CurriculumService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputes each of the student's skill states from their real graded attempts (spec §17,
   * §24) and persists the snapshot so batch analytics (Phase 4) can read it cheaply. Never
   * invents evidence: a skill with no graded outcomes stays UNKNOWN.
   */
  async refreshSkillStates(studentId: string) {
    const rows = await this.prisma.attemptAnswer.findMany({
      where: { attempt: { studentId, status: { in: ['AUTO_GRADED', 'GRADED'] } }, isCorrect: { not: null }, questionVersion: { question: { skillKey: { not: null } } } },
      select: { isCorrect: true, updatedAt: true, questionVersion: { select: { question: { select: { skillKey: true, module: true, track: true } } } } },
      orderBy: { updatedAt: 'asc' },
    });
    const bySkill = new Map<string, SkillEvidence>();
    for (const r of rows) {
      const q = r.questionVersion.question;
      const key = q.skillKey!;
      if (!bySkill.has(key)) bySkill.set(key, { skillKey: key, module: q.module, track: q.track, outcomes: [] });
      bySkill.get(key)!.outcomes.push({ correct: r.isCorrect!, at: r.updatedAt });
    }
    const now = new Date();
    const states = deriveSkillStates([...bySkill.values()], now);
    if (states.length) {
      await this.prisma.$transaction(states.map((s) => {
        const evidence = bySkill.get(s.skillKey)!;
        return this.prisma.studentSkillState.upsert({
          where: { studentId_skillKey: { studentId, skillKey: s.skillKey } },
          create: { studentId, skillKey: s.skillKey, module: evidence.module, track: evidence.track ?? 'BOTH', state: s.state, accuracyPercent: s.accuracyPercent, sampleSize: s.sampleSize, lastEvidenceAt: s.lastEvidenceAt, reviewDueAt: s.reviewDueAt },
          update: { state: s.state, accuracyPercent: s.accuracyPercent, sampleSize: s.sampleSize, lastEvidenceAt: s.lastEvidenceAt, reviewDueAt: s.reviewDueAt },
        });
      }));
    }
    return states;
  }

  async skillStates(studentId: string) {
    return this.refreshSkillStates(studentId);
  }

  /** Today's workspace: required work, today's classes, personalised recommendations, revision due, and optional practice — each tagged with its source (spec §7). */
  async today(studentId: string) {
    const [profile, enrollments, states] = await Promise.all([
      this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, select: { academicOrGeneral: true } }),
      this.prisma.enrollment.findMany({ where: { studentId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { id: true, batchId: true }, orderBy: { createdAt: 'desc' } }),
      this.refreshSkillStates(studentId),
    ]);
    const batchIds = enrollments.map((e) => e.batchId);
    const primaryEnrollmentId = enrollments[0]?.id ?? null;
    const studentTrack = profile.academicOrGeneral;
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const assignments = await this.prisma.curriculumAssignment.findMany({
      where: { publishedAt: { not: null }, OR: [{ studentId }, { batchId: { in: batchIds } }] },
      include: { contentItem: { select: { id: true, title: true, estimatedMinutes: true, contentType: true, module: true } } },
    });
    const progressRows = assignments.length
      ? await this.prisma.contentProgress.findMany({ where: { studentId, contentItemId: { in: assignments.map((a) => a.contentItemId) } } })
      : [];
    const progressByItem = new Map(progressRows.map((p) => [p.contentItemId, p]));
    const notDone = (itemId: string) => progressByItem.get(itemId)?.status !== 'COMPLETED';

    const required = assignments.filter((a) => a.requirement === 'REQUIRED' && notDone(a.contentItemId) && (!a.dueAt || a.dueAt < dayEnd));
    const optionalAssigned = assignments.filter((a) => a.requirement === 'RECOMMENDED' && notDone(a.contentItemId));

    const sessions = batchIds.length
      ? await this.prisma.liveSession.findMany({
          where: { batchId: { in: batchIds }, startsAt: { gte: dayStart, lt: dayEnd } }, orderBy: { startsAt: 'asc' },
          include: { batch: { select: { name: true } }, mentor: { select: { displayName: true } } },
        })
      : [];

    const skillKeys = states.map((s) => s.skillKey);
    const candidateItems = skillKeys.length
      ? await this.prisma.contentItem.findMany({
          where: { skillKey: { in: skillKeys }, status: 'PUBLISHED', recommendable: true, track: studentTrack ? { in: ['BOTH', studentTrack] } : undefined },
          select: { id: true, title: true, skillKey: true, activityKind: true, estimatedMinutes: true, track: true, module: true },
        })
      : [];
    const itemsBySkill = new Map<string, RecommendableItem[]>();
    const itemById = new Map(candidateItems.map((i) => [i.id, i]));
    for (const i of candidateItems) {
      const p = progressByItem.get(i.id);
      const studentStatus = p?.masteredAt ? 'MASTERED' : p?.status === 'COMPLETED' ? 'COMPLETED' : p?.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'NOT_STARTED';
      const list = itemsBySkill.get(i.skillKey!) ?? [];
      list.push({ id: i.id, skillKey: i.skillKey, activityKind: i.activityKind, recommendable: true, studentStatus });
      itemsBySkill.set(i.skillKey!, list);
    }
    const recs = recommendNext(states, itemsBySkill);
    const recommended = recs.filter((r) => r.reason !== 'REVISION_DUE');
    const revisionDue = recs.filter((r) => r.reason === 'REVISION_DUE');

    const usedIds = new Set([...required.map((a) => a.contentItemId), ...optionalAssigned.map((a) => a.contentItemId), ...recs.map((r) => r.contentItemId)]);
    const optionalPractice = await this.prisma.contentItem.findMany({
      where: {
        status: 'PUBLISHED', recommendable: true, activityKind: { in: ['PRACTICE', 'TIMED_PRACTICE'] }, id: { notIn: [...usedIds] },
        track: studentTrack ? { in: ['BOTH', studentTrack] } : undefined,
      },
      take: 6, orderBy: { sequence: 'asc' }, select: { id: true, title: true, estimatedMinutes: true, module: true, skillKey: true },
    });

    const withEnrollment = <T extends object>(x: T) => ({ ...x, enrollmentId: primaryEnrollmentId });
    return {
      requiredToday: required.map((a) => withEnrollment({ assignmentId: a.id, contentItemId: a.contentItemId, title: a.contentItem.title, dueAt: a.dueAt, estimatedMinutes: a.contentItem.estimatedMinutes, classification: a.classification, source: 'TEACHER_ASSIGNED' as const })),
      classesToday: sessions.map((s) => ({ id: s.id, topic: s.topic, startsAt: s.startsAt, endsAt: s.endsAt, batch: s.batch.name, mentor: s.mentor?.displayName ?? null, status: s.status, meetingUrl: now.getTime() >= s.startsAt.getTime() - 15 * 60_000 && now.getTime() <= s.endsAt.getTime() ? s.meetingUrl : null })),
      recommended: recommended.map((r) => withEnrollment({ contentItemId: r.contentItemId, title: itemById.get(r.contentItemId)?.title, estimatedMinutes: itemById.get(r.contentItemId)?.estimatedMinutes, skillKey: r.skillKey, reason: r.reason, source: 'PERSONALISED' as const })),
      revisionDue: revisionDue.map((r) => withEnrollment({ contentItemId: r.contentItemId, title: itemById.get(r.contentItemId)?.title, skillKey: r.skillKey, source: 'REVISION_DUE' as const })),
      optionalAssigned: optionalAssigned.map((a) => withEnrollment({ assignmentId: a.id, contentItemId: a.contentItemId, title: a.contentItem.title, estimatedMinutes: a.contentItem.estimatedMinutes, source: 'TEACHER_ASSIGNED' as const })),
      optionalPractice: optionalPractice.map((i) => withEnrollment({ contentItemId: i.id, title: i.title, estimatedMinutes: i.estimatedMinutes, module: i.module, skillKey: i.skillKey, source: 'OPTIONAL_PRACTICE' as const })),
    };
  }

  // ───────── study plan (spec §9) ─────────
  async listStudyPlan(studentId: string, from?: string, to?: string) {
    return this.prisma.studyPlanItem.findMany({
      where: { studentId, ...(from || to ? { plannedFor: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } } : {}) },
      orderBy: { plannedFor: 'asc' },
      include: { contentItem: { select: { id: true, title: true, module: true, estimatedMinutes: true } } },
    });
  }

  async createStudyPlanItem(studentId: string, input: StudyPlanItemInput) {
    return this.prisma.studyPlanItem.create({
      data: {
        studentId, title: input.title, contentItemId: input.contentItemId, plannedFor: new Date(input.plannedFor),
        estimatedMinutes: input.estimatedMinutes, notes: input.notes, source: 'STUDENT',
      },
    });
  }

  async updateStudyPlanItem(studentId: string, id: string, input: UpdateStudyPlanItemInput) {
    const existing = await this.prisma.studyPlanItem.findFirst({ where: { id, studentId } });
    if (!existing) throw notFound('Study plan item');
    return this.prisma.studyPlanItem.update({
      where: { id },
      data: {
        title: input.title, contentItemId: input.contentItemId, notes: input.notes, estimatedMinutes: input.estimatedMinutes,
        ...(input.plannedFor ? { plannedFor: new Date(input.plannedFor) } : {}),
        ...(input.status ? { status: input.status, completedAt: input.status === 'DONE' ? new Date() : null } : {}),
      },
    });
  }

  async deleteStudyPlanItem(studentId: string, id: string) {
    const { count } = await this.prisma.studyPlanItem.deleteMany({ where: { id, studentId } });
    if (!count) throw notFound('Study plan item');
  }
}

const uuid = new ParseUUIDPipe();

@Controller()
export class CurriculumController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Get('me/today')
  today(@CurrentUser() u: AuthUser) { return this.curriculum.today(sid(u)); }

  @Get('me/skill-states')
  skillStates(@CurrentUser() u: AuthUser) { return this.curriculum.skillStates(sid(u)); }

  @Get('me/study-plan')
  listStudyPlan(@CurrentUser() u: AuthUser) { return this.curriculum.listStudyPlan(sid(u)); }

  @Post('me/study-plan')
  createStudyPlanItem(@Body(new ZodPipe(studyPlanItemSchema)) body: StudyPlanItemInput, @CurrentUser() u: AuthUser) {
    return this.curriculum.createStudyPlanItem(sid(u), body);
  }

  @Patch('me/study-plan/:id')
  updateStudyPlanItem(@Param('id', uuid) id: string, @Body(new ZodPipe(updateStudyPlanItemSchema)) body: UpdateStudyPlanItemInput, @CurrentUser() u: AuthUser) {
    return this.curriculum.updateStudyPlanItem(sid(u), id, body);
  }

  @HttpCode(204) @Delete('me/study-plan/:id')
  async deleteStudyPlanItem(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { await this.curriculum.deleteStudyPlanItem(sid(u), id); }
}

@Module({ controllers: [CurriculumController], providers: [CurriculumService], exports: [CurriculumService] })
export class CurriculumModule {}

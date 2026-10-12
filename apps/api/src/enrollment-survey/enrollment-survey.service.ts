import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { AppError, notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { SurveyDraftInput, SurveySubmitInput } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';

const EMPTY = { takenBefore: null, hadBand: null, priorScores: null, reason: null, reasonOther: null, targetBand: null, testTimeline: null, challengingSkills: [], proficiency: null, dailyMinutes: null, learningFormat: null, helpWith: [], status: 'DRAFT' as const, revision: 0, submittedAt: null };

function toDto(row: {
  status: string; takenBefore: string | null; hadBand: string | null; priorScores: unknown; reason: string | null; reasonOther: string | null;
  targetBand: unknown; testTimeline: string | null; challengingSkills: unknown; proficiency: string | null; dailyMinutes: string | null;
  learningFormat: string | null; helpWith: unknown; revision: number; submittedAt: Date | null;
}) {
  return {
    status: row.status, revision: row.revision, submittedAt: row.submittedAt,
    takenBefore: row.takenBefore, hadBand: row.hadBand, priorScores: row.priorScores,
    reason: row.reason, reasonOther: row.reasonOther,
    targetBand: row.targetBand === null ? null : Number(row.targetBand),
    testTimeline: row.testTimeline, challengingSkills: row.challengingSkills,
    proficiency: row.proficiency, dailyMinutes: row.dailyMinutes, learningFormat: row.learningFormat, helpWith: row.helpWith,
  };
}

/**
 * The onboarding survey: one row per student, draft and final record (see GradingDraft for the same shape).
 * Answers inform onboarding and never gate enrollment, so submit mirrors them onto StudentProfile but the
 * application endpoint itself stays unaware of this table.
 */
@Injectable()
export class EnrollmentSurveyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async mine(studentId: string) {
    const row = await this.prisma.enrollmentSurvey.findUnique({ where: { studentId } });
    return row ? toDto(row) : EMPTY;
  }

  /** Debounced autosave. Carries the revision last seen; a stale save is refused like a grading draft. */
  async saveDraft(studentId: string, revision: number, input: SurveyDraftInput) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.enrollmentSurvey.findUnique({ where: { studentId }, select: { revision: true, status: true } });
      if (!existing) {
        if (revision !== 0) throw new AppError('ANSWER_SAVE_CONFLICT', 409, 'This survey changed elsewhere. Reload to see the latest.', { revision: 0 });
        const created = await tx.enrollmentSurvey.create({ data: { studentId, ...input, revision: 1 } });
        return toDto(created);
      }
      if (existing.revision !== revision) {
        throw new AppError('ANSWER_SAVE_CONFLICT', 409, 'This survey changed elsewhere. Reload to see the latest.', { revision: existing.revision });
      }
      const updated = await tx.enrollmentSurvey.update({
        where: { studentId, revision },
        data: { ...input, status: existing.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT', revision: { increment: 1 } },
      });
      return toDto(updated);
    });
  }

  /**
   * Validates the full set, flips to SUBMITTED, and mirrors the overlapping answers onto StudentProfile in one
   * transaction -- so the study plan, insights and every admin view keep working with zero changes elsewhere.
   */
  async submit(studentId: string, userId: string, input: SurveySubmitInput, meta: { ip?: string; userAgent?: string }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.enrollmentSurvey.findUnique({ where: { studentId }, select: { revision: true } });
      const data = {
        takenBefore: input.takenBefore, hadBand: input.hadBand ?? null, priorScores: input.priorScores ?? Prisma.JsonNull,
        reason: input.reason, reasonOther: input.reasonOther ?? null, targetBand: input.targetBand,
        testTimeline: input.testTimeline, challengingSkills: input.challengingSkills, proficiency: input.proficiency,
        dailyMinutes: input.dailyMinutes, learningFormat: input.learningFormat, helpWith: input.helpWith,
        status: 'SUBMITTED' as const, submittedAt: new Date(),
      };
      const survey = existing
        ? await tx.enrollmentSurvey.update({ where: { studentId }, data: { ...data, revision: { increment: 1 } } })
        : await tx.enrollmentSurvey.create({ data: { studentId, ...data, revision: 1 } });

      await tx.studentProfile.update({
        where: { id: studentId },
        data: {
          targetBand: input.targetBand,
          preferredLearningMode: input.learningFormat,
          // StudentProfile's ieltsHistory predates this survey and uses TAKEN/NEVER, not the survey's YES/NO.
          ieltsHistory: input.takenBefore === 'YES' ? 'TAKEN' : 'NEVER',
          ieltsOverall: input.hadBand === 'YES' ? input.priorScores?.overall ?? null : null,
          ieltsListening: input.hadBand === 'YES' ? input.priorScores?.listening ?? null : null,
          ieltsReading: input.hadBand === 'YES' ? input.priorScores?.reading ?? null : null,
          ieltsWriting: input.hadBand === 'YES' ? input.priorScores?.writing ?? null : null,
          ieltsSpeaking: input.hadBand === 'YES' ? input.priorScores?.speaking ?? null : null,
        },
      });
      await this.audit.record({ userId, action: 'ENROLLMENT_SURVEY_SUBMITTED', entityType: 'EnrollmentSurvey', entityId: survey.id, after: { studentId }, ip: meta.ip, userAgent: meta.userAgent }, tx);
      return survey;
    });
    return toDto(result);
  }

  /** Staff read, scoped by the caller (admin unconditionally, teacher only for their own batch students). */
  async forStudent(studentId: string) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!profile) throw notFound('Student');
    const row = await this.prisma.enrollmentSurvey.findUnique({ where: { studentId } });
    return row ? toDto(row) : EMPTY;
  }
}

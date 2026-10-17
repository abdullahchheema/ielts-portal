import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@ielts/db';
import type { SaveAnswersInput } from '@ielts/validation';
import { AppError, conflict, notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptsService } from '../assessments/attempts.service';

/** Ghost accounts' email domain. Status stays PENDING_VERIFICATION forever, so the normal
 *  "verify your email before logging in" gate already makes them unreachable through /auth/login. */
const GHOST_EMAIL_DOMAIN = 'free-lead.internal';
const LEAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface FreeTestResult {
  score: { raw: number | null; max: number | null; percent: number | null; band: number | null };
  assessment: { title: string };
  completedAt: Date | null;
  status: string;
}

/**
 * The anonymous free-test flow. Identity is email+phone (normalized), with no account created —
 * a lightweight "ghost" StudentProfile/User lets the free attempt reuse the existing, battle-tested
 * AttemptsService lifecycle (start/save/submit) unchanged. The one place this service does NOT
 * delegate is the final result: that is a hand-written, hard-coded projection of score fields only,
 * so a free lead can never see per-question correctness or answer keys no matter how the underlying
 * assessment's `showAnswers` flag is configured — the restriction lives in the backend, not the UI.
 */
@Injectable()
export class FreeTestService {
  constructor(private readonly prisma: PrismaService, private readonly attempts: AttemptsService) {}

  private normalize(email: string, phone: string) {
    return { emailNormalized: email.trim().toLowerCase(), phoneNormalized: phone.replace(/\D/g, '') };
  }

  /** Claim (or resume, or reclaim after expiry) a free-test slot. Never grants a second entitlement
   *  to the same identity once it has been COMPLETED. */
  async claim(email: string, phone: string, meta: { ip?: string; userAgent?: string }) {
    const { emailNormalized, phoneNormalized } = this.normalize(email, phone);
    if (!phoneNormalized || phoneNormalized.length < 6) throw new AppError('VALIDATION_ERROR', 422, 'Enter a valid phone number.', { phone: 'Invalid phone number.' });

    const existing = await this.prisma.freeAssessmentLead.findUnique({
      where: { emailNormalized_phoneNormalized: { emailNormalized, phoneNormalized } },
      include: { assignedConfig: true },
    });

    if (existing) {
      if (existing.status === 'COMPLETED') throw conflict('FREE_TEST_USED', 'You have already taken the free test. Register for a paid plan to unlock full results and more tests.');
      if (existing.status === 'EXPIRED') return this.reclaim(existing.id, meta);
      return { leadId: existing.id, assessmentId: existing.assignedConfig.assessmentId, resumable: !!existing.attemptId };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('free_test_assign'))`;
        const config = await this.pickBalancedConfig(tx);
        const ghostStudentId = await this.createGhostStudent(tx, email, phone);
        const lead = await tx.freeAssessmentLead.create({
          data: {
            email, phone, emailNormalized, phoneNormalized, assignedConfigId: config.id, ghostStudentId,
            ipAddress: meta.ip, userAgent: meta.userAgent, expiresAt: new Date(Date.now() + LEAD_TTL_MS),
          },
        });
        return { leadId: lead.id, assessmentId: config.assessmentId, resumable: false };
      });
    } catch (e) {
      // Two near-simultaneous claims for the same identity: the loser's insert hits the unique
      // index. Recover by returning the winner's lead instead of a spurious 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const after = await this.prisma.freeAssessmentLead.findUnique({
          where: { emailNormalized_phoneNormalized: { emailNormalized, phoneNormalized } }, include: { assignedConfig: true },
        });
        if (after) return { leadId: after.id, assessmentId: after.assignedConfig.assessmentId, resumable: !!after.attemptId };
      }
      throw e;
    }
  }

  private async reclaim(leadId: string, meta: { ip?: string; userAgent?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('free_test_assign'))`;
      const config = await this.pickBalancedConfig(tx);
      const lead = await tx.freeAssessmentLead.update({
        where: { id: leadId },
        data: { assignedConfigId: config.id, attemptId: null, status: 'CLAIMED', expiresAt: new Date(Date.now() + LEAD_TTL_MS), ipAddress: meta.ip, userAgent: meta.userAgent },
      });
      return { leadId: lead.id, assessmentId: config.assessmentId, resumable: false };
    });
  }

  private async pickBalancedConfig(tx: Prisma.TransactionClient) {
    const configs = await tx.freeTestConfig.findMany({ where: { active: true }, orderBy: { sequence: 'asc' } });
    if (configs.length === 0) throw new AppError('ASSESSMENT_NOT_AVAILABLE', 404, 'The free test is not configured yet. Please check back soon.');
    const counts = await tx.freeAssessmentLead.groupBy({ by: ['assignedConfigId'], _count: { _all: true } });
    const countOf = new Map(counts.map((c) => [c.assignedConfigId, c._count._all]));
    return configs.reduce((min, c) => ((countOf.get(c.id) ?? 0) < (countOf.get(min.id) ?? 0) ? c : min), configs[0]);
  }

  private async createGhostStudent(tx: Prisma.TransactionClient, email: string, phone: string) {
    const studentRole = await tx.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
    const passwordHash = await argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
    const user = await tx.user.create({
      data: {
        email: `freelead-${randomUUID()}@${GHOST_EMAIL_DOMAIN}`, phone, passwordHash,
        student: { create: { firstName: 'Free', lastName: 'Trial' } },
        roles: { create: { roleId: studentRole.id } },
      },
      include: { student: { select: { id: true } } },
    });
    return user.student!.id;
  }

  private async loadLead(leadId: string) {
    const lead = await this.prisma.freeAssessmentLead.findUnique({ where: { id: leadId }, include: { assignedConfig: { include: { assessment: true } } } });
    if (!lead) throw notFound('Free test claim');
    if (!lead.ghostStudentId) throw new AppError('FREE_TEST_INVALID', 409, 'This free test claim is no longer valid.');
    return lead;
  }

  async start(leadId: string) {
    const lead = await this.loadLead(leadId);
    if (lead.status === 'COMPLETED') throw conflict('FREE_TEST_USED', 'You have already taken the free test.');
    const user = { studentId: lead.ghostStudentId! };
    if (lead.attemptId) {
      const attempt = await this.prisma.assessmentAttempt.findUnique({ where: { id: lead.attemptId } });
      if (attempt?.status === 'IN_PROGRESS') return this.attempts.getAttempt(user, lead.attemptId);
      // Already finished (e.g. expired and auto-submitted) — never hand back the unrestricted result shape.
      return { attempt: { id: lead.attemptId, status: attempt?.status ?? 'SUBMITTED' }, result: await this.result(leadId) };
    }
    const started = await this.attempts.start(user, lead.assignedConfig.assessmentId);
    await this.prisma.freeAssessmentLead.update({ where: { id: leadId }, data: { attemptId: started.attempt.id, status: 'IN_PROGRESS' } });
    return started;
  }

  async saveAnswers(leadId: string, input: SaveAnswersInput) {
    const lead = await this.loadLead(leadId);
    if (!lead.attemptId) throw new AppError('SUBMISSION_INCOMPLETE', 409, 'Start the test first.');
    return this.attempts.saveAnswers({ studentId: lead.ghostStudentId! }, lead.attemptId, input);
  }

  async submit(leadId: string) {
    const lead = await this.loadLead(leadId);
    if (!lead.attemptId) throw new AppError('SUBMISSION_INCOMPLETE', 409, 'Start the test first.');
    await this.attempts.submit({ studentId: lead.ghostStudentId! }, lead.attemptId); // side effects only; response is thrown away below
    await this.prisma.freeAssessmentLead.update({ where: { id: leadId }, data: { status: 'COMPLETED' } });
    return this.result(leadId);
  }

  /** The ONLY response shape a free lead ever receives for a finished attempt: overall score, never
   *  per-question data or answer keys, regardless of the underlying assessment's showAnswers flag. */
  async result(leadId: string): Promise<FreeTestResult> {
    const lead = await this.loadLead(leadId);
    if (!lead.attemptId) throw new AppError('SUBMISSION_INCOMPLETE', 409, 'This test has not been submitted yet.');
    const attempt = await this.prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: lead.attemptId } });
    if (attempt.status === 'IN_PROGRESS') throw new AppError('SUBMISSION_INCOMPLETE', 409, 'This test has not been submitted yet.');
    return {
      score: {
        raw: attempt.rawScore === null ? null : Number(attempt.rawScore),
        max: attempt.maxScore === null ? null : Number(attempt.maxScore),
        percent: attempt.percent === null ? null : Number(attempt.percent),
        band: attempt.bandScore === null ? null : Number(attempt.bandScore),
      },
      assessment: { title: lead.assignedConfig.assessment.title },
      completedAt: attempt.submittedAt,
      status: attempt.status,
    };
  }

  /** Called when a visitor registers for real with the same email: links the lead's history to
   *  the new account without granting a second free entitlement. The ghost student's attempt is
   *  reassigned to the real student so the student can see their own free-test history later. */
  async linkToRegisteredStudent(email: string, newStudentId: string) {
    const emailNormalized = email.trim().toLowerCase();
    const leads = await this.prisma.freeAssessmentLead.findMany({ where: { emailNormalized, linkedStudentId: null } });
    for (const lead of leads) {
      await this.prisma.$transaction(async (tx) => {
        if (lead.attemptId) await tx.assessmentAttempt.updateMany({ where: { id: lead.attemptId }, data: { studentId: newStudentId } });
        await tx.freeAssessmentLead.update({ where: { id: lead.id }, data: { linkedStudentId: newStudentId } });
      });
    }
  }
}

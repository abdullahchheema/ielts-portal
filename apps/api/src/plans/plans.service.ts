import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { AssignStudentPlanInput, ReplaceEntitlementsInput, UpdatePlanInput } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { Actor } from '../courses/courses.service';
import { findMainCourse } from '../courses/main-course';
import { conflict, notFound } from '../common/app-error';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementService } from './entitlement.service';

type Db = PrismaService | Prisma.TransactionClient;

/** Admin plan management, the student's own plan, and plan assignment/changes (manual override
 *  or as part of a paid enrollment). Payment itself stays in the commerce module; this owns the
 *  StudentPlan row that commerce activates/cancels alongside the enrollment and order it tracks. */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
    private readonly notify: NotificationsService,
  ) {}

  // ───────── public / student ─────────

  /** Active plans for the pricing page, ordered for display, each with its entitlement summary.
   *  PREMIUM's displayed price mirrors the live course price (what checkout actually charges for it)
   *  rather than its own seeded row, since PREMIUM is priced as the academy's one course. */
  async publicList() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true }, orderBy: { sortOrder: 'asc' }, include: { entitlements: true },
    });
    const main = await findMainCourse(this.prisma);
    return plans.map((p) => ({
      name: p.name, displayName: p.displayName, description: p.description,
      price: p.name === 'PREMIUM' && main ? Number(main.course.price) : Number(p.price),
      currency: p.name === 'PREMIUM' && main ? main.course.currency : p.currency,
      billingPeriod: p.billingPeriod, durationDays: p.durationDays,
      features: Object.fromEntries(p.entitlements.map((e) => [e.featureKey, e.value === true])),
    }));
  }

  async myPlan(studentId: string) {
    const row = await this.prisma.studentPlan.findFirst({
      where: { studentId, status: 'ACTIVE' }, orderBy: { startedAt: 'desc' }, include: { plan: { include: { entitlements: true } } },
    });
    if (!row) {
      return { planName: 'FREE', displayName: 'Free', status: 'ACTIVE', expiresAt: null, features: await this.freeFeatureMap() };
    }
    return {
      planName: row.plan.name, displayName: row.plan.displayName, status: row.status, expiresAt: row.expiresAt,
      features: Object.fromEntries(row.plan.entitlements.map((e) => [e.featureKey, e.value === true])),
    };
  }

  private async freeFeatureMap() {
    const plan = await this.prisma.plan.findUnique({ where: { name: 'FREE' }, include: { entitlements: true } });
    return Object.fromEntries((plan?.entitlements ?? []).map((e) => [e.featureKey, e.value === true]));
  }

  // ───────── admin ─────────

  adminList() {
    return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { entitlements: true } });
  }

  async updatePlan(id: string, input: UpdatePlanInput, actor: Actor) {
    const before = await this.prisma.plan.findUnique({ where: { id } });
    if (!before) throw notFound('Plan');
    const after = await this.prisma.plan.update({ where: { id }, data: input });
    await this.audit.record({ ...actor, action: 'ADMIN_UPDATED_PLAN', entityType: 'Plan', entityId: id, before: { price: Number(before.price), active: before.active }, after: { price: Number(after.price), active: after.active } });
    this.entitlements.invalidate(after.name);
    return after;
  }

  async listEntitlements(planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw notFound('Plan');
    return this.prisma.planEntitlement.findMany({ where: { planId }, orderBy: { featureKey: 'asc' } });
  }

  async replaceEntitlements(planId: string, input: ReplaceEntitlementsInput, actor: Actor) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw notFound('Plan');
    await this.prisma.$transaction(async (tx) => {
      await tx.planEntitlement.deleteMany({ where: { planId } });
      await tx.planEntitlement.createMany({ data: input.entitlements.map((e) => ({ planId, featureKey: e.featureKey, value: e.value, description: e.description ?? null })) });
      await this.audit.record({ ...actor, action: 'ADMIN_REPLACED_PLAN_ENTITLEMENTS', entityType: 'Plan', entityId: planId, after: { entitlements: input.entitlements } }, tx);
    });
    this.entitlements.invalidate(plan.name);
    return this.listEntitlements(planId);
  }

  async adminStudentPlans(q: { studentId?: string; planName?: string; skip: number; take: number }) {
    const where = {
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.planName ? { plan: { name: q.planName } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.studentPlan.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take,
        include: { plan: true, student: { select: { firstName: true, lastName: true, userId: true } } },
      }),
      this.prisma.studentPlan.count({ where }),
    ]);
    return { total, items: rows };
  }

  /** Admin override: assign a plan directly (scholarship, manual grant, support correction) without a payment. */
  async assignPlan(input: AssignStudentPlanInput, actor: Actor) {
    const plan = await this.prisma.plan.findUnique({ where: { name: input.planName } });
    if (!plan) throw notFound('Plan');
    const result = await this.activatePlan(input.studentId, plan.id, null, actor, input.reason);
    await this.notify.notifyUser(await this.userIdFor(input.studentId), 'PLAN_ACTIVATED', `Your plan is now ${plan.displayName}`, input.reason, { email: true, entityType: 'StudentPlan', entityId: result.id });
    return result;
  }

  /** Upgrade or downgrade: ends the current plan and starts the new one. Payment (if any) is handled
   *  by the caller (commerce) before this is invoked — this method only flips the StudentPlan state. */
  async changePlan(studentId: string, planName: string, actor: Actor, orderId?: string) {
    const plan = await this.prisma.plan.findUnique({ where: { name: planName } });
    if (!plan) throw notFound('Plan');
    const current = await this.prisma.studentPlan.findFirst({ where: { studentId, status: 'ACTIVE' }, include: { plan: true } });
    if (current?.planId === plan.id) throw conflict('CONFLICT', `The student is already on the ${plan.displayName} plan.`);

    const result = await this.prisma.$transaction(async (tx) => {
      if (current) {
        const isUpgrade = await this.isHigherTier(current.plan.name, planName);
        await tx.studentPlan.update({ where: { id: current.id }, data: { status: isUpgrade ? 'UPGRADED' : 'CANCELLED' } });
      }
      return this.activatePlan(studentId, plan.id, orderId ?? null, actor, undefined, tx);
    });
    this.entitlements.invalidate();
    await this.notify.notifyUser(await this.userIdFor(studentId), 'PLAN_UPGRADED', `Your plan is now ${plan.displayName}`, undefined, { email: true, entityType: 'StudentPlan', entityId: result.id });
    return result;
  }

  /**
   * For callers (commerce verifying a payment) that must activate a plan atomically with their own
   * change, inside their own transaction, rather than opening a second independent one here.
   */
  async activateWithinTransaction(tx: Prisma.TransactionClient, studentId: string, planName: string, orderId: string | null, actor: Actor) {
    const plan = await tx.plan.findUniqueOrThrow({ where: { name: planName } });
    const row = await this.activatePlan(studentId, plan.id, orderId, actor, undefined, tx);
    this.entitlements.invalidate(plan.name);
    return row;
  }

  private readonly TIER_ORDER = ['FREE', 'STARTER', 'ADVANCED', 'PREMIUM'];
  private async isHigherTier(from: string, to: string) {
    return this.TIER_ORDER.indexOf(to) > this.TIER_ORDER.indexOf(from);
  }

  private async activatePlan(studentId: string, planId: string, orderId: string | null, actor: Actor, reason?: string, tx: Db = this.prisma) {
    const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId } });
    const expiresAt = plan.durationDays ? new Date(Date.now() + plan.durationDays * 86_400_000) : null;
    // Defensive: clear any stray ACTIVE row before inserting the new one (the partial unique index
    // would otherwise reject a second ACTIVE row for this student if an earlier CANCEL didn't commit).
    await tx.studentPlan.updateMany({ where: { studentId, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
    const row = await tx.studentPlan.create({ data: { studentId, planId, status: 'ACTIVE', expiresAt, orderId } });
    await this.audit.record({ ...actor, action: 'ADMIN_ASSIGNED_PLAN', entityType: 'StudentPlan', entityId: row.id, after: { studentId, planName: plan.name, reason } });
    this.entitlements.invalidate(plan.name);
    return row;
  }

  private async userIdFor(studentId: string) {
    const s = await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } });
    return s.userId;
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** The feature keys every plan tier may grant. New features should be added here and to the seed data. */
export type FeatureKey =
  | 'assessment.free_test' | 'assessment.detailed_results' | 'ai.evaluation'
  | 'practice.unlimited' | 'mock.unlimited' | 'teacher.assignment' | 'class.access' | 'premium.services';

interface CacheEntry { entitlements: Map<string, unknown>; expires: number }

/**
 * The single gate every plan-tier feature check goes through. Loads a student's active plan (or
 * falls back to FREE if they have none), then that plan's entitlements, cached briefly per plan
 * since plans rarely change and this is called on the hot path of many requests.
 */
@Injectable()
export class EntitlementService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /** The student's active plan name, or 'FREE' if they have none (anonymous leads are always FREE). */
  async activePlanName(studentId: string | null): Promise<string> {
    if (!studentId) return 'FREE';
    const row = await this.prisma.studentPlan.findFirst({
      where: { studentId, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { plan: { select: { name: true } } },
    });
    return row?.plan.name ?? 'FREE';
  }

  /** Does this student (or an anonymous lead, when studentId is null) have this feature? */
  async can(studentId: string | null, feature: FeatureKey): Promise<boolean> {
    const planName = await this.activePlanName(studentId);
    const entitlements = await this.entitlementsFor(planName);
    const value = entitlements.get(feature);
    return value === true;
  }

  /** Bulk check: one query for several features, used by endpoints that need multiple flags at once. */
  async canAll(studentId: string | null, features: FeatureKey[]): Promise<Record<string, boolean>> {
    const planName = await this.activePlanName(studentId);
    const entitlements = await this.entitlementsFor(planName);
    return Object.fromEntries(features.map((f) => [f, entitlements.get(f) === true]));
  }

  /** The raw entitlement value (for non-boolean entitlements, e.g. a numeric limit in the future). */
  async entitlementValue(studentId: string | null, feature: string): Promise<unknown> {
    const planName = await this.activePlanName(studentId);
    const entitlements = await this.entitlementsFor(planName);
    return entitlements.get(feature);
  }

  /** Call after an admin edits a plan's entitlements so the next check doesn't read a stale cache. */
  invalidate(planName?: string) {
    if (planName) this.cache.delete(planName);
    else this.cache.clear();
  }

  private async entitlementsFor(planName: string): Promise<Map<string, unknown>> {
    const cached = this.cache.get(planName);
    if (cached && cached.expires > Date.now()) return cached.entitlements;
    const plan = await this.prisma.plan.findUnique({ where: { name: planName }, include: { entitlements: true } });
    const entitlements = new Map<string, unknown>((plan?.entitlements ?? []).map((e) => [e.featureKey, e.value]));
    this.cache.set(planName, { entitlements, expires: Date.now() + this.CACHE_MS });
    return entitlements;
  }
}

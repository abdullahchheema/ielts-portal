import { Body, Controller, Get, HttpCode, Inject, Injectable, Logger, OnModuleInit, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { Prisma } from '@ielts/db';
import { referralAttributeSchema, referralClickSchema, referralRejectSchema, ReferralRejectInput } from '@ielts/validation';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, Public, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { ENROLLMENT_ACTIVATED, EnrollmentActivatedEvent } from '../commerce/events';
import { NotificationsService } from '../notifications/notifications.service';
import { RateLimiter } from '../integrations/rate-limiter.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  canTransition, displayName, isSelfReferral, monthStartUtc, qualifiesAfter, referralCodeFrom, ReferralStatus, rewardFor, summarizeReferrals, withinMonthlyCap,
} from './referral-rules';

type Actor = { userId?: string; ip?: string; userAgent?: string };
const DAY_MS = 86_400_000;

const ORDER_BLOCKING_REWARD = ['REFUNDED', 'CANCELLED', 'EXPIRED'];

@Injectable()
export class ReferralsService implements OnModuleInit {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    private readonly settings: SettingsService,
    private readonly limiter: RateLimiter,
    private readonly scheduler: SchedulerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.scheduler.register('referrals.qualify', 60 * 60_000, () => this.qualifyDue());
  }

  // ───────── codes and links ─────────
  /** Every student gets one code, created on first use. Retries on the rare collision. */
  async ensureCode(studentId: string): Promise<string> {
    const existing = await this.prisma.referralCode.findUnique({ where: { studentId }, select: { code: true } });
    if (existing) return existing.code;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = referralCodeFrom(Math.random);
      try {
        await this.prisma.referralCode.create({ data: { studentId, code } });
        return code;
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
        const again = await this.prisma.referralCode.findUnique({ where: { studentId }, select: { code: true } });
        if (again) return again.code;
      }
    }
    throw new AppError('INTERNAL_ERROR', 500, 'Could not create a referral code. Please try again.');
  }

  /** Records a click on a referral link. Public and rate limited by hashed IP; unknown codes are ignored silently. */
  async recordClick(code: string, ip: string | undefined) {
    const ipHash = ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null;
    if (!(await this.limiter.hit(`referral-click:${ipHash ?? 'unknown'}`, 60, 3600)).allowed) return { ok: true };
    const exists = await this.prisma.referralCode.findUnique({ where: { code }, select: { id: true } });
    if (exists) await this.prisma.referralClick.create({ data: { code, ipHash } });
    return { ok: true };
  }

  // ───────── student ─────────
  async mine(studentId: string) {
    const code = await this.ensureCode(studentId);
    const [rows, ledger] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerStudentId: studentId },
        orderBy: { createdAt: 'desc' }, take: 100,
        select: { id: true, status: true, createdAt: true, enrolledAt: true, rewardedAt: true, referredStudent: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.accountCreditLedger.aggregate({ where: { studentId }, _sum: { amount: true } }),
    ]);
    return {
      code,
      link: `${this.config.APP_URL}/register?ref=${code}`,
      counts: summarizeReferrals(rows.map((r) => r.status as ReferralStatus)),
      balance: (ledger._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        name: r.referredStudent ? displayName(r.referredStudent.firstName, r.referredStudent.lastName) : 'Pending sign-up',
        createdAt: r.createdAt,
        enrolledAt: r.enrolledAt,
        rewardedAt: r.rewardedAt,
      })),
    };
  }

  /** Attaches the signed-in student to a referrer. New students only; one attribution per account, ever. */
  async attribute(userId: string, studentId: string | undefined, code: string) {
    if (!studentId) throw forbidden();
    const referrer = await this.prisma.referralCode.findUnique({
      where: { code }, select: { studentId: true, student: { select: { user: { select: { id: true, email: true, phone: true } } } } },
    });
    if (!referrer) throw notFound('Referral code');
    const existing = await this.prisma.referral.findUnique({ where: { referredUserId: userId }, select: { id: true, status: true } });
    if (existing) return { attributed: true, status: existing.status };
    if (referrer.studentId === studentId) throw conflict('CONFLICT', 'You cannot use your own referral code.');

    const [me, enrolled] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, phone: true } }),
      this.prisma.enrollment.count({ where: { studentId } }),
    ]);
    if (!me) throw notFound('Account');
    if (enrolled > 0) throw conflict('CONFLICT', 'Referral codes apply to new students only.');
    if (isSelfReferral({ userId: referrer.student.user.id, email: referrer.student.user.email, phone: referrer.student.user.phone }, { userId: me.id, email: me.email, phone: me.phone })) throw conflict('CONFLICT', 'You cannot use your own referral code.');

    try {
      const row = await this.prisma.referral.create({
        data: { referrerStudentId: referrer.studentId, referredUserId: userId, referredStudentId: studentId, code, status: 'REGISTERED' },
        select: { status: true },
      });
      return { attributed: true, status: row.status };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { attributed: true, status: 'REGISTERED' };
      throw e;
    }
  }

  // ───────── lifecycle hooks (called inside the business transaction that caused them) ─────────
  /** An order was created by a referred student: REGISTERED → APPLIED. */
  async markApplied(tx: Prisma.TransactionClient, studentId: string, orderId: string) {
    await tx.referral.updateMany({
      where: { referredStudentId: studentId, status: 'REGISTERED' },
      data: { status: 'APPLIED', orderId },
    });
  }

  /** An enrollment became active: APPLIED or REGISTERED → ENROLLED. */
  @OnEvent(ENROLLMENT_ACTIVATED)
  async onEnrolled(ev: EnrollmentActivatedEvent) {
    try {
      await this.prisma.referral.updateMany({
        where: { referredStudentId: ev.studentId, status: { in: ['REGISTERED', 'APPLIED'] } },
        data: { status: 'ENROLLED', enrolledAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`referral enrol hook failed: ${(e as Error).message}`);
    }
  }

  // ───────── scheduled ─────────
  /**
   * ENROLLED → QUALIFIED once the qualify window has passed. Refunded or cancelled orders are rejected instead.
   * With referrals.auto_reward on, qualified referrals are rewarded in the same run.
   */
  async qualifyDue(now = new Date()) {
    const days = await this.settings.get<number>('referrals.qualify_after_days');
    const autoReward = await this.settings.get<boolean>('referrals.auto_reward');
    const due = await this.prisma.referral.findMany({
      where: { status: 'ENROLLED', enrolledAt: { not: null, lte: new Date(now.getTime() - days * DAY_MS) } },
      select: { id: true, enrolledAt: true, order: { select: { status: true } } },
      take: 200,
    });
    let qualified = 0;
    let rewarded = 0;
    for (const r of due) {
      if (!r.enrolledAt || !qualifiesAfter(r.enrolledAt, now, days)) continue;
      if (r.order && ORDER_BLOCKING_REWARD.includes(r.order.status)) {
        await this.reject(r.id, 'The order was refunded or cancelled.', { userId: undefined }, 'SYSTEM');
        continue;
      }
      const claimed = await this.prisma.referral.updateMany({ where: { id: r.id, status: 'ENROLLED' }, data: { status: 'QUALIFIED', qualifiedAt: now } });
      if (claimed.count === 0) continue;
      qualified++;
      if (autoReward) {
        try {
          const out = await this.reward(r.id, {});
          if (out.rewarded) rewarded++;
        } catch (e) {
          this.logger.warn(`auto reward skipped for ${r.id}: ${(e as Error).message}`);
        }
      }
    }
    return { qualified, rewarded };
  }

  // ───────── staff ─────────
  async list(status: string | undefined, skip: number, take: number) {
    const where: Prisma.ReferralWhereInput = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.referral.findMany({
        where, orderBy: { updatedAt: 'desc' }, skip, take,
        select: {
          id: true, status: true, code: true, rewardType: true, rewardAmount: true, createdAt: true, enrolledAt: true, qualifiedAt: true, rewardedAt: true, rejectedReason: true,
          referrer: { select: { id: true, firstName: true, lastName: true } },
          referredStudent: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.referral.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Gives the reward for a qualified referral. The status move is a conditional claim, and the ledger row is
   * unique per referral, so a referral can never be rewarded twice even when two requests race.
   */
  async reward(referralId: string, actor: Actor): Promise<{ rewarded: boolean; reason?: string }> {
    const cfg = await this.rewardConfig();
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await tx.referral.findUnique({ where: { id: referralId }, include: { referrer: { select: { id: true, userId: true, firstName: true } } } });
      if (!r) throw notFound('Referral');
      if (r.status !== 'QUALIFIED') return { rewarded: false as const, reason: `This referral is ${r.status.toLowerCase()}, not qualified.` };

      const rewardedThisMonth = await tx.referral.count({ where: { referrerStudentId: r.referrerStudentId, status: 'REWARDED', rewardedAt: { gte: monthStartUtc(now) } } });
      if (!withinMonthlyCap(rewardedThisMonth, cfg.monthlyCap)) return { rewarded: false as const, reason: 'The referrer has reached this month’s reward limit.' };

      const reward = rewardFor(cfg.reward);
      const claimed = await tx.referral.updateMany({
        where: { id: referralId, status: 'QUALIFIED' },
        data: { status: 'REWARDED', rewardType: reward.type, rewardAmount: new Prisma.Decimal(reward.amount), rewardedAt: now, decidedById: actor.userId ?? null, decidedAt: now },
      });
      if (claimed.count === 0) return { rewarded: false as const, reason: 'Already rewarded.' };

      if (reward.type === 'ACCOUNT_CREDIT') {
        await tx.accountCreditLedger.create({
          data: { studentId: r.referrerStudentId, referralId, type: 'REFERRAL_REWARD', amount: new Prisma.Decimal(reward.amount), reason: 'Referral reward', createdById: actor.userId ?? null },
        });
      } else {
        const coupon = await tx.coupon.create({
          data: {
            code: `REF-${referralCodeFrom(Math.random, 8)}`,
            name: 'Referral reward',
            status: 'ACTIVE',
            active: true,
            discountType: reward.type === 'COUPON_PERCENT' ? 'PERCENTAGE' : 'FIXED',
            value: new Prisma.Decimal(reward.amount),
            userId: r.referrer.userId,
            maxRedemptions: 1,
            perUserLimit: 1,
            createdById: actor.userId ?? null,
          },
        });
        await tx.referral.update({ where: { id: referralId }, data: { rewardCouponId: coupon.id } });
      }

      await tx.studentTimelineEvent.create({ data: { studentId: r.referrerStudentId, type: 'REFERRAL_REWARDED', summary: `Referral reward: ${reward.type.replace('_', ' ').toLowerCase()}`, meta: { referralId } } });
      await this.audit.record({ ...actor, action: 'ADMIN_REWARDED_REFERRAL', entityType: 'Referral', entityId: referralId, before: { status: 'QUALIFIED' }, after: { status: 'REWARDED', rewardType: reward.type, rewardAmount: reward.amount } }, tx);
      return { rewarded: true as const, userId: r.referrer.userId };
    });
    if (result.rewarded) {
      await this.notify.notifyUser(result.userId, 'REFERRAL_REWARDED', 'You earned a referral reward', 'A friend you referred has enrolled, and your reward is ready in My referrals.', {
        email: true, dedupeKey: `referral-reward:${referralId}`, link: '/student/referrals',
      });
    }
    return result;
  }

  async reject(referralId: string, reason: string, actor: Actor, label: 'STAFF' | 'SYSTEM' = 'STAFF') {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.referral.findUnique({ where: { id: referralId }, select: { id: true, status: true } });
      if (!r) throw notFound('Referral');
      if (!canTransition(r.status as ReferralStatus, 'REJECTED')) throw conflict('CONFLICT', `A ${r.status.toLowerCase()} referral cannot be rejected.`);
      const claimed = await tx.referral.updateMany({ where: { id: referralId, status: r.status }, data: { status: 'REJECTED', rejectedReason: reason, decidedById: actor.userId ?? null, decidedAt: new Date() } });
      if (claimed.count === 0) throw conflict('CONFLICT', 'This referral changed. Reload and try again.');
      await this.audit.record({ ...actor, action: label === 'SYSTEM' ? 'SYSTEM_REJECTED_REFERRAL' : 'ADMIN_REJECTED_REFERRAL', entityType: 'Referral', entityId: referralId, before: { status: r.status }, after: { status: 'REJECTED', reason } }, tx);
      return { ok: true };
    });
  }

  private async rewardConfig() {
    const reward = await this.settings.get<{ type: 'ACCOUNT_CREDIT' | 'COUPON_FIXED' | 'COUPON_PERCENT'; value: number }>('referrals.reward');
    const monthlyCap = await this.settings.get<number>('referrals.monthly_cap');
    return { reward, monthlyCap };
  }
}

const uuid = new ParseUUIDPipe();
const clientIp = (req: Request) => clientMeta(req).ip;
const actorOf = (u: AuthUser, req: Request): Actor => ({ userId: u.id, ...clientMeta(req) });

@Controller()
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('me/referrals')
  mine(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden();
    return this.referrals.mine(u.studentId);
  }

  @Post('referrals/attribute')
  @HttpCode(200)
  attribute(@Body(new ZodPipe(referralAttributeSchema)) body: { code: string }, @CurrentUser() u: AuthUser) {
    return this.referrals.attribute(u.id, u.studentId, body.code);
  }

  @Public() @Post('referrals/click')
  @HttpCode(200)
  click(@Body(new ZodPipe(referralClickSchema)) body: { code: string }, @Req() req: Request) {
    return this.referrals.recordClick(body.code, clientIp(req));
  }
}

const listQuery = z.object({
  status: z.enum(['REGISTERED', 'APPLIED', 'ENROLLED', 'QUALIFIED', 'REWARDED', 'REJECTED']).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller('admin/referrals')
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @RequirePermission('referral.manage') @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.referrals.list(q.status, q.skip, q.take);
  }

  @RequirePermission('referral.manage') @HttpCode(200) @Post(':id/reward')
  reward(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.referrals.reward(id, actorOf(u, req));
  }

  @RequirePermission('referral.manage') @HttpCode(200) @Post(':id/reject')
  reject(@Param('id', uuid) id: string, @Body(new ZodPipe(referralRejectSchema)) body: ReferralRejectInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.referrals.reject(id, body.reason, actorOf(u, req));
  }
}


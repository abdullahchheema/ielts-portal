import { Body, Controller, Get, Injectable, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@ielts/db';
import {
  CouponPreviewInput, CreateCouponInput, UpdateCouponInput, couponPreviewSchema, createCouponSchema, updateCouponSchema,
} from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { RateLimiter } from '../integrations/rate-limiter.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { money } from './commerce.helpers';
import { CouponFacts, evaluateCoupon } from './coupon-rules';

const invalid = (msg: string) => new AppError('COUPON_INVALID', 422, msg);
type Actor = { userId: string; ip?: string; userAgent?: string };

@Injectable()
export class CouponsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit() {
    this.scheduler.register('coupons.expire', 60 * 60_000, () => this.expireDue());
  }

  /**
   * Validates a coupon and atomically claims one redemption. Must run inside the checkout transaction so a
   * failed checkout rolls the claim back. The conditional UPDATE is what stops the last redemption being
   * handed out twice under concurrency. The stored discount and code are a snapshot: later edits to the
   * coupon never change an order that already used it.
   */
  async reserveForCheckout(
    tx: Prisma.TransactionClient,
    args: { code: string; studentId: string; userId: string; courseId: string; batchId: string; price: Prisma.Decimal; orderId: string },
  ) {
    const coupon = await tx.coupon.findUnique({ where: { code: args.code } });
    if (!coupon) throw invalid('This coupon code is not valid.');
    const verdict = await this.judge(tx, coupon, args);
    if (!verdict.ok) throw invalid(verdict.reason);

    const claimed = await tx.$executeRaw`
      UPDATE coupons SET redeemed_count = redeemed_count + 1
      WHERE id = ${coupon.id}::uuid AND active AND status = 'ACTIVE' AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)`;
    if (claimed === 0) throw invalid('This coupon has reached its redemption limit.');

    await tx.couponRedemption.create({
      data: { couponId: coupon.id, studentId: args.studentId, orderId: args.orderId, status: 'RESERVED', discountAmount: verdict.discount, codeSnapshot: coupon.code },
    });
    return { couponId: coupon.id, discount: verdict.discount };
  }

  private async judge(tx: Prisma.TransactionClient, coupon: CouponFacts & { id: string; code: string }, args: { studentId: string; userId: string; courseId: string; batchId: string; price: Prisma.Decimal }) {
    const [paid, used] = await Promise.all([
      tx.order.count({ where: { studentId: args.studentId, status: 'PAID' } }),
      tx.couponRedemption.count({ where: { couponId: coupon.id, studentId: args.studentId, status: { in: ['RESERVED', 'USED'] } } }),
    ]);
    return evaluateCoupon(coupon, {
      now: new Date(), price: args.price, courseId: args.courseId, batchId: args.batchId, userId: args.userId,
      hasPaidOrder: paid > 0, usedByStudent: used,
    });
  }

  /** Read-only check for the enrollment form. Reserves nothing; the checkout still validates on submit. */
  async preview(studentId: string, userId: string, input: CouponPreviewInput) {
    if (!(await this.limiter.hit(`coupon-preview:${userId}`, 30, 3600)).allowed) {
      throw new AppError('RATE_LIMITED', 429, 'Too many coupon checks. Please try again later.');
    }
    const batch = await this.prisma.batch.findFirst({ where: { id: input.batchId, deletedAt: null }, include: { course: true } });
    if (!batch) throw notFound('Batch');
    const coupon = await this.prisma.coupon.findUnique({ where: { code: input.code } });
    const price = money(batch.course.price);
    if (!coupon) return { valid: false, reason: 'This coupon code is not valid.', price: price.toFixed(2), discount: '0.00', total: price.toFixed(2), currency: batch.course.currency };

    const verdict = await this.prisma.$transaction((tx) => this.judge(tx, coupon, { studentId, userId, courseId: batch.courseId, batchId: batch.id, price }));
    const discount = verdict.ok ? verdict.discount : money(0);
    return {
      valid: verdict.ok,
      reason: verdict.ok ? undefined : verdict.reason,
      price: price.toFixed(2),
      discount: discount.toFixed(2),
      total: price.sub(discount).toFixed(2),
      currency: batch.course.currency,
    };
  }

  // ───────── admin ─────────
  list() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { redemptions: true } } } });
  }

  /** Redemptions for one coupon, with the discount each order actually received. Read-only history. */
  async redemptions(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id }, select: { id: true } });
    if (!coupon) throw notFound('Coupon');
    return this.prisma.couponRedemption.findMany({
      where: { couponId: id }, orderBy: { createdAt: 'desc' }, take: 200,
      select: { id: true, status: true, discountAmount: true, codeSnapshot: true, createdAt: true, orderId: true },
    });
  }

  async create(input: CreateCouponInput, actor: Actor) {
    if (input.discountType === 'PERCENTAGE' && input.value > 100) {
      throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { value: 'A percentage cannot exceed 100.' });
    }
    if (input.startsAt && input.expiresAt && new Date(input.expiresAt) <= new Date(input.startsAt)) {
      throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { expiresAt: 'Must be after startsAt.' });
    }
    const { status, ...rest } = input;
    return this.prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon
        .create({
          data: {
            ...rest,
            status,
            active: status === 'ACTIVE',
            createdById: actor.userId,
            startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          },
        })
        .catch((e) => {
          if (e?.code === 'P2002') throw conflict('CONFLICT', 'A coupon with this code already exists.');
          throw e;
        });
      await this.audit.record({ ...actor, action: 'ADMIN_CREATED_COUPON', entityType: 'Coupon', entityId: coupon.id, after: coupon }, tx);
      return coupon;
    });
  }

  async update(id: string, input: UpdateCouponInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.coupon.findUnique({ where: { id } });
      if (!before) throw notFound('Coupon');
      // `status` wins when both are sent. A disabled coupon is never redeemable, and enabling one makes it ACTIVE.
      const nextStatus = input.status ?? (input.active === undefined ? undefined : input.active ? 'ACTIVE' : 'DISABLED');
      if (before.status === 'EXPIRED' && nextStatus === 'ACTIVE' && before.expiresAt && before.expiresAt <= new Date()) {
        throw conflict('CONFLICT', 'Extend the expiry date before reactivating this coupon.');
      }
      const after = await tx.coupon.update({
        where: { id },
        data: {
          ...(nextStatus ? { status: nextStatus, active: nextStatus === 'ACTIVE' } : {}),
          maxRedemptions: input.maxRedemptions,
          startsAt: input.startsAt === undefined ? undefined : input.startsAt ? new Date(input.startsAt) : null,
          expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null,
          name: input.name === undefined ? undefined : input.name,
          description: input.description === undefined ? undefined : input.description,
        },
      });
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_COUPON', entityType: 'Coupon', entityId: id, before, after }, tx);
      return after;
    });
  }

  /** Scheduled: moves ACTIVE coupons past their expiry to EXPIRED. Idempotent. */
  async expireDue(now = new Date()): Promise<number> {
    const r = await this.prisma.coupon.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
    return r.count;
  }
}

@Controller('admin/coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @RequirePermission('coupon.manage') @Get()
  list() { return this.coupons.list(); }

  @RequirePermission('coupon.manage') @Get(':id/redemptions')
  redemptions(@Param('id', new ParseUUIDPipe()) id: string) { return this.coupons.redemptions(id); }

  @RequirePermission('coupon.manage') @Post()
  create(@Body(new ZodPipe(createCouponSchema)) body: CreateCouponInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.coupons.create(body, { userId: u.id, ...clientMeta(req) });
  }

  @RequirePermission('coupon.manage') @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(updateCouponSchema)) body: UpdateCouponInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.coupons.update(id, body, { userId: u.id, ...clientMeta(req) });
  }
}

@Controller('coupons')
export class StudentCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  /** Any signed-in student may check a code. Only the student's own context is used. */
  @Post('preview')
  preview(@Body(new ZodPipe(couponPreviewSchema)) body: CouponPreviewInput, @CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden();
    return this.coupons.preview(u.studentId, u.id, body);
  }
}

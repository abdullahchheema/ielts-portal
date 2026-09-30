import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@ielts/db';
import {
  CreateCouponInput, UpdateCouponInput, createCouponSchema, updateCouponSchema,
} from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { money } from './commerce.helpers';

const invalid = (msg: string) => new AppError('COUPON_INVALID', 422, msg);

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Validates a coupon and atomically claims one redemption. Must run inside the checkout transaction so a
   * failed checkout rolls the claim back. The conditional UPDATE is what stops the last redemption being
   * handed out twice under concurrency.
   */
  async reserveForCheckout(
    tx: Prisma.TransactionClient,
    args: { code: string; studentId: string; userId: string; courseId: string; batchId: string; price: Prisma.Decimal; orderId: string },
  ) {
    const now = new Date();
    const coupon = await tx.coupon.findUnique({ where: { code: args.code } });
    if (!coupon || !coupon.active) throw invalid('This coupon code is not valid.');
    if (coupon.startsAt && coupon.startsAt > now) throw invalid('This coupon is not active yet.');
    if (coupon.expiresAt && coupon.expiresAt <= now) throw invalid('This coupon has expired.');
    if (coupon.courseId && coupon.courseId !== args.courseId) throw invalid('This coupon does not apply to this course.');
    if (coupon.batchId && coupon.batchId !== args.batchId) throw invalid('This coupon does not apply to this batch.');
    if (coupon.userId && coupon.userId !== args.userId) throw invalid('This coupon is not available for your account.');
    if (coupon.minPurchase && args.price.lt(coupon.minPurchase)) throw invalid('The order total is below this coupon’s minimum purchase.');

    if (coupon.firstPurchaseOnly) {
      const paid = await tx.order.count({ where: { studentId: args.studentId, status: 'PAID' } });
      if (paid > 0) throw invalid('This coupon is only valid on a first purchase.');
    }
    const used = await tx.couponRedemption.count({ where: { couponId: coupon.id, studentId: args.studentId, status: { in: ['RESERVED', 'USED'] } } });
    if (used >= coupon.perUserLimit) throw invalid('You have already used this coupon.');

    const claimed = await tx.$executeRaw`
      UPDATE coupons SET redeemed_count = redeemed_count + 1
      WHERE id = ${coupon.id}::uuid AND active AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)`;
    if (claimed === 0) throw invalid('This coupon has reached its redemption limit.');

    const discount = coupon.discountType === 'PERCENTAGE'
      ? money(args.price.mul(coupon.value).div(100))
      : money(Prisma.Decimal.min(coupon.value, args.price));
    if (args.price.sub(discount).lte(0)) throw invalid('This coupon would make the order free. Ask support to enroll you directly.');

    await tx.couponRedemption.create({ data: { couponId: coupon.id, studentId: args.studentId, orderId: args.orderId, status: 'RESERVED' } });
    return { couponId: coupon.id, discount };
  }

  // ───────── admin ─────────
  list() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(input: CreateCouponInput, actor: { userId: string; ip?: string; userAgent?: string }) {
    if (input.discountType === 'PERCENTAGE' && input.value > 100) {
      throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { value: 'A percentage cannot exceed 100.' });
    }
    if (input.startsAt && input.expiresAt && new Date(input.expiresAt) <= new Date(input.startsAt)) {
      throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { expiresAt: 'Must be after startsAt.' });
    }
    return this.prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon
        .create({
          data: {
            ...input,
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

  async update(id: string, input: UpdateCouponInput, actor: { userId: string; ip?: string; userAgent?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.coupon.findUnique({ where: { id } });
      if (!before) throw notFound('Coupon');
      const after = await tx.coupon.update({
        where: { id },
        data: {
          active: input.active,
          maxRedemptions: input.maxRedemptions,
          startsAt: input.startsAt === undefined ? undefined : input.startsAt ? new Date(input.startsAt) : null,
          expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null,
        },
      });
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_COUPON', entityType: 'Coupon', entityId: id, before, after }, tx);
      return after;
    });
  }
}

@Controller('admin/coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @RequirePermission('coupon.manage') @Get()
  list() { return this.coupons.list(); }

  @RequirePermission('coupon.manage') @Post()
  create(@Body(new ZodPipe(createCouponSchema)) body: CreateCouponInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.coupons.create(body, { userId: u.id, ...clientMeta(req) });
  }

  @RequirePermission('coupon.manage') @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(updateCouponSchema)) body: UpdateCouponInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.coupons.update(id, body, { userId: u.id, ...clientMeta(req) });
  }
}

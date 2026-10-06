import { Prisma } from '@ielts/db';
import { money } from './commerce.helpers';

/**
 * Coupon rules as pure functions: no database and no clock (`now` is passed in).
 * Checkout and the preview endpoint both call evaluateCoupon, so the two can never disagree.
 */

export interface CouponFacts {
  status: string;
  active: boolean;
  discountType: 'PERCENTAGE' | 'FIXED';
  value: Prisma.Decimal;
  courseId: string | null;
  batchId: string | null;
  userId: string | null;
  firstPurchaseOnly: boolean;
  perUserLimit: number;
  minPurchase: Prisma.Decimal | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  redeemedCount: number;
}

export interface CouponContext {
  now: Date;
  price: Prisma.Decimal;
  courseId: string;
  batchId: string;
  userId: string;
  /** The student already has a paid order. */
  hasPaidOrder: boolean;
  /** Redemptions this student already holds (RESERVED or USED). */
  usedByStudent: number;
}

export type CouponVerdict = { ok: true; discount: Prisma.Decimal } | { ok: false; reason: string };

/** The discount for a price, rounded to money. A fixed discount never exceeds the price. */
export function couponDiscount(type: 'PERCENTAGE' | 'FIXED', value: Prisma.Decimal, price: Prisma.Decimal): Prisma.Decimal {
  return type === 'PERCENTAGE'
    ? money(price.mul(value).div(100))
    : money(Prisma.Decimal.min(value, price));
}

export function evaluateCoupon(c: CouponFacts, ctx: CouponContext): CouponVerdict {
  const fail = (reason: string): CouponVerdict => ({ ok: false, reason });
  if (c.status !== 'ACTIVE' || !c.active) return fail('This coupon code is not valid.');
  if (c.startsAt && c.startsAt > ctx.now) return fail('This coupon is not active yet.');
  if (c.expiresAt && c.expiresAt <= ctx.now) return fail('This coupon has expired.');
  if (c.courseId && c.courseId !== ctx.courseId) return fail('This coupon does not apply to this course.');
  if (c.batchId && c.batchId !== ctx.batchId) return fail('This coupon does not apply to this batch.');
  if (c.userId && c.userId !== ctx.userId) return fail('This coupon is not available for your account.');
  if (c.minPurchase && ctx.price.lt(c.minPurchase)) return fail('The order total is below this coupon’s minimum purchase.');
  if (c.firstPurchaseOnly && ctx.hasPaidOrder) return fail('This coupon is only valid on a first purchase.');
  if (ctx.usedByStudent >= c.perUserLimit) return fail('You have already used this coupon.');
  if (c.maxRedemptions !== null && c.redeemedCount >= c.maxRedemptions) return fail('This coupon has reached its redemption limit.');

  const discount = couponDiscount(c.discountType, c.value, ctx.price);
  if (ctx.price.sub(discount).lte(0)) return fail('This coupon would make the order free. Ask support to enroll you directly.');
  return { ok: true, discount };
}

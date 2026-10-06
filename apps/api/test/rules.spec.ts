import { Prisma } from '@ielts/db';
import { bankQuestionSchema, QUESTION_SET_TRANSITIONS, referralRewardSettingSchema } from '@ielts/validation';
import { describe, expect, it } from 'vitest';
import { CouponFacts, couponDiscount, evaluateCoupon } from '../src/commerce/coupon-rules';
import { BankCandidate, fnv1a, selectCandidates } from '../src/question-bank/selection';
import {
  canTransition, isSelfReferral, monthStartUtc, qualifiesAfter, referralCodeFrom, REFERRAL_ALPHABET, summarizeReferrals, withinMonthlyCap, displayName,
} from '../src/referrals/referral-rules';

/** Pure business rules for phase 1: question selection, coupon evaluation, referral state and rewards. No database. */

const D = (n: number | string) => new Prisma.Decimal(n);
const NOW = new Date('2026-10-06T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('question selection', () => {
  const pool: BankCandidate[] = Array.from({ length: 30 }, (_, i) => ({
    id: `q${i}`, setId: `s${Math.floor(i / 5)}`, difficulty: (i % 5) + 1, topic: i % 2 ? 'travel' : 'health', ieltsType: i % 3 ? 'MCQ_SINGLE' : 'TFNG',
  }));

  it('returns the same selection for the same seed', () => {
    const a = selectCandidates(pool, { count: 8, seed: 'student-1|2026-10-06' });
    const b = selectCandidates(pool, { count: 8, seed: 'student-1|2026-10-06' });
    expect(a).toEqual(b);
    expect(a).toHaveLength(8);
  });

  it('changes the selection when the seed changes', () => {
    const a = selectCandidates(pool, { count: 8, seed: 'student-1|2026-10-06' });
    const b = selectCandidates(pool, { count: 8, seed: 'student-2|2026-10-06' });
    expect(a).not.toEqual(b);
  });

  it('spreads across passages before taking a second question from one', () => {
    const picked = selectCandidates(pool, { count: 6, seed: 'x' });
    const sets = new Set(picked.map((id) => pool.find((c) => c.id === id)!.setId));
    expect(sets.size).toBe(6);
  });

  it('respects topic, difficulty and item type filters', () => {
    const picked = selectCandidates(pool, { count: 50, seed: 'x', topic: 'health', difficulty: { min: 2, max: 3 }, ieltsTypes: ['TFNG'] });
    for (const id of picked) {
      const c = pool.find((x) => x.id === id)!;
      expect(c.topic).toBe('health');
      expect(c.difficulty).toBeGreaterThanOrEqual(2);
      expect(c.difficulty).toBeLessThanOrEqual(3);
      expect(c.ieltsType).toBe('TFNG');
    }
  });

  it('avoids excluded questions while enough remain, and recycles only when it must', () => {
    const exclude = new Set(pool.slice(0, 25).map((c) => c.id));
    const fresh = selectCandidates(pool, { count: 5, seed: 'x', exclude });
    expect(fresh.every((id) => !exclude.has(id))).toBe(true);
    const forced = selectCandidates(pool, { count: 10, seed: 'x', exclude });
    expect(forced).toHaveLength(10);
  });

  it('hash is stable and 32-bit', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).toBeLessThan(2 ** 32);
  });
});

describe('question type rules', () => {
  const base = { prompt: { text: 'Question' }, marks: 1 };
  it('a true/false/not-given item needs a key', () => {
    expect(bankQuestionSchema.safeParse({ ...base, ieltsType: 'TFNG' }).success).toBe(false);
    expect(bankQuestionSchema.safeParse({ ...base, ieltsType: 'TFNG', answerKey: { value: 'NOT_GIVEN' } }).success).toBe(true);
  });
  it('a single-choice item needs exactly one correct option', () => {
    const two = { ...base, ieltsType: 'MCQ_SINGLE', options: [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: true }] };
    expect(bankQuestionSchema.safeParse(two).success).toBe(false);
    expect(bankQuestionSchema.safeParse({ ...two, options: [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: false }] }).success).toBe(true);
  });
  it('writing and speaking prompts need no key', () => {
    expect(bankQuestionSchema.safeParse({ ...base, ieltsType: 'WRITING_TASK2' }).success).toBe(true);
  });
});

describe('question set status moves', () => {
  it('a published set can only be archived, never edited back into draft', () => {
    expect(QUESTION_SET_TRANSITIONS.PUBLISHED).toEqual(['ARCHIVED']);
  });
  it('an archived set cannot move at all', () => {
    expect(QUESTION_SET_TRANSITIONS.ARCHIVED).toEqual([]);
  });
});

describe('coupon discount', () => {
  it('percentage discounts are rounded to money', () => {
    expect(couponDiscount('PERCENTAGE', D(10), D(45000)).toFixed(2)).toBe('4500.00');
    expect(couponDiscount('PERCENTAGE', D(33.33), D(100)).toFixed(2)).toBe('33.33');
  });
  it('a fixed discount never exceeds the price', () => {
    expect(couponDiscount('FIXED', D(5000), D(1200)).toFixed(2)).toBe('1200.00');
  });
});

describe('coupon evaluation', () => {
  const COURSE = 'course-1';
  const BATCH = 'batch-1';
  const USER = 'user-1';
  const base: CouponFacts = {
    status: 'ACTIVE', active: true, discountType: 'PERCENTAGE', value: D(10), courseId: null, batchId: null, userId: null,
    firstPurchaseOnly: false, perUserLimit: 1, minPurchase: null, startsAt: null, expiresAt: null, maxRedemptions: null, redeemedCount: 0,
  };
  const ctx = { now: NOW, price: D(45000), courseId: COURSE, batchId: BATCH, userId: USER, hasPaidOrder: false, usedByStudent: 0 };
  const reason = (c: Partial<CouponFacts>, x: Partial<typeof ctx> = {}) => {
    const v = evaluateCoupon({ ...base, ...c }, { ...ctx, ...x });
    return v.ok ? null : v.reason;
  };

  it('a valid coupon returns its discount', () => {
    const v = evaluateCoupon(base, ctx);
    expect(v.ok && v.discount.toFixed(2)).toBe('4500.00');
  });
  it('draft and disabled coupons are not redeemable', () => {
    expect(reason({ status: 'DRAFT' })).toMatch(/not valid/);
    expect(reason({ status: 'ACTIVE', active: false })).toMatch(/not valid/);
  });
  it('enforces the start and expiry dates', () => {
    expect(reason({ startsAt: day(1) })).toMatch(/not active yet/);
    expect(reason({ expiresAt: day(-1) })).toMatch(/expired/);
    expect(reason({ expiresAt: day(1) })).toBeNull();
  });
  it('enforces course, batch and account restrictions', () => {
    expect(reason({ courseId: 'other' })).toMatch(/this course/);
    expect(reason({ batchId: 'other' })).toMatch(/this batch/);
    expect(reason({ userId: 'someone-else' })).toMatch(/your account/);
  });
  it('enforces minimum purchase, first-purchase-only and per-user limits', () => {
    expect(reason({ minPurchase: D(60000) })).toMatch(/minimum/);
    expect(reason({ firstPurchaseOnly: true }, { hasPaidOrder: true })).toMatch(/first purchase/);
    expect(reason({ perUserLimit: 1 }, { usedByStudent: 1 })).toMatch(/already used/);
  });
  it('enforces the total redemption limit', () => {
    expect(reason({ maxRedemptions: 10, redeemedCount: 10 })).toMatch(/redemption limit/);
  });
  it('refuses a coupon that would make the order free', () => {
    expect(reason({ discountType: 'FIXED', value: D(50000) })).toMatch(/free/);
  });
});

describe('referral state machine', () => {
  it('moves forward only', () => {
    expect(canTransition('REGISTERED', 'APPLIED')).toBe(true);
    expect(canTransition('APPLIED', 'ENROLLED')).toBe(true);
    expect(canTransition('ENROLLED', 'QUALIFIED')).toBe(true);
    expect(canTransition('QUALIFIED', 'REWARDED')).toBe(true);
    expect(canTransition('ENROLLED', 'APPLIED')).toBe(false);
    expect(canTransition('QUALIFIED', 'ENROLLED')).toBe(false);
  });
  it('rewarded and rejected referrals are terminal', () => {
    expect(canTransition('REWARDED', 'REJECTED')).toBe(false);
    expect(canTransition('REJECTED', 'REGISTERED')).toBe(false);
    expect(canTransition('REJECTED', 'REJECTED')).toBe(false);
  });
  it('any open referral can be rejected', () => {
    for (const s of ['REGISTERED', 'APPLIED', 'ENROLLED', 'QUALIFIED'] as const) expect(canTransition(s, 'REJECTED')).toBe(true);
  });
  it('the same state is never a transition', () => {
    expect(canTransition('APPLIED', 'APPLIED')).toBe(false);
  });
});

describe('self-referral prevention', () => {
  const me = { userId: 'u1', email: 'Ali@Example.com', phone: '+92 300 1234567' };
  it('the same account is self-referral', () => {
    expect(isSelfReferral(me, { ...me, email: 'other@example.com', phone: null })).toBe(true);
  });
  it('the same email in a different case is self-referral', () => {
    expect(isSelfReferral(me, { userId: 'u2', email: 'ali@example.com' })).toBe(true);
  });
  it('the same phone number in another format is self-referral', () => {
    expect(isSelfReferral(me, { userId: 'u2', email: 'x@example.com', phone: '92-300-1234567' })).toBe(true);
  });
  it('an unrelated person is not', () => {
    expect(isSelfReferral(me, { userId: 'u2', email: 'sara@example.com', phone: '0311 9999999' })).toBe(false);
  });
  it('short or empty phone numbers never match', () => {
    expect(isSelfReferral({ userId: 'a', email: 'a@x.com', phone: '' }, { userId: 'b', email: 'b@x.com', phone: '' })).toBe(false);
  });
});

describe('referral rewards and limits', () => {
  it('a monthly cap stops rewards at the limit', () => {
    expect(withinMonthlyCap(4, 5)).toBe(true);
    expect(withinMonthlyCap(5, 5)).toBe(false);
  });
  it('the month window starts on the first day in UTC', () => {
    expect(monthStartUtc(new Date('2026-10-06T23:59:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('a referral qualifies only after the configured number of days', () => {
    expect(qualifiesAfter(day(-13), NOW, 14)).toBe(false);
    expect(qualifiesAfter(day(-14), NOW, 14)).toBe(true);
  });
  it('reward settings must name a known type and a positive value', () => {
    expect(referralRewardSettingSchema.safeParse({ type: 'COUPON_PERCENT', value: 10 }).success).toBe(true);
    expect(referralRewardSettingSchema.safeParse({ type: 'CASH', value: 10 }).success).toBe(false);
    expect(referralRewardSettingSchema.safeParse({ type: 'ACCOUNT_CREDIT', value: 0 }).success).toBe(false);
  });
  it('codes use the unambiguous alphabet and the requested length', () => {
    const code = referralCodeFrom(() => 0.999, 8);
    expect(code).toHaveLength(8);
    for (const ch of code) expect(REFERRAL_ALPHABET).toContain(ch);
    expect(REFERRAL_ALPHABET).not.toMatch(/[01IOL]/);
  });
  it('summarises statuses into the counts the student sees', () => {
    expect(summarizeReferrals(['REGISTERED', 'APPLIED', 'ENROLLED', 'QUALIFIED', 'REWARDED', 'REJECTED'])).toEqual({
      total: 6, pending: 3, successful: 2, rewarded: 1, rejected: 1,
    });
  });
  it('shows only the first name and an initial', () => {
    expect(displayName('Ayesha', 'Khan')).toBe('Ayesha K.');
  });
});

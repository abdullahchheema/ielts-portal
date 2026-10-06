import { describe, expect, it } from 'vitest';
import { creditToApply, MIN_PAYABLE } from '../src/referrals/credit-rules';

/** Checkout credit rule. Pure. Credit is capped by the balance and by the order, and one unit always stays payable. */
describe('creditToApply', () => {
  it('spends no credit unless the student asks for it', () => {
    expect(creditToApply(500, 10000, false)).toBe(0);
  });
  it('spends no credit with no balance', () => {
    expect(creditToApply(0, 10000, true)).toBe(0);
    expect(creditToApply(-5, 10000, true)).toBe(0);
  });
  it('spends the smaller of the balance and the order', () => {
    expect(creditToApply(500, 10000, true)).toBe(500);
    expect(creditToApply(20000, 10000, true)).toBe(10000 - MIN_PAYABLE);
  });
  it('never makes the order free', () => {
    expect(creditToApply(10000, 10000, true)).toBe(10000 - MIN_PAYABLE);
    expect(creditToApply(1, 1, true)).toBe(0);
  });
  it('keeps two decimals', () => {
    expect(creditToApply(12.345, 100, true)).toBe(12.35);
  });
});

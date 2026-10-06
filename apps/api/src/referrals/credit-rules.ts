/**
 * Account credit at checkout. Pure: no database. Credit can reduce an order but never make it free.
 */

/** The smallest amount an order can still ask the student to pay. */
export const MIN_PAYABLE = 1;

/** The credit to spend. Amounts are in currency units with two decimals. */
export function creditToApply(balance: number, payableBeforeCredit: number, requested: boolean): number {
  if (!requested || balance <= 0) return 0;
  const cap = Math.max(0, payableBeforeCredit - MIN_PAYABLE);
  const applied = Math.min(balance, cap);
  return Math.round(applied * 100) / 100;
}

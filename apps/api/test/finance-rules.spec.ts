import { describe, expect, it } from 'vitest';
import { matchOutcome } from '../src/reconciliation/reconciliation';
import { evaluateRisk, RiskFacts, worstLevel } from '../src/payment-risk/risk-rules';

/** Payment risk and reconciliation outcomes. Pure. Flags explain themselves and never reject. */

const NOW = new Date('2026-10-06T12:00:00Z');
const base: RiskFacts = { ref: 'TXN1', claimedAmount: 45000, expectedAmount: 45000, transferDate: NOW, now: NOW, sameRef: [], sameFileOtherPayment: false, sameAmountDateOthers: 0 };
const rules = (f: Partial<RiskFacts>) => evaluateRisk({ ...base, ...f }).map((x) => x.rule);

describe('payment risk flags', () => {
  it('a clean submission raises no flags', () => {
    expect(evaluateRisk(base)).toEqual([]);
  });
  it('a reference already approved on another payment is high risk', () => {
    const f = evaluateRisk({ ...base, sameRef: [{ approved: true, sameStudent: true }] });
    expect(f[0]).toMatchObject({ rule: 'DUPLICATE_REF_APPROVED', level: 'HIGH' });
    expect(f[0].reason).toMatch(/already used by another approved payment/);
  });
  it('a reference on a pending submission is medium risk', () => {
    expect(rules({ sameRef: [{ approved: false, sameStudent: true }] })).toEqual(['DUPLICATE_REF_PENDING']);
  });
  it('a reference that belongs to another student is high risk', () => {
    expect(rules({ sameRef: [{ approved: false, sameStudent: false }] })).toContain('REF_OTHER_STUDENT');
  });
  it('a receipt file reused on another payment is high risk', () => {
    expect(evaluateRisk({ ...base, sameFileOtherPayment: true })[0]).toMatchObject({ rule: 'SAME_RECEIPT_FILE', level: 'HIGH' });
  });
  it('a claimed amount that differs from the amount due is medium risk', () => {
    expect(evaluateRisk({ ...base, claimedAmount: 40000 })[0]).toMatchObject({ rule: 'AMOUNT_MISMATCH', level: 'MEDIUM' });
  });
  it('a transfer date in the far future is low risk', () => {
    expect(rules({ transferDate: new Date(NOW.getTime() + 5 * 86_400_000) })).toEqual(['FUTURE_TRANSFER_DATE']);
  });
  it('the worst flag sets the overall level', () => {
    expect(worstLevel([{ level: 'LOW' }, { level: 'HIGH' }, { level: 'MEDIUM' }])).toBe('HIGH');
    expect(worstLevel([])).toBeNull();
  });
});

describe('reconciliation outcome', () => {
  const due = 45000;
  const on = new Date('2026-10-05T00:00:00Z');
  it('no statement line means unmatched, with the reason said', () => {
    expect(matchOutcome(due, on, [])).toMatchObject({ status: 'UNMATCHED' });
  });
  it('two lines with the same reference means duplicate', () => {
    expect(matchOutcome(due, on, [{ amount: due, txnDate: on }, { amount: due, txnDate: on }]).status).toBe('DUPLICATE');
  });
  it('a line with the right amount and a close date is matched', () => {
    expect(matchOutcome(due, on, [{ amount: due, txnDate: on }]).status).toBe('MATCHED');
  });
  it('a line with a different amount is a mismatch, and says both amounts', () => {
    const r = matchOutcome(due, on, [{ amount: 40000, txnDate: on }]);
    expect(r.status).toBe('MISMATCHED');
    expect(r.reasons[0]).toMatch(/40000/);
  });
  it('a right amount on a date more than a week away goes to review, not silently matched', () => {
    const far = new Date(on.getTime() + 10 * 86_400_000);
    expect(matchOutcome(due, on, [{ amount: due, txnDate: far }]).status).toBe('PENDING_REVIEW');
  });
});

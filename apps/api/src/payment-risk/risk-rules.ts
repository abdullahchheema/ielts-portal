/**
 * Payment risk rules as pure functions. A flag explains itself in plain words and never rejects a payment: a person
 * decides on every flag. No database and no clock here; `now` is passed in.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export interface RiskFlag { rule: string; level: RiskLevel; reason: string }

export interface RiskFacts {
  ref: string;
  claimedAmount: number;
  expectedAmount: number;
  transferDate: Date;
  now: Date;
  /** Other receipts with the same transaction reference. */
  sameRef: { approved: boolean; sameStudent: boolean }[];
  /** Another payment already uses this exact receipt file. */
  sameFileOtherPayment: boolean;
  /** Other students' receipts with the same amount, method and date. */
  sameAmountDateOthers: number;
}

const DAY = 86_400_000;

export function evaluateRisk(f: RiskFacts): RiskFlag[] {
  const out: RiskFlag[] = [];
  if (f.sameRef.some((r) => r.approved)) {
    out.push({ rule: 'DUPLICATE_REF_APPROVED', level: 'HIGH', reason: 'Transaction reference already used by another approved payment.' });
  } else if (f.sameRef.length > 0) {
    out.push({ rule: 'DUPLICATE_REF_PENDING', level: 'MEDIUM', reason: 'Transaction reference also appears on another submission.' });
  }
  if (f.sameRef.some((r) => !r.sameStudent)) {
    out.push({ rule: 'REF_OTHER_STUDENT', level: 'HIGH', reason: 'This transaction reference belongs to a different student’s payment.' });
  }
  if (f.sameFileOtherPayment) {
    out.push({ rule: 'SAME_RECEIPT_FILE', level: 'HIGH', reason: 'This receipt file was already used for another payment.' });
  }
  if (Math.abs(f.claimedAmount - f.expectedAmount) > 0.01) {
    out.push({ rule: 'AMOUNT_MISMATCH', level: 'MEDIUM', reason: `Claimed amount ${f.claimedAmount} differs from the amount due ${f.expectedAmount}.` });
  }
  if (f.sameAmountDateOthers > 0) {
    out.push({ rule: 'AMOUNT_TIMING_PATTERN', level: 'LOW', reason: `${f.sameAmountDateOthers} other submission${f.sameAmountDateOthers === 1 ? ' has' : 's have'} the same amount, method and date.` });
  }
  if (f.transferDate.getTime() > f.now.getTime() + DAY) {
    out.push({ rule: 'FUTURE_TRANSFER_DATE', level: 'LOW', reason: 'The transfer date is in the future.' });
  }
  return out;
}

const RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
/** The worst level among the flags, or null when there are none. */
export function worstLevel(flags: { level: RiskLevel }[]): RiskLevel | null {
  return flags.reduce<RiskLevel | null>((acc, f) => (acc === null || RANK[f.level] > RANK[acc] ? f.level : acc), null);
}

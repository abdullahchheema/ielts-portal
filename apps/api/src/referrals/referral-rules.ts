/**
 * Referral rules as pure functions. No database and no clock: `now` and any randomness are passed in.
 */

export const REFERRAL_ORDER = ['REGISTERED', 'APPLIED', 'ENROLLED', 'QUALIFIED', 'REWARDED'] as const;
export type ReferralStatus = (typeof REFERRAL_ORDER)[number] | 'REJECTED';

/** Forward-only. REWARDED and REJECTED are terminal; a rewarded referral can never be rejected after the fact. */
export function canTransition(from: ReferralStatus, to: ReferralStatus): boolean {
  if (from === 'REJECTED' || from === 'REWARDED' || from === to) return false;
  if (to === 'REJECTED') return true;
  return REFERRAL_ORDER.indexOf(to) > REFERRAL_ORDER.indexOf(from);
}

export interface Person { userId: string; email: string; phone?: string | null }

const digits = (p?: string | null) => (p ?? '').replace(/\D/g, '');

/**
 * Self-referral: the same account, the same email (case-insensitive), or the same phone number.
 * A phone match needs at least seven digits so that empty or placeholder numbers never match.
 */
export function isSelfReferral(referrer: Person, referred: Person): boolean {
  if (referrer.userId === referred.userId) return true;
  if (referrer.email.trim().toLowerCase() === referred.email.trim().toLowerCase()) return true;
  const a = digits(referrer.phone);
  const b = digits(referred.phone);
  return a.length >= 7 && a === b;
}

export type RewardSetting = { type: 'ACCOUNT_CREDIT' | 'COUPON_FIXED' | 'COUPON_PERCENT'; value: number };

/** The reward for one qualified referral. Account credit is a currency amount; coupons are a fixed or percent discount. */
export function rewardFor(setting: RewardSetting): { type: RewardSetting['type']; amount: number } {
  return { type: setting.type, amount: setting.value };
}

/** A referrer may earn at most `cap` rewards per calendar month. */
export function withinMonthlyCap(rewardedThisMonth: number, cap: number): boolean {
  return rewardedThisMonth < cap;
}

/** Start of the calendar month containing `now`, in UTC. Used for the monthly cap window. */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** A referral qualifies once it has been enrolled for at least `days` days. */
export function qualifiesAfter(enrolledAt: Date, now: Date, days: number): boolean {
  return now.getTime() - enrolledAt.getTime() >= days * 86_400_000;
}

/** Unambiguous alphabet: no 0/O, 1/I/L. */
export const REFERRAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Builds an 8-character code from a random source in [0, 1). The caller supplies the randomness. */
export function referralCodeFrom(random: () => number, length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += REFERRAL_ALPHABET[Math.floor(random() * REFERRAL_ALPHABET.length)];
  return out;
}

/** Counts shown on the student's referral page. Successful = qualified or rewarded. */
export function summarizeReferrals(statuses: ReferralStatus[]) {
  const count = (...s: ReferralStatus[]) => statuses.filter((x) => s.includes(x)).length;
  return {
    total: statuses.length,
    pending: count('REGISTERED', 'APPLIED', 'ENROLLED'),
    successful: count('QUALIFIED', 'REWARDED'),
    rewarded: count('REWARDED'),
    rejected: count('REJECTED'),
  };
}

/** Initial letter of a referred student's last name, so one student's referrals are never shown in full. */
export const displayName = (first: string, last: string) => `${first.trim()} ${last.trim().charAt(0).toUpperCase()}.`;

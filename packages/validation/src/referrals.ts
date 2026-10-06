import { z } from 'zod';

/** Referral codes are 6–12 characters, uppercase letters and digits, with no look-alike characters. */
export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{6,12}$/;

export const referralClickSchema = z.object({
  code: z.string().trim().toUpperCase().regex(REFERRAL_CODE_RE, 'Invalid referral code'),
});

export const referralAttributeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(REFERRAL_CODE_RE, 'Invalid referral code'),
});

export const referralRejectSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const referralRewardSettingSchema = z.object({
  type: z.enum(['ACCOUNT_CREDIT', 'COUPON_FIXED', 'COUPON_PERCENT']),
  value: z.number().positive().max(100_000_000),
});

export type ReferralRejectInput = z.infer<typeof referralRejectSchema>;
export type ReferralRewardSetting = z.infer<typeof referralRewardSettingSchema>;

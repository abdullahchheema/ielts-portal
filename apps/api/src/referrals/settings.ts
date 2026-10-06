import { referralRewardSettingSchema } from '@ielts/validation';
import { z } from 'zod';

/**
 * Referral programme settings. They live in the Setting table so staff can change them without a deploy,
 * and every change is audited by SettingsService like the other settings.
 */
export const REFERRAL_SETTING_SCHEMAS = {
  'referrals.reward': referralRewardSettingSchema,
  'referrals.monthly_cap': z.number().int().min(1).max(100),
  'referrals.qualify_after_days': z.number().int().min(0).max(365),
  'referrals.auto_reward': z.boolean(),
} as const;

export const REFERRAL_DEFAULTS = {
  'referrals.reward': { type: 'ACCOUNT_CREDIT', value: 1000 },
  'referrals.monthly_cap': 5,
  'referrals.qualify_after_days': 14,
  'referrals.auto_reward': false,
} as const;

import { z } from 'zod';
import { COUNTRIES, PAKISTAN_CITIES, TEST_TYPES } from './lists';

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Multipart fields arrive as strings; blank optional fields become undefined. */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const choice = <T extends readonly [string, ...string[]]>(values: T, message: string) => z.enum(values, { errorMap: () => ({ message }) });

/** Details every applicant provides about their payment. */
export const applicationPaymentSchema = z.object({
  batchId: z.string().uuid(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  transactionReference: z.string().trim().min(4, 'Enter the transaction / reference number from your receipt').max(80),
  claimedAmount: z.coerce.number({ invalid_type_error: 'Enter the amount you paid' }).positive('Enter the amount you paid').max(100_000_000),
  transferDate: z.string().date('Enter the payment date'),
  senderName: optionalText(120),
  couponCode: z.preprocess(blank, z.string().trim().toUpperCase().min(2).max(40).optional()),
  /** Spend account credit on this order. Never makes the order free: at least one unit stays payable. */
  useCredit: z.preprocess((v) => v === true || v === 'true' || v === 'on', z.boolean().default(false)),
});

/** Background and contact details collected on the enrollment form, once the applicant has a verified account. */
export const applicantProfileSchema = z
  .object({
    phone: z.string().trim().min(6, 'Enter a phone number we can reach you on').max(20),
    city: choice(PAKISTAN_CITIES, 'Choose your city'),
    country: choice(COUNTRIES, 'Choose your country'),
    testType: choice(TEST_TYPES, 'Choose the test you are preparing for'),
    targetBand: z.coerce.number({ invalid_type_error: 'Choose your target band' }).min(0).max(9).refine((n) => Number.isInteger(n * 2), 'Use steps of 0.5'),
    examDate: z.string().date('Enter your planned exam date'),
    ieltsHistory: z.enum(['NEVER', 'TAKEN'], { errorMap: () => ({ message: 'Tell us whether you have taken IELTS before' }) }),
    ieltsOverall: z.preprocess(blank, z.coerce.number().min(0).max(9).refine((n) => Number.isInteger(n * 2), 'Use steps of 0.5').optional()),
  })
  .refine((v) => v.ieltsHistory !== 'TAKEN' || v.ieltsOverall !== undefined, { message: 'Choose your overall band', path: ['ieltsOverall'] });

export const approveProofSchema = z.object({
  /** Required when the claimed amount differs from the order total. */
  confirmAmountMismatch: z.boolean().default(false),
  note: z.string().max(500).optional(),
});

export const rejectProofSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  allowResubmit: z.boolean().default(true),
});

export const ENROLLMENT_SOURCES = ['ADMIN', 'SCHOLARSHIP', 'CORPORATE', 'PROMOTION', 'MIGRATION'] as const;

export const manualEnrollmentSchema = z
  .object({
    studentId: z.string().uuid().optional(),
    studentEmail: z.string().trim().toLowerCase().email().optional(),
    batchId: z.string().uuid(),
    source: z.enum(ENROLLMENT_SOURCES),
    reason: z.string().trim().min(3).max(500),
    accessDays: z.number().int().min(1).max(3650).optional(),
  })
  .refine((v) => v.studentId || v.studentEmail, { message: 'Provide studentId or studentEmail.', path: ['studentId'] });

export const createCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(40).regex(/^[A-Z0-9_-]+$/, 'Letters, numbers, dash and underscore only'),
  discountType: z.enum(['PERCENTAGE', 'FIXED']),
  value: z.number().positive().max(100_000_000),
  courseId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['DRAFT', 'ACTIVE']).default('ACTIVE'),
  firstPurchaseOnly: z.boolean().default(false),
  maxRedemptions: z.number().int().min(1).optional(),
  perUserLimit: z.number().int().min(1).default(1),
  minPurchase: z.number().min(0).optional(),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});
/** Students check a code against a batch before paying. Read-only: nothing is reserved. */
export const couponPreviewSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(40),
  batchId: z.string().uuid(),
});

export const updateCouponSchema = z.object({
  active: z.boolean().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'DISABLED']).optional(),
  name: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
});

export type ApproveProofInput = z.infer<typeof approveProofSchema>;
export type RejectProofInput = z.infer<typeof rejectProofSchema>;
export type ManualEnrollmentInput = z.infer<typeof manualEnrollmentSchema>;
export type CouponPreviewInput = z.infer<typeof couponPreviewSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

export type ApplicationPaymentInput = z.infer<typeof applicationPaymentSchema>;
export type ApplicantProfileInput = z.infer<typeof applicantProfileSchema>;

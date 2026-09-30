import { ApiError } from './api';

/** Friendly copy per error code; falls back to the server's message. */
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  ACCOUNT_NOT_VERIFIED: 'Please verify your email first — check your inbox for the link.',
  ACCOUNT_SUSPENDED: 'This account is not active. Please contact support.',
  ACCOUNT_LOCKED: 'Too many failed attempts. Try again in 15 minutes.',
  TOO_MANY_LOGIN_ATTEMPTS: 'Too many attempts. Please wait a few minutes and try again.',
  EMAIL_ALREADY_REGISTERED: 'An account with this email already exists. Try logging in instead.',
  MFA_REQUIRED: 'Enter the 6-digit code from your authenticator app.',
  PROOF_REQUIRED: 'Please attach a screenshot or PDF of your payment receipt.',
  DUPLICATE_PAYMENT_PROOF: 'Another verified payment already uses this reference number.',
  BATCH_NOT_OPEN: 'This batch is not open for enrollment.',
  ENROLLMENT_ALREADY_EXISTS: 'You have already applied to this batch.',
  COUPON_INVALID: 'That coupon cannot be used.',
  PAYMENT_PENDING: 'Your payment is still being verified. This unlocks once the academy confirms it.',
  ORDER_ALREADY_PAID: 'This payment has already been processed.',
  PAYMENT_AMOUNT_MISMATCH: 'The amount entered does not match the order total.',
  FILE_TOO_LARGE: 'That file is too large.',
  UNSUPPORTED_FILE_TYPE: 'Unsupported file type.',
  CONTENT_LOCKED: 'This lesson is locked.',
  CONTENT_NOT_RELEASED: 'This lesson has not been released yet.',
  PREREQUISITE_REQUIRED: 'Complete the previous lesson first.',
  ACCESS_EXPIRED: 'Your access to this course has expired.',
  FORBIDDEN: 'You do not have permission to do that.',
  VERSION_PUBLISHED_IMMUTABLE: 'Published versions are read-only. Create a new version to make changes.',
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? e.message;
  return 'Something went wrong. Please try again.';
}

export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError && e.details ? e.details : {};
}

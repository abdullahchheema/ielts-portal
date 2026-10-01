import { label } from './format';

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Administrator',
  ACADEMIC_ADMIN: 'Academic Coordinator',
  CONTENT_MANAGER: 'Content Manager',
  FINANCE_ADMIN: 'Finance Officer',
  SUPPORT_AGENT: 'Student Support Officer',
  MARKETING: 'Marketing Officer',
  MENTOR: 'Teacher',
};

/** Friendly display name for a role key, falling back to the generic label() formatter. */
export const roleLabel = (key: string): string => ROLE_LABELS[key] ?? label(key);

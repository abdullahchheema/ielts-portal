import { z } from 'zod';

/** Alumni area settings. Stored in the Setting table and audited like the other settings. */
export const LIFECYCLE_SETTING_SCHEMAS = {
  'alumni.access': z.object({ enabled: z.boolean() }).strict(),
} as const;

export const LIFECYCLE_DEFAULTS = {
  'alumni.access': { enabled: true },
} as const;

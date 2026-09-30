import { z } from 'zod';

export const bandSchema = z
  .number()
  .min(0)
  .max(9)
  .refine((n) => Number.isInteger(n * 2), 'Band must be in steps of 0.5');

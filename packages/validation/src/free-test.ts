import { z } from 'zod';
import { emailSchema } from './index-base';

export const claimFreeTestSchema = z.object({
  email: emailSchema,
  phone: z.string().trim().min(6).max(20),
});

export const freeTestConfigSchema = z.object({
  name: z.string().trim().min(2).max(120),
  assessmentId: z.string().uuid(),
  sequence: z.number().int().min(0).max(100).default(0),
});
export const updateFreeTestConfigSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  active: z.boolean().optional(),
  sequence: z.number().int().min(0).max(100).optional(),
});

export type ClaimFreeTestInput = z.infer<typeof claimFreeTestSchema>;
export type FreeTestConfigInput = z.infer<typeof freeTestConfigSchema>;
export type UpdateFreeTestConfigInput = z.infer<typeof updateFreeTestConfigSchema>;

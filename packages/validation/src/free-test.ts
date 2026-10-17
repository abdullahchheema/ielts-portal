import { z } from 'zod';
import { emailSchema } from './index-base';

export const claimFreeTestSchema = z.object({
  email: emailSchema,
  phone: z.string().trim().min(6).max(20),
});

export type ClaimFreeTestInput = z.infer<typeof claimFreeTestSchema>;

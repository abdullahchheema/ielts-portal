import { z } from 'zod';

/** Mock-test access control: a student requests access to one mock test; a teacher/admin approves,
 *  declines, or opens the same mock for an entire batch at once (spec: mock-test access control). */

export const mockAccessRequestSchema = z.object({ reason: z.string().trim().max(500).optional() });
export type MockAccessRequestInput = z.infer<typeof mockAccessRequestSchema>;

export const mockAccessDecisionSchema = z.object({
  decisionNote: z.string().trim().max(1000).optional(),
  availableFrom: z.string().datetime().optional(),
  availableUntil: z.string().datetime().optional(),
});
export type MockAccessDecisionInput = z.infer<typeof mockAccessDecisionSchema>;

export const mockActivationSchema = z.object({
  batchId: z.string().uuid(),
  availableFrom: z.string().datetime(),
  availableUntil: z.string().datetime().optional(),
  instructions: z.string().trim().max(2000).optional(),
}).refine((v) => !v.availableUntil || new Date(v.availableUntil) > new Date(v.availableFrom), { message: 'Must be after the start.', path: ['availableUntil'] });
export type MockActivationInput = z.infer<typeof mockActivationSchema>;

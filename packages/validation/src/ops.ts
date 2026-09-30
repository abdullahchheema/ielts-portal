import { z } from 'zod';

// ── refunds ──
export const refundRequestSchema = z.object({ reason: z.string().trim().min(5).max(1000) });
export const refundCreateSchema = z.object({
  amount: z.number().positive().max(100_000_000),
  reason: z.string().trim().min(3).max(1000),
});
export const refundProcessSchema = z.object({
  /** The bank reference of the payout you made to the student. */
  providerReference: z.string().trim().min(3).max(120),
  note: z.string().trim().max(1000).optional(),
});
export const refundRejectSchema = z.object({ note: z.string().trim().min(3).max(1000) });

// ── live sessions & attendance ──
const httpsUrl = z.string().url().max(500).refine((u) => u.startsWith('https://'), 'Use an https:// link');
export const sessionSchema = z.object({
  topic: z.string().trim().min(2).max(160),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  provider: z.enum(['ZOOM', 'GOOGLE_MEET', 'TEAMS', 'OTHER']).optional(),
  meetingUrl: httpsUrl.optional(),
  recordingUrl: httpsUrl.nullable().optional(),
});
export const updateSessionSchema = sessionSchema.partial();
export const attendanceSchema = z.object({
  records: z.array(z.object({
    studentId: z.string().uuid(),
    status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
    minutesAttended: z.number().int().min(0).max(600).optional(),
  })).min(1).max(500),
});

// ── support ──
export const TICKET_CATEGORIES = ['ACCOUNT', 'PAYMENT', 'COURSE', 'TECHNICAL', 'CLASS', 'ASSESSMENT', 'MENTOR', 'OTHER'] as const;
export const ticketCreateSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(5000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
});
export const ticketMessageSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export const staffTicketMessageSchema = ticketMessageSchema.extend({ internal: z.boolean().default(false) });
export const ticketUpdateSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_FOR_STUDENT', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export type RefundRequestInput = z.infer<typeof refundRequestSchema>;
export type RefundCreateInput = z.infer<typeof refundCreateSchema>;
export type RefundProcessInput = z.infer<typeof refundProcessSchema>;
export type RefundRejectInput = z.infer<typeof refundRejectSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type AttendanceInput = z.infer<typeof attendanceSchema>;
export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;
export type TicketMessageInput = z.infer<typeof ticketMessageSchema>;
export type StaffTicketMessageInput = z.infer<typeof staffTicketMessageSchema>;
export type TicketUpdateInput = z.infer<typeof ticketUpdateSchema>;

// ── enrollment lifecycle ──
export const enrollmentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('PAUSE'), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('RESUME'), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('EXTEND'), days: z.number().int().min(1).max(730), note: z.string().trim().max(500).optional() }),
]);
export const transferSchema = z.object({
  toBatchId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export type EnrollmentActionInput = z.infer<typeof enrollmentActionSchema>;
export type TransferInput = z.infer<typeof transferSchema>;

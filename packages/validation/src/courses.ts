import { z } from 'zod';

export const CONTENT_TYPES = [
  'VIDEO', 'PDF', 'TEXT', 'AUDIO', 'QUIZ', 'ASSIGNMENT', 'LISTENING_TEST', 'READING_TEST',
  'WRITING_TASK', 'SPEAKING_TASK', 'LIVE_SESSION', 'EXTERNAL_LINK', 'DOWNLOAD', 'MOCK_TEST',
] as const;

export const RELEASE_TYPES = ['IMMEDIATE', 'BATCH_DATE', 'RELATIVE', 'PREREQUISITE', 'SCORE_BASED', 'MANUAL'] as const;

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes');

export const createCourseSchema = z.object({
  code: z.string().trim().min(2).max(30).toUpperCase(),
  title: z.string().trim().min(2).max(160),
  slug,
  description: z.string().max(5000).optional(),
  durationWeeks: z.number().int().min(1).max(104).optional(),
  defaultAccessDays: z.number().int().min(1).max(3650).default(180),
  price: z.number().min(0).max(100_000_000),
  currency: z.string().length(3).toUpperCase().default('PKR'),
});

export const updateCourseSchema = createCourseSchema.partial().extend({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

export const createSectionSchema = z.object({
  parentSectionId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  sequence: z.number().int().min(0).optional(),
});
export const updateSectionSchema = createSectionSchema.partial().extend({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

export const releaseValueSchema = z
  .object({
    date: z.string().datetime().optional(), // BATCH_DATE
    days: z.number().int().min(0).max(3650).optional(), // RELATIVE
    requiredItemId: z.string().uuid().optional(), // PREREQUISITE
    minScorePercent: z.number().min(0).max(100).optional(), // SCORE_BASED (stored, enforced later)
  })
  .strict();

export const createItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  contentType: z.enum(CONTENT_TYPES),
  sequence: z.number().int().min(0).optional(),
  isRequired: z.boolean().default(true),
  estimatedMinutes: z.number().int().min(0).max(1000).optional(),
  releaseType: z.enum(RELEASE_TYPES).default('IMMEDIATE'),
  releaseValue: releaseValueSchema.optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('PUBLISHED'),
  metadata: z.record(z.unknown()).optional(),
});
export const updateItemSchema = createItemSchema.partial();

export const reorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type CreateSectionInput = z.infer<typeof createSectionSchema>;
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

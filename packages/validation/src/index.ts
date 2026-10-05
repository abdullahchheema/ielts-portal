import { z } from 'zod';

import { bandSchema } from './band';
import { emailSchema, passwordSchema } from './index-base';
export { emailSchema, passwordSchema };
export { bandSchema };




export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(6).max(20).optional(),
  next: z.string().max(300).regex(/^\/(?!\/)/).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  mfaCode: z.string().regex(/^\d{6}$/).optional(),
});

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

export const studentProfileSchema = z
  .object({
    currentBand: bandSchema.optional(),
    targetBand: bandSchema.optional(),
    ieltsExamDate: z.string().date().optional(),
    academicOrGeneral: z.enum(['ACADEMIC', 'GENERAL']).optional(),
    country: z.string().max(80).optional(),
    city: z.string().max(80).optional(),
    phone: z.string().trim().min(6).max(20).optional(),
    timezone: z.string().max(60).optional(),
    ieltsHistory: z.enum(['NEVER', 'TAKEN']).optional(),
    ieltsOverall: bandSchema.optional(),
    ieltsListening: bandSchema.optional(),
    ieltsReading: bandSchema.optional(),
    ieltsWriting: bandSchema.optional(),
    ieltsSpeaking: bandSchema.optional(),
    ieltsTestDate: z.string().date().optional(),
    ieltsAttempts: z.number().int().min(1).optional(),
    fatherName: z.string().max(120).optional(),
    dateOfBirth: z.string().date().optional(),
    gender: z.string().max(40).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (v) => {
      if (v.ieltsHistory === 'NEVER') {
        return (
          v.ieltsOverall === undefined &&
          v.ieltsListening === undefined &&
          v.ieltsReading === undefined &&
          v.ieltsWriting === undefined &&
          v.ieltsSpeaking === undefined &&
          v.ieltsTestDate === undefined &&
          v.ieltsAttempts === undefined
        );
      }
      return true;
    },
    { message: 'Remove IELTS scores, test date and attempts when you have never taken the test.', path: ['ieltsHistory'] },
  )
  .refine(
    (v) => {
      if (v.ieltsHistory === 'TAKEN') {
        return v.ieltsOverall !== undefined;
      }
      return true;
    },
    { message: 'Enter your overall band score.', path: ['ieltsOverall'] },
  );

export * from './courses';
export * from './batches';
export * from './commerce';
export * from './assessments';
export * from './grading';
export * from './ops';
export * from './teacher';

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

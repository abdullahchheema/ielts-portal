import { z } from 'zod';

import { emailSchema } from './index-base';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const optionalDate = z.preprocess(blank, z.string().date().optional());
const optionalDecimal = z.preprocess(blank, z.coerce.number().min(0).max(100).optional());
const optionalInt = z.preprocess(blank, z.coerce.number().int().optional());
const optionalBool = z.preprocess(blank, z.coerce.boolean().optional());
const phoneSchema = z.string().trim().min(6, 'Enter a phone number').max(20);

export const teacherEducationSchema = z.object({
  degree: z.string().trim().min(1).max(160),
  field: optionalText(160),
  institution: z.string().trim().min(1).max(200),
  country: optionalText(80),
  startYear: optionalInt,
  endYear: optionalInt,
  grade: optionalText(40),
});

export const teacherExperienceSchema = z.object({
  organization: z.string().trim().min(1).max(200),
  jobTitle: z.string().trim().min(1).max(160),
  employmentType: optionalText(60),
  startDate: optionalDate,
  endDate: optionalDate,
  current: z.boolean().default(false),
  responsibilities: optionalText(2000),
  reasonForLeaving: optionalText(500),
});

export const teacherCertificationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  issuer: optionalText(160),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
});

export const teacherReferenceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  organization: optionalText(160),
  position: optionalText(120),
  relationship: optionalText(80),
  phone: z.preprocess(blank, phoneSchema.optional()),
  email: z.preprocess(blank, emailSchema.optional()),
});

/** Full teacher application: personal, contact, teaching, availability, compensation, and additional info. */
export const teacherApplicationSchema = z.object({
  // Personal
  fullName: z.string().trim().min(1, 'Enter your full name').max(160),
  fatherName: optionalText(120),
  dateOfBirth: optionalDate,
  gender: optionalText(40),
  nationality: optionalText(80),
  idNumber: optionalText(60),
  maritalStatus: optionalText(40),

  // Contact
  phone: phoneSchema,
  email: emailSchema,
  currentAddress: optionalText(300),
  permanentAddress: optionalText(300),
  city: optionalText(80),
  emergencyName: optionalText(160),
  emergencyRelation: optionalText(80),
  emergencyPhone: z.preprocess(blank, phoneSchema.optional()),

  // Teaching info
  subjects: z.array(z.string().trim().min(1).max(80)).default([]),
  ieltsModules: z.array(z.string().trim().min(1).max(40)).default([]),
  teachingYears: optionalDecimal,
  ieltsYears: optionalDecimal,
  otherEnglishYears: optionalDecimal,
  levelsTaught: optionalText(200),
  onlineExperience: optionalBool,
  inPersonExperience: optionalBool,
  preferredMode: optionalText(40),
  languages: z.array(z.string().trim().min(1).max(60)).default([]),
  skills: z.array(z.string().trim().min(1).max(80)).default([]),

  // Availability
  availableDays: z.array(z.string().trim().min(1).max(20)).default([]),
  availableTime: optionalText(120),
  employmentType: optionalText(40),
  workingHours: optionalText(120),
  joiningDate: optionalDate,
  noticePeriod: optionalText(80),

  // Compensation
  expectedSalary: z.preprocess(blank, z.coerce.number().min(0).max(100_000_000).optional()),
  expectedHourlyRate: z.preprocess(blank, z.coerce.number().min(0).max(1_000_000).optional()),

  // Additional
  achievements: optionalText(2000),
  publications: optionalText(2000),
  memberships: optionalText(1000),
  personalStatement: optionalText(4000),
  notes: optionalText(2000),

  // Children
  educations: z.array(teacherEducationSchema).default([]),
  experiences: z.array(teacherExperienceSchema).default([]),
  certifications: z.array(teacherCertificationSchema).default([]),
  references: z.array(teacherReferenceSchema).default([]),
});

export type TeacherEducationInput = z.infer<typeof teacherEducationSchema>;
export type TeacherExperienceInput = z.infer<typeof teacherExperienceSchema>;
export type TeacherCertificationInput = z.infer<typeof teacherCertificationSchema>;
export type TeacherReferenceInput = z.infer<typeof teacherReferenceSchema>;
export type TeacherApplicationInput = z.infer<typeof teacherApplicationSchema>;

export const rejectTeacherApplicationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RejectTeacherApplicationInput = z.infer<typeof rejectTeacherApplicationSchema>;

/** Admin edits to an existing application's scalar fields (child records are managed via their own endpoints). */
export const teacherApplicationAdminUpdateSchema = teacherApplicationSchema
  .omit({ educations: true, experiences: true, certifications: true, references: true })
  .partial()
  .extend({ internalNotes: optionalText(2000) });
export type TeacherApplicationAdminUpdateInput = z.infer<typeof teacherApplicationAdminUpdateSchema>;

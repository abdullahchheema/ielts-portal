import { z } from 'zod';

import { emailSchema } from './index-base';
import {
  DEGREES, EMERGENCY_RELATIONS, EMPLOYMENT_TYPES, GENDERS, IELTS_MODULES, LANGUAGES, MARITAL_STATUSES, NATIONALITIES, PAKISTAN_CITIES,
  REFERENCE_RELATIONSHIPS, TEACHER_CERTIFICATIONS, TEACHER_DAYS, TEACHER_SUBJECTS, TEACHING_MODES, TIME_SLOTS,
} from './lists';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const phoneSchema = z.string().trim().min(6, 'Enter a phone number').max(20);
const CNIC = /^\d{5}-\d{7}-\d$/;
const thisYear = new Date().getFullYear();

type NonEmpty = readonly [string, ...string[]];
const choice = <T extends NonEmpty>(values: T, message: string) => z.enum(values, { errorMap: () => ({ message }) });
const choices = <T extends NonEmpty>(values: T, message: string) => z.array(choice(values, message), { required_error: message }).min(1, message);

export const teacherEducationSchema = z.object({
  degree: choice(DEGREES, 'Choose a degree'),
  institution: z.string().trim().min(2, 'Enter the institution').max(200),
  endYear: z.coerce.number({ invalid_type_error: 'Enter the year completed' }).int().min(1950, 'Enter a valid year').max(thisYear + 1, 'Enter a valid year'),
});

export const teacherExperienceSchema = z
  .object({
    organization: z.string().trim().min(2, 'Enter the organization').max(200),
    jobTitle: z.string().trim().min(2, 'Enter the job title').max(160),
    startDate: z.string().date('Enter the start date'),
    current: z.boolean().default(false),
    endDate: z.preprocess(blank, z.string().date('Enter a valid end date').optional()),
  })
  .refine((e) => e.current || !!e.endDate, { path: ['endDate'], message: 'Enter the end date, or tick "Current role"' });

export const teacherCertificationSchema = z.object({
  name: choice(TEACHER_CERTIFICATIONS, 'Choose a certification'),
});

export const teacherReferenceSchema = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(160),
  organization: z.string().trim().min(2, 'Enter the organization').max(160),
  relationship: choice(REFERENCE_RELATIONSHIPS, 'Choose how you know this person'),
  phone: phoneSchema,
});

/** Teacher application. Every field is required except the optional certifications list. */
export const teacherApplicationSchema = z.object({
  // Personal
  fullName: z.string().trim().min(2, 'Enter your full name').max(160),
  dateOfBirth: z.string().date('Enter your date of birth'),
  gender: choice(GENDERS, 'Choose your gender'),
  nationality: choice(NATIONALITIES, 'Choose your nationality'),
  idNumber: z.string().trim().regex(CNIC, 'Enter your CNIC as 00000-0000000-0'),
  maritalStatus: choice(MARITAL_STATUSES, 'Choose your marital status'),

  // Contact
  phone: phoneSchema,
  email: emailSchema,
  city: choice(PAKISTAN_CITIES, 'Choose your city'),
  currentAddress: z.string().trim().min(5, 'Enter your current address').max(300),
  emergencyName: z.string().trim().min(2, 'Enter the emergency contact name').max(160),
  emergencyRelation: choice(EMERGENCY_RELATIONS, 'Choose the relationship'),
  emergencyPhone: phoneSchema,

  // Teaching
  subjects: choices(TEACHER_SUBJECTS, 'Choose at least one subject'),
  ieltsModules: choices(IELTS_MODULES, 'Choose at least one IELTS module'),
  teachingYears: z.coerce.number({ invalid_type_error: 'Choose your years of teaching' }).int().min(0).max(40),
  languages: choices(LANGUAGES, 'Choose at least one language'),
  preferredMode: choice(TEACHING_MODES, 'Choose how you prefer to teach'),

  // Availability and pay
  availableDays: choices(TEACHER_DAYS, 'Choose at least one day'),
  availableTime: choice(TIME_SLOTS, 'Choose a time slot'),
  employmentType: choice(EMPLOYMENT_TYPES, 'Choose an employment type'),
  joiningDate: z.string().date('Enter the date you can join'),
  expectedSalary: z.coerce.number({ invalid_type_error: 'Enter your expected monthly salary' }).int().min(1, 'Enter your expected monthly salary').max(100_000_000),

  // Records
  educations: z.array(teacherEducationSchema).min(1, 'Add at least one education record'),
  experiences: z.array(teacherExperienceSchema).min(1, 'Add at least one work experience'),
  certifications: z.array(teacherCertificationSchema).default([]),
  references: z.array(teacherReferenceSchema).min(2, 'Add two references'),
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

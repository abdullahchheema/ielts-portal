import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PNG, Session, as, createStudent, http, loginAdmin } from './helpers';

let app: NestExpressApplication;
let prisma: PrismaClient;
let admin: Session;

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
  admin = await loginAdmin(app);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const application = (over: Record<string, unknown> = {}) => ({
  fullName: 'Hina Tariq', dateOfBirth: '1992-04-12', gender: 'Female', nationality: 'Pakistani', idNumber: '35202-1234567-8', maritalStatus: 'Single',
  phone: '0300-7654321', email: 'ignored@example.com', city: 'Lahore', currentAddress: 'House 4, Block B, Johar Town',
  emergencyName: 'Imran Tariq', emergencyRelation: 'Father', emergencyPhone: '0300-1112223',
  subjects: ['Writing'], ieltsModules: ['Academic'], teachingYears: '5', languages: ['English', 'Urdu'], preferredMode: 'Online',
  availableDays: ['MON', 'WED'], availableTime: 'Evening (5pm – 9pm)', employmentType: 'Part-time', joiningDate: '2026-11-01', expectedSalary: '60000',
  educations: [{ degree: "Bachelor's", institution: 'University of the Punjab', endYear: 2014 }],
  experiences: [{ organization: 'British Council', jobTitle: 'IELTS Trainer', startDate: '2015-02-01', current: true }],
  certifications: [{ name: 'CELTA' }],
  references: [
    { name: 'Dr. Asif Mehmood', organization: 'Punjab University', relationship: 'Academic supervisor', phone: '0300-4445556' },
    { name: 'Sara Khan', organization: 'British Council', relationship: 'Former employer', phone: '0300-7778889' },
  ],
  ...over,
});
const document = (s: Session, id: string) =>
  as(s)(http(app).post(`/teacher-applications/${id}/documents`)).field('kind', 'CV').attach('file', PNG, { filename: 'cv.png', contentType: 'image/png' });

describe('teacher applications come from an account', () => {
  it('refuses anonymous applications', async () => {
    await http(app).post('/teacher-applications').send(application()).expect(401);
  });

  it('records the application against the account email, and allows one pending application at a time', async () => {
    const s = await createStudent(app, prisma);
    const res = await as(s.session)(http(app).post('/teacher-applications')).send(application()).expect(201);
    const row = await prisma.teacherApplication.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.email).toBe(s.email);
    expect(row.status).toBe('PENDING');
    await as(s.session)(http(app).post('/teacher-applications')).send(application()).expect(409);
  });

  it('lets only the applicant attach documents to an application', async () => {
    const owner = await createStudent(app, prisma);
    const other = await createStudent(app, prisma);
    const { id } = (await as(owner.session)(http(app).post('/teacher-applications')).send(application()).expect(201)).body;
    await document(other.session, id).expect(404);
    await document(owner.session, id).expect(201);
  });

  it('lets an admin who manages teachers attach documents to any application', async () => {
    const owner = await createStudent(app, prisma);
    const { id } = (await as(owner.session)(http(app).post('/teacher-applications')).send(application()).expect(201)).body;
    await document(admin, id).expect(201);
    expect(await prisma.teacherDocument.count({ where: { applicationId: id } })).toBe(1);
  });

  it('approval grants the mentor role to the existing account instead of creating a second one', async () => {
    const s = await createStudent(app, prisma);
    const { id } = (await as(s.session)(http(app).post('/teacher-applications')).send(application()).expect(201)).body;
    await as(admin)(http(app).post(`/admin/teacher-applications/${id}/approve`)).expect(200);
    expect(await prisma.user.count({ where: { email: s.email } })).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: s.email }, include: { roles: { include: { role: true } }, mentor: true } });
    expect(user.roles.map((r) => r.role.name)).toContain('MENTOR');
    expect(user.mentor?.displayName).toBe('Hina Tariq');
  });
});

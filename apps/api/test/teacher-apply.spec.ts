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
  fullName: 'Hina Tariq', phone: '0300-7654321', email: 'ignored@example.com', subjects: ['Writing'], ...over,
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

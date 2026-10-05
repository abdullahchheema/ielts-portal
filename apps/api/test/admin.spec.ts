import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, as, createOpenBatch, createStudent, ensureDraft, http, login, loginAdmin, uniq } from './helpers';

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

async function staff(roleName: string) {
  const email = `${roleName.toLowerCase()}-${uniq()}@test.local`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: {
      email, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), status: 'ACTIVE', emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
    },
  });
  return { email, id: user.id, session: await login(app, email) };
}

describe('dashboard', () => {
  it('only reports figures the role is allowed to see', async () => {
    const finance = await staff('FINANCE_ADMIN');
    const d = (await as(finance.session)(http(app).get('/admin/dashboard')).expect(200)).body;
    expect(typeof d.pendingVerifications).toBe('number');
    expect(d.activeBatches).toBeNull(); // finance has no batch.view
    expect(d.students).toBeNull(); // finance has no student.view
    const full = (await as(admin)(http(app).get('/admin/dashboard')).expect(200)).body;
    expect(typeof full.students).toBe('number');
    const student = await createStudent(app, prisma);
    await as(student.session)(http(app).get('/admin/dashboard')).expect(403);
  });
});

describe('students', () => {
  it('lets support search students and suspend accounts, which takes effect immediately', async () => {
    const support = await staff('SUPPORT_AGENT');
    const target = await createStudent(app, prisma);

    const found = (await as(support.session)(http(app).get(`/admin/students?search=${encodeURIComponent(target.email)}`)).expect(200)).body;
    expect(found.total).toBe(1);
    expect(found.items[0].email).toBe(target.email);
    const detail = (await as(support.session)(http(app).get(`/admin/students/${target.studentId}`)).expect(200)).body;
    expect(detail.user.email).toBe(target.email);

    // Support can view but not change status (needs student.edit).
    await as(support.session)(http(app).patch(`/admin/students/${target.userId}/status`)).send({ status: 'SUSPENDED' }).expect(403);

    await as(admin)(http(app).patch(`/admin/students/${target.userId}/status`)).send({ status: 'SUSPENDED' }).expect(200);
    // Existing session dies at once; new logins are refused.
    const dead = await as(target.session)(http(app).get('/me/dashboard')).expect(403);
    expect(dead.body.error.code).toBe('ACCOUNT_SUSPENDED');
    const relogin = await http(app).post('/auth/login').send({ email: target.email, password: PASSWORD }).expect(403);
    expect(relogin.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_CHANGED_ACCOUNT_STATUS', entityId: target.userId } })).toBe(1);

    await as(admin)(http(app).patch(`/admin/students/${target.userId}/status`)).send({ status: 'ACTIVE' }).expect(200);
    await login(app, target.email);
  });

  it('refuses to change staff accounts through the student endpoint', async () => {
    const f = await staff('FINANCE_ADMIN');
    const res = await as(admin)(http(app).patch(`/admin/students/${f.id}/status`)).send({ status: 'BLOCKED' }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('staff & roles', () => {
  it('needs admin.manage, invites staff, and audits role changes', async () => {
    const finance = await staff('FINANCE_ADMIN');
    await as(finance.session)(http(app).get('/admin/staff')).expect(403);
    await as(finance.session)(http(app).put(`/admin/users/${finance.id}/roles`)).send({ roles: ['SUPER_ADMIN'] }).expect(403); // no self-promotion

    const email = `newstaff-${uniq()}@test.local`;
    const created = (await as(admin)(http(app).post('/admin/staff')).send({ email, roles: ['SUPPORT_AGENT'] }).expect(201)).body;
    expect(created.roles).toEqual(['SUPPORT_AGENT']);
    // Invitees get a set-password token, not a usable password.
    expect(await prisma.passwordResetToken.count({ where: { userId: created.id } })).toBe(1);

    await as(admin)(http(app).put(`/admin/users/${created.id}/roles`)).send({ roles: ['FINANCE_ADMIN', 'MARKETING'] }).expect(200);
    const roles = (await prisma.userRole.findMany({ where: { userId: created.id }, include: { role: true } })).map((r) => r.role.name).sort();
    expect(roles).toEqual(['FINANCE_ADMIN', 'MARKETING']);

    const bad = await as(admin)(http(app).put(`/admin/users/${created.id}/roles`)).send({ roles: ['NOT_A_ROLE'] }).expect(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const staffList = (await as(admin)(http(app).get('/admin/staff')).expect(200)).body as { email: string }[];
    expect(staffList.map((s) => s.email)).toContain(email);
    const roleList = (await as(admin)(http(app).get('/admin/roles')).expect(200)).body as { name: string; permissions: string[] }[];
    expect(roleList.find((r) => r.name === 'FINANCE_ADMIN')!.permissions).toContain('payment.verify');
  });

  it('never removes the last active Super Admin', async () => {
    const supers = await prisma.userRole.findMany({ where: { role: { name: 'SUPER_ADMIN' }, user: { status: 'ACTIVE' } } });
    if (supers.length !== 1) return; // only meaningful while there is exactly one
    const res = await as(admin)(http(app).put(`/admin/users/${supers[0].userId}/roles`)).send({ roles: ['ACADEMIC_ADMIN'] }).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('exposes the audit log only to audit.view holders', async () => {
    const finance = await staff('FINANCE_ADMIN');
    await as(finance.session)(http(app).get('/admin/audit-logs')).expect(403);
    const logs = (await as(admin)(http(app).get('/admin/audit-logs?action=ADMIN_CHANGED_ROLE&take=5')).expect(200)).body;
    expect(logs.items.length).toBeGreaterThan(0);
    expect(logs.items[0]).toMatchObject({ action: 'ADMIN_CHANGED_ROLE', actor: 'admin@test.local' });
    expect(logs.items[0].before).toBeTruthy();
  });
});

describe('content files', () => {
  const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 65)]);
  const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);

  async function draftItem(contentType: string) {
    const d0 = await ensureDraft(app, admin);
    const course = { id: d0.courseId };
    const versionId = d0.versionId;
    const sec = (await as(admin)(http(app).post(`/admin/course-versions/${versionId}/sections`)).send({ title: 'S' }).expect(201)).body.id;
    const item = (await as(admin)(http(app).post(`/admin/sections/${sec}/items`)).send({ title: 'Doc', contentType }).expect(201)).body.id as string;
    return { courseId: course.id as string, versionId, item };
  }
  const upload = (id: string, buf: Buffer, filename = 'notes.pdf') =>
    as(admin)(http(app).post(`/admin/items/${id}/file`)).attach('file', buf, { filename, contentType: 'application/pdf' });

  it('sniffs content, matches type to item, and refuses published versions', async () => {
    const d = await draftItem('PDF');
    expect((await upload(d.item, EXE).expect(415)).body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const ok = (await upload(d.item, PDF, '../../evil name.pdf').expect(201)).body;
    expect(ok.fileName).toBe('evil name.pdf'); // path stripped
    const text = await draftItem('TEXT');
    expect((await upload(text.item, PDF).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    await as(admin)(http(app).post(`/admin/course-versions/${d.versionId}/publish`)).expect(200);
    expect((await upload(d.item, PDF).expect(409)).body.error.code).toBe('VERSION_PUBLISHED_IMMUTABLE');
  });

  it('serves files to enrolled students via short-lived signed URLs only', async () => {
    const d = await draftItem('PDF');
    await upload(d.item, PDF).expect(201);
    await as(admin)(http(app).post(`/admin/course-versions/${d.versionId}/publish`)).expect(200);
    const batchId = await createOpenBatch(app, admin);
    const st = await createStudent(app, prisma);
    await as(admin)(http(app).post('/admin/enrollments')).send({ studentId: st.studentId, batchId, source: 'ADMIN', reason: 'test' }).expect(201);

    const opened = (await as(st.session)(http(app).get(`/content/${d.item}`)).expect(200)).body;
    expect(opened.content.fileUrl).toMatch(/\/files\/local\?key=/);
    expect(JSON.stringify(opened)).not.toContain('fileKey');
    // Storage returns same-origin relative URLs (see storage.service.ts); resolve against a dummy base to inspect them.
    const u = new URL(opened.content.fileUrl, 'http://localhost');
    const path = `${u.pathname.replace(/^\/api/, '')}${u.search}`;

    const file = await http(app).get(path).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toContain('no-store');

    // Tampered signature, altered key, and path traversal are all refused.
    await http(app).get(path.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64))).expect(403);
    await http(app).get(path.replace('content%2F', 'content%2F..%2F')).expect(403);
    await http(app).get('/files/local?key=..%2F..%2F.env&exp=9999999999&sig=x').expect(403);
  });
});

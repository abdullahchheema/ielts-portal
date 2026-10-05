import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { PASSWORD, Session, as, createOpenBatch, http, login, uniq } from './helpers';

const OWNER_EMAIL = `owner-${uniq()}@test.local`;
process.env.OWNER_EMAIL = OWNER_EMAIL;

let app: NestExpressApplication;
let prisma: PrismaClient;
let owner: Account;

interface Account { id: string; email: string; session: Session }

async function account(roles: string[], email = `acct-${uniq()}@test.local`): Promise<Account> {
  const user = await prisma.user.create({
    data: {
      email, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), status: 'ACTIVE', emailVerifiedAt: new Date(),
      roles: { create: (await prisma.role.findMany({ where: { name: { in: roles } } })).map((r) => ({ roleId: r.id })) },
    },
  });
  return { id: user.id, email, session: await login(app, email) };
}

async function teacher() {
  const acct = await account(['MENTOR']);
  const mentor = await prisma.mentorProfile.create({ data: { userId: acct.id, displayName: 'Removable Teacher', specializations: [] } });
  return { ...acct, mentorId: mentor.id };
}

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
  owner = await account(['SUPER_ADMIN'], OWNER_EMAIL);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('removing Super Admins', () => {
  it('a Super Admin who is not the owner cannot remove another Super Admin', async () => {
    const other = await account(['SUPER_ADMIN']);
    const target = await account(['SUPER_ADMIN']);
    await as(other.session)(http(app).post(`/admin/users/${target.id}/remove`)).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('ACTIVE');
  });

  it('the owner removes a Super Admin: roles and sessions go, login is refused, and the removal is audited', async () => {
    const target = await account(['SUPER_ADMIN']);
    await as(owner.session)(http(app).post(`/admin/users/${target.id}/remove`)).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, include: { roles: true } });
    expect(user.status).toBe('DEACTIVATED');
    expect(user.roles).toHaveLength(0);
    expect(await prisma.refreshToken.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_REMOVED_ACCOUNT', entityId: target.id } })).toBe(1);
    await http(app).post('/auth/login').send({ email: target.email, password: PASSWORD }).expect(403);
  });

  it('nobody can remove the owner, and nobody can remove their own account', async () => {
    const other = await account(['SUPER_ADMIN']);
    await as(other.session)(http(app).post(`/admin/users/${owner.id}/remove`)).expect(403);
    await as(owner.session)(http(app).post(`/admin/users/${owner.id}/remove`)).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).status).toBe('ACTIVE');
  });
});

describe('removing teachers', () => {
  it('detaches a teacher from their batches, marks the profile removed, and blocks their login', async () => {
    const t = await teacher();
    const batchId = await createOpenBatch(app, owner.session);
    await prisma.batchMentor.create({ data: { batchId, mentorId: t.mentorId, mentorRole: 'MAIN' } });

    await as(owner.session)(http(app).post(`/admin/mentors/${t.mentorId}/remove`)).expect(200);

    expect(await prisma.batchMentor.count({ where: { mentorId: t.mentorId } })).toBe(0);
    expect((await prisma.mentorProfile.findUniqueOrThrow({ where: { id: t.mentorId } })).status).toBe('REMOVED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('DEACTIVATED');
    const list = (await as(owner.session)(http(app).get('/admin/mentors')).expect(200)).body as { id: string }[];
    expect(list.map((m) => m.id)).not.toContain(t.mentorId);
    await http(app).post('/auth/login').send({ email: t.email, password: PASSWORD }).expect(403);
  });

  it('refuses an id that is not a teacher profile', async () => {
    await as(owner.session)(http(app).post('/admin/mentors/00000000-0000-4000-8000-000000000000/remove')).expect(404);
  });
});

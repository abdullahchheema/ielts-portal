import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, as, createStudent, http, login, uniq } from './helpers';

let app: NestExpressApplication;
let prisma: PrismaClient;

beforeAll(async () => {
  process.env.TWO_FACTOR_ENABLED = 'true'; // this spec exercises enforcement; env.ts disables it elsewhere
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function staff(roleName: string) {
  const email = `${roleName.toLowerCase()}-${uniq()}@test.local`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  await prisma.user.create({
    data: {
      email, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), status: 'ACTIVE', emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
    },
  });
  return email;
}

describe('admin MFA', () => {
  it('blocks privileged actions until a second factor is enrolled, then requires it at login', async () => {
    const email = await staff('FINANCE_ADMIN');
    const s = await login(app, email);

    // Password alone gets a session, but no privileged access.
    const me = (await as(s)(http(app).get('/auth/me')).expect(200)).body;
    expect(me.mfaSetupRequired).toBe(true);
    const blocked = await as(s)(http(app).get('/admin/applications')).expect(403);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');

    // Enrol.
    const { secret, otpauthUrl } = (await as(s)(http(app).post('/auth/mfa/setup')).expect(201)).body;
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const stored = await prisma.mfaSecret.findFirstOrThrow({ where: { user: { email } } });
    expect(stored.secretEnc).not.toContain(secret); // encrypted at rest

    const wrong = await as(s)(http(app).post('/auth/mfa/confirm')).send({ code: '000000' }).expect(400);
    expect(wrong.body.error.code).toBe('INVALID_TOKEN');
    await as(s)(http(app).post('/auth/mfa/confirm')).send({ code: authenticator.generate(secret) }).expect(200);

    // Same session can now use admin features.
    await as(s)(http(app).get('/admin/applications')).expect(200);
    expect((await as(s)(http(app).get('/auth/me')).expect(200)).body.mfaSetupRequired).toBe(false);
    expect((await as(s)(http(app).post('/auth/mfa/setup')).expect(409)).body.error.code).toBe('CONFLICT');

    // Login now needs the code.
    const noCode = await http(app).post('/auth/login').send({ email, password: PASSWORD }).expect(401);
    expect(noCode.body.error.code).toBe('MFA_REQUIRED');
    const badCode = await http(app).post('/auth/login').send({ email, password: PASSWORD, mfaCode: '123456' }).expect(401);
    expect(badCode.body.error.code).toBe('INVALID_CREDENTIALS');
    await http(app).post('/auth/login').send({ email, password: PASSWORD, mfaCode: authenticator.generate(secret) }).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'MFA_ENABLED', user: { email } } })).toBe(1);
  });

  it('does not affect students', async () => {
    const st = await createStudent(app, prisma);
    const me = (await as(st.session)(http(app).get('/auth/me')).expect(200)).body;
    expect(me.mfaSetupRequired).toBe(false);
    await as(st.session)(http(app).get('/me/dashboard')).expect(200);
  });
});

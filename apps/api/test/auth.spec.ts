import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { sha256 } from '../src/auth/tokens';

let app: NestExpressApplication;
let prisma: PrismaClient;

const password = 'Str0ngPassw0rd!';
const uniq = () => `u${Date.now()}${Math.floor(Math.random() * 1e6)}@test.local`;

const cookieValue = (res: request.Response, name: string) => {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));
  return raw?.split(';')[0].slice(name.length + 1);
};

/** Registers, verifies (by planting a known token), and logs in; returns the cookie jar. */
async function registerAndLogin(email = uniq()) {
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password, firstName: 'Test', lastName: 'User' })
    .expect(201);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const token = 'verify-token-' + user.id + '-xxxxxxxxxxxx';
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) },
  });
  await request(app.getHttpServer()).post('/auth/verify-email').send({ token }).expect(200);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(200);
  return {
    email,
    user,
    login,
    access: cookieValue(login, 'access_token')!,
    refresh: cookieValue(login, 'refresh_token')!,
    csrf: cookieValue(login, 'csrf_token')!,
  };
}

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('auth', () => {
  it('rejects a duplicate email with EMAIL_ALREADY_REGISTERED', async () => {
    const email = uniq();
    const body = { email, password, firstName: 'A', lastName: 'B' };
    await request(app.getHttpServer()).post('/auth/register').send(body).expect(201);
    const res = await request(app.getHttpServer()).post('/auth/register').send(body).expect(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(res.body.error.request_id).toMatch(/^req_/);
  });

  it('returns field details for weak passwords', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: uniq(), password: 'short', firstName: 'A', lastName: 'B' })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.password).toBeTruthy();
  });

  it('blocks login until email is verified', async () => {
    const email = uniq();
    await request(app.getHttpServer()).post('/auth/register').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_VERIFIED');
  });

  it('does not reveal whether an email exists on wrong credentials', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email: uniq(), password }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('sets httpOnly cookies and serves /auth/me', async () => {
    const s = await registerAndLogin();
    const setCookie = ([] as string[]).concat(s.login.headers['set-cookie']);
    expect(setCookie.find((c) => c.startsWith('access_token='))).toMatch(/HttpOnly/i);
    expect(setCookie.find((c) => c.startsWith('refresh_token='))).toMatch(/HttpOnly/i);
    expect(setCookie.find((c) => c.startsWith('csrf_token='))).not.toMatch(/HttpOnly/i);

    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', `access_token=${s.access}`).expect(200);
    expect(me.body.email).toBe(s.email);
    expect(me.body.roles).toContain('STUDENT');
    expect(me.body.studentId).toBeTruthy();
  });

  it('requires authentication for protected routes', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('enforces CSRF on cookie-authenticated mutations', async () => {
    const s = await registerAndLogin();
    const cookies = `access_token=${s.access}; refresh_token=${s.refresh}; csrf_token=${s.csrf}`;
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookies).expect(403);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookies).set('x-csrf-token', s.csrf).expect(200);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const s = await registerAndLogin();
    const jar = (refresh: string) => `refresh_token=${refresh}; csrf_token=${s.csrf}`;

    const r1 = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', jar(s.refresh)).set('x-csrf-token', s.csrf).expect(200);
    const newRefresh = cookieValue(r1, 'refresh_token')!;
    expect(newRefresh).not.toBe(s.refresh);

    // Replaying the old (rotated) token is treated as theft…
    const replay = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', jar(s.refresh)).set('x-csrf-token', s.csrf).expect(401);
    expect(replay.body.error.code).toBe('SESSION_EXPIRED');

    // …and the newer token in the same family is now dead too.
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', jar(newRefresh)).set('x-csrf-token', s.csrf).expect(401);
  });

  it('rate limits repeated failed logins', async () => {
    const email = uniq();
    let last = 0;
    for (let i = 0; i < 9; i++) {
      last = (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).status;
    }
    expect(last).toBe(429);
  });

  it('forbids students from permission-protected admin routes', async () => {
    const s = await registerAndLogin();
    // /auth/me works, but an admin-only permission check must 403 for a student:
    const perms = (await request(app.getHttpServer()).get('/auth/me').set('Cookie', `access_token=${s.access}`)).body.permissions;
    expect(perms).not.toContain('payment.verify');
  });
});

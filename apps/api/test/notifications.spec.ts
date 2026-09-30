import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { as, createStudent, http } from './helpers';

let app: NestExpressApplication;
let prisma: PrismaClient;

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('in-app notifications', () => {
  it('lists own notifications, counts unread, and only marks the caller’s rows read', async () => {
    const a = await createStudent(app, prisma);
    const b = await createStudent(app, prisma);
    const mk = (userId: string, title: string) => prisma.notification.create({ data: { userId, type: 'TEST', title, channel: 'IN_APP' } });
    const n1 = await mk(a.userId, 'First');
    await mk(a.userId, 'Second');
    const other = await mk(b.userId, 'Not yours');

    const feed = (await as(a.session)(http(app).get('/me/notifications')).expect(200)).body;
    expect(feed.unread).toBe(2);
    expect(feed.items.map((i: { title: string }) => i.title)).toEqual(['Second', 'First']); // newest first
    expect(JSON.stringify(feed)).not.toContain('Not yours');

    await as(a.session)(http(app).post('/me/notifications/read')).send({ ids: [n1.id, other.id] }).expect(200);
    expect((await as(a.session)(http(app).get('/me/notifications')).expect(200)).body.unread).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: other.id } })).readAt).toBeNull(); // b's row untouched

    await as(a.session)(http(app).post('/me/notifications/read')).send({}).expect(200);
    expect((await as(a.session)(http(app).get('/me/notifications')).expect(200)).body.unread).toBe(0);
    expect((await as(b.session)(http(app).get('/me/notifications')).expect(200)).body.unread).toBe(1);
    await http(app).get('/me/notifications').expect(401);
    await as(a.session)(http(app).post('/me/notifications/read')).send({ ids: ['not-a-uuid'] }).expect(422);
  });
});

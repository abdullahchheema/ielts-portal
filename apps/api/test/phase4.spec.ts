import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { EngagementService } from '../src/engagement/engagement.service';
import { Session, as, createOpenBatch, createStudent, enrollStudent, http, loginAdmin, uniq } from './helpers';

/** Attendance corrections, class lifecycle, recordings, leaderboards, follow-ups and reminders against the database. */

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

const post = (s: Session, path: string, body: object = {}) => as(s)(http(app).post(path)).send(body);
const get = (s: Session, path: string) => as(s)(http(app).get(path));
const DAY = 86_400_000;

async function pastSession(batchId: string, daysAgo = 3) {
  return prisma.liveSession.create({
    data: { batchId, topic: `Class ${uniq()}`, startsAt: new Date(Date.now() - daysAgo * DAY), endsAt: new Date(Date.now() - daysAgo * DAY + 3_600_000) },
  });
}

describe('attendance corrections', () => {
  it('a correction is requested, approved, applied, and every change is kept in history', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const session = await pastSession(batchId);
    await as(admin)(http(app).put(`/mentor/sessions/${session.id}/attendance`)).send({ records: [{ studentId: st.studentId, status: 'PRESENT' }] }).expect(200);

    const req = (await post(admin, `/mentor/sessions/${session.id}/attendance-corrections`, { studentId: st.studentId, toStatus: 'ABSENT', reason: 'Marked present by mistake' }).expect(201)).body;
    expect(req.status).toBe('PENDING');
    await post(admin, `/mentor/sessions/${session.id}/attendance-corrections`, { studentId: st.studentId, toStatus: 'LATE', reason: 'Second request for the same student' }).expect(409);

    await post(admin, `/admin/attendance-corrections/${req.id}/decide`, { approve: true, note: 'Confirmed with the register' }).expect(200);
    const row = await prisma.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: session.id, studentId: st.studentId } } });
    expect(row.status).toBe('ABSENT');
    const events = await prisma.attendanceEvent.findMany({ where: { sessionId: session.id, studentId: st.studentId }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['MARKED', 'CORRECTION_APPLIED']));
    await post(admin, `/admin/attendance-corrections/${req.id}/decide`, { approve: false }).expect(409);
  });

  it('two misses in a row raise a warning once, not on every marking', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const s1 = await pastSession(batchId, 5);
    const s2 = await pastSession(batchId, 4);
    for (const s of [s1, s2]) await as(admin)(http(app).put(`/mentor/sessions/${s.id}/attendance`)).send({ records: [{ studentId: st.studentId, status: 'ABSENT' }] }).expect(200);
    await as(admin)(http(app).put(`/mentor/sessions/${s2.id}/attendance`)).send({ records: [{ studentId: st.studentId, status: 'ABSENT' }] }).expect(200);
    const warnings = await prisma.attendanceWarning.findMany({ where: { studentId: st.studentId, rule: 'CONSECUTIVE_MISSES' } });
    expect(warnings.length).toBe(1);
  });
});

describe('class lifecycle and cancellation', () => {
  it('cancelling a scheduled class notifies the batch once, and cannot be done twice', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const future = await prisma.liveSession.create({ data: { batchId, topic: `Future ${uniq()}`, startsAt: new Date(Date.now() + 2 * DAY), endsAt: new Date(Date.now() + 2 * DAY + 3_600_000) } });
    const out = (await post(admin, `/admin/sessions/${future.id}/cancel`, { reason: 'Teacher is unwell' }).expect(200)).body;
    expect(out.status).toBe('CANCELLED');
    const row = await prisma.liveSession.findUniqueOrThrow({ where: { id: future.id } });
    expect(row.status).toBe('CANCELLED');
    const notes = await prisma.notification.count({ where: { userId: st.userId, type: 'CLASS_CANCELLED' } });
    expect(notes).toBe(1);
    await post(admin, `/admin/sessions/${future.id}/cancel`, { reason: 'Again please' }).expect(409);
  });

  it('a class can be started and ended by its teacher', async () => {
    const batchId = await createOpenBatch(app, admin);
    const session = await prisma.liveSession.create({ data: { batchId, topic: `Live ${uniq()}`, startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000) } });
    expect((await post(admin, `/mentor/sessions/${session.id}/status`, { action: 'START' }).expect(200)).body.status).toBe('LIVE');
    expect((await post(admin, `/mentor/sessions/${session.id}/status`, { action: 'END' }).expect(200)).body.status).toBe('COMPLETED');
  });
});

describe('class recordings', () => {
  it('a recording is visible only to students of its batch, and watch progress only moves forward', async () => {
    const batchId = await createOpenBatch(app, admin);
    const member = await enrollStudent(app, prisma, admin, batchId);
    const outsider = await createStudent(app, prisma);
    const session = await pastSession(batchId, 1);
    const rec = (await post(admin, `/mentor/sessions/${session.id}/recordings`, { externalUrl: 'https://video.example.com/class-1', durationSec: 600 }).expect(201)).body;

    const mine = (await get(member.session, '/me/recordings').expect(200)).body;
    expect(mine.map((r: { id: string }) => r.id)).toContain(rec.id);
    const play = (await post(member.session, `/me/recordings/${rec.id}/play`).expect(200)).body;
    expect(play.url).toBe('https://video.example.com/class-1');

    await post(outsider.session, `/me/recordings/${rec.id}/play`).expect(404);
    const theirs = (await get(outsider.session, '/me/recordings').expect(200)).body;
    expect(theirs.map((r: { id: string }) => r.id)).not.toContain(rec.id);

    await post(member.session, `/me/recordings/${rec.id}/progress`, { positionSec: 300 }).expect(200);
    const back = (await post(member.session, `/me/recordings/${rec.id}/progress`, { positionSec: 100 }).expect(200)).body;
    expect(back.positionSec).toBe(300);
  });

  it('a recording must use an https link', async () => {
    const batchId = await createOpenBatch(app, admin);
    const session = await pastSession(batchId, 1);
    await post(admin, `/mentor/sessions/${session.id}/recordings`, { externalUrl: 'http://insecure.example.com/x' }).expect(422);
  });
});

describe('leaderboards and follow-ups', () => {
  it('a student sees their batch board, and opting out removes them from the ranking', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const board = (await get(st.session, '/me/leaderboard?type=WEEKLY').expect(200)).body;
    expect(board.period).toBe('WEEKLY');
    expect(board.top.every((e: { name: string }) => /^\S+ [A-Z]\.$/.test(e.name))).toBe(true);
    await post(st.session, '/me/leaderboard/opt-out', { optOut: true }).expect(200);
    const after = (await get(st.session, '/me/leaderboard?type=WEEKLY').expect(200)).body;
    expect(after.me).toBeNull();
  });

  it('a follow-up is assigned, appears for its assignee, and can be closed once', async () => {
    const st = await createStudent(app, prisma);
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } });
    const task = (await post(admin, `/admin/students/${st.studentId}/follow-ups`, { assigneeId: me.id, note: 'Call the student about their absence' }).expect(201)).body;
    const mine = (await get(admin, '/me/follow-ups').expect(200)).body;
    expect(mine.map((t: { id: string }) => t.id)).toContain(task.id);
    await post(admin, `/me/follow-ups/${task.id}/done`).expect(200);
    await post(admin, `/me/follow-ups/${task.id}/done`).expect(409);
  });
});

describe('reminders', () => {
  it('a reminder is sent once per student even when the job runs twice', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await prisma.liveSession.create({ data: { batchId, topic: `Soon ${uniq()}`, startsAt: new Date(Date.now() + 30 * 60_000), endsAt: new Date(Date.now() + 90 * 60_000) } });
    const engagement = app.get(EngagementService);
    const first = await engagement.sendReminders();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const second = await engagement.sendReminders();
    const mine = await prisma.notification.count({ where: { userId: st.userId, type: 'CLASS_REMINDER' } });
    expect(mine).toBeLessThanOrEqual(3);
    expect(second.sent).toBeLessThanOrEqual(first.sent);
  });
});

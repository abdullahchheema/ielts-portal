import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { RiskService } from '../src/analytics/risk.service';
import { Session, as, createOpenBatch, enrollStudent, http, loginAdmin } from './helpers';

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

describe('risk engine (database)', () => {
  it('returns exactly one row per enrolled student, with the same answer on every call', async () => {
    const batchId = await createOpenBatch(app, admin);
    const a = await enrollStudent(app, prisma, admin, batchId);
    const b = await enrollStudent(app, prisma, admin, batchId);
    const risk = app.get(RiskService);
    const map = await risk.forCohort([a.studentId, b.studentId]);
    expect(map.size).toBe(2);
    expect(map.get(a.studentId)?.batchId).toBe(batchId);
    const again = await risk.forCohort([a.studentId, b.studentId]);
    expect(again.get(a.studentId)?.level).toBe(map.get(a.studentId)?.level);
  });

  it('keeps a brand-new student GREEN with no reasons, not RED for having no history yet', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    const r = await app.get(RiskService).forStudent(s.studentId);
    expect(r?.level).toBe('GREEN');
    expect(r?.reasons).toEqual([]);
  });

  it('does not count sessions held before the student enrolled against their attendance (late joiner)', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    // A session that finished long before this student joined. They could not have attended it.
    const past = await prisma.liveSession.create({
      data: { batchId, topic: 'Before joining', startsAt: new Date(Date.now() - 60 * 86_400_000), endsAt: new Date(Date.now() - 59 * 86_400_000) },
    });
    await prisma.attendance.create({ data: { sessionId: past.id, studentId: s.studentId, status: 'ABSENT' } });
    const r = await app.get(RiskService).forStudent(s.studentId);
    expect(r?.signals.attendance.held).toBe(0);
    expect(r?.signals.attendancePercent).toBeNull();
    expect(r?.level).toBe('GREEN');
  });

  it('lets a student read their own risk, and only their own', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    const body = (await as(s.session)(http(app).get('/me/risk')).expect(200)).body;
    expect(body.enrolled).toBe(true);
    expect(['GREEN', 'YELLOW', 'RED']).toContain(body.level);
    if (body.level !== 'GREEN') expect(body.reasons.length).toBeGreaterThan(0);
    await as(admin)(http(app).get('/me/risk')).expect(403);
  });
});

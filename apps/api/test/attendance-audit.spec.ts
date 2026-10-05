import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
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

async function mark(sessionId: string, records: Array<{ studentId: string; status: string; note?: string }>) {
  return as(admin)(http(app).put(`/mentor/sessions/${sessionId}/attendance`)).send({ records }).expect(200);
}

describe('attendance corrections are audited field by field', () => {
  it('records a change to a historical mark with the before and after values, and nothing for an unchanged re-save', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    const session = await prisma.liveSession.create({
      data: { batchId, topic: 'Writing clinic', startsAt: new Date(Date.now() - 3 * 86_400_000), endsAt: new Date(Date.now() - 3 * 86_400_000 + 3_600_000) },
    });

    // 1. First marking: a status row is created, with no correction.
    await mark(session.id, [{ studentId: s.studentId, status: 'PRESENT' }]);
    const first = await prisma.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: session.id, studentId: s.studentId } } });
    expect(first.markedAt).not.toBeNull();
    let corrections = await prisma.auditLog.findMany({ where: { action: 'ATTENDANCE_CORRECTED', entityId: first.id } });
    expect(corrections).toHaveLength(0);

    // 2. Unchanged re-save: still no correction.
    await mark(session.id, [{ studentId: s.studentId, status: 'PRESENT' }]);
    corrections = await prisma.auditLog.findMany({ where: { action: 'ATTENDANCE_CORRECTED', entityId: first.id } });
    expect(corrections).toHaveLength(0);

    // 3. A real correction with a reason: one audit row with before and after.
    await mark(session.id, [{ studentId: s.studentId, status: 'ABSENT', note: 'Bus cancelled' }]);
    corrections = await prisma.auditLog.findMany({ where: { action: 'ATTENDANCE_CORRECTED', entityId: first.id } });
    expect(corrections).toHaveLength(1);
    const diff = corrections[0];
    expect(diff.beforeJson).toMatchObject({ status: 'PRESENT' });
    expect(diff.afterJson).toMatchObject({ status: 'ABSENT', note: 'Bus cancelled' });
    expect(diff.userId).toBeTruthy();

    // 4. A later save that does not mention the note must not wipe it.
    await mark(session.id, [{ studentId: s.studentId, status: 'ABSENT' }]);
    const after = await prisma.attendance.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.note).toBe('Bus cancelled');
    expect(after.status).toBe('ABSENT');
  });

  it('summarises attendance as one query set per request and excludes EXCUSED from the denominator', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    const base = Date.now() - 10 * 86_400_000;
    // The student joined before these classes ran, so they fall inside the attendance window.
    await prisma.enrollment.update({ where: { id: s.enrollmentId }, data: { enrolledAt: new Date(base - 86_400_000), accessStartsAt: new Date(base - 86_400_000) } });
    const sessions = await Promise.all([0, 1, 2, 3].map((i) => prisma.liveSession.create({
      data: { batchId, topic: `Class ${i}`, startsAt: new Date(base + i * 86_400_000), endsAt: new Date(base + i * 86_400_000 + 3_600_000) },
    })));
    await mark(sessions[0].id, [{ studentId: s.studentId, status: 'PRESENT' }]);
    await mark(sessions[1].id, [{ studentId: s.studentId, status: 'EXCUSED' }]);
    await mark(sessions[2].id, [{ studentId: s.studentId, status: 'ABSENT' }]);
    await mark(sessions[3].id, [{ studentId: s.studentId, status: 'LATE' }]);

    const rows = (await as(s.session)(http(app).get('/me/attendance')).expect(200)).body;
    const mine = rows.find((r: { enrollmentId: string }) => r.enrollmentId === s.enrollmentId);
    expect(mine.sessionsHeld).toBe(4);
    expect(mine.excused).toBe(1);
    // 2 attended (PRESENT + LATE) out of 3 that were not excused: 67%
    expect(mine.attendancePercent).toBe(67);
  });
});

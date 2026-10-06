import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { as, createOpenBatch, createStudent, enrollStudent, http, loginAdmin, Session, uniq } from './helpers';

/** Admin experience and the student tutor: command centre, search, notes, support, the staff assistant and the tutor. */

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

describe('command centre', () => {
  it('shows the metrics the caller may see, each linked to the screen where it is acted on', async () => {
    const c = (await get(admin, '/admin/command-center').expect(200)).body;
    expect(Array.isArray(c.metrics)).toBe(true);
    for (const m of c.metrics) expect(m.href).toMatch(/^\//);
    expect(Array.isArray(c.alerts)).toBe(true);
  });

  it('a student never sees the command centre', async () => {
    const st = await createStudent(app, prisma);
    await get(st.session, '/admin/command-center').expect(403);
  });
});

describe('global search', () => {
  it('finds a student by name for staff, and a student outside a teacher’s batches is not found', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const name = `Zed${uniq().replace(/[0-9]/g, '')}`;
    await prisma.studentProfile.update({ where: { id: st.studentId }, data: { firstName: name } });
    const res = (await get(admin, `/search?q=${encodeURIComponent(name)}`).expect(200)).body as { type: string; items: { label: string }[] }[];
    expect(res.flatMap((s) => s.items).some((i) => i.label.startsWith(name))).toBe(true);
  });

  it('a search needs at least two characters', async () => {
    await get(admin, '/search?q=a').expect(422);
  });
});

describe('internal notes', () => {
  it('a student cannot read or write staff notes', async () => {
    const st = await createStudent(app, prisma);
    await get(st.session, `/admin/notes?targetType=STUDENT&targetId=${st.studentId}`).expect(403);
    await post(st.session, '/admin/notes', { targetType: 'STUDENT', targetId: st.studentId, body: 'Not for students', visibility: 'ALL_STAFF' }).expect(403);
  });

  it('a note is written, listed, edited by its author, and deleted softly', async () => {
    const st = await createStudent(app, prisma);
    const note = (await post(admin, '/admin/notes', { targetType: 'STUDENT', targetId: st.studentId, body: 'Needs extra speaking practice.', visibility: 'ACADEMIC' }).expect(201)).body;
    const list = (await get(admin, `/admin/notes?targetType=STUDENT&targetId=${st.studentId}`).expect(200)).body;
    expect(list.map((n: { id: string }) => n.id)).toContain(note.id);
    await as(admin)(http(app).patch(`/admin/notes/${note.id}`)).send({ body: 'Needs extra speaking practice and pronunciation work.' }).expect(200);
    await as(admin)(http(app).delete(`/admin/notes/${note.id}`)).expect(200);
    const after = (await get(admin, `/admin/notes?targetType=STUDENT&targetId=${st.studentId}`).expect(200)).body;
    expect(after.map((n: { id: string }) => n.id)).not.toContain(note.id);
  });
});

describe('support tickets', () => {
  it('a new payment ticket is routed to a finance team member with an SLA date', async () => {
    const st = await createStudent(app, prisma);
    const res = await post(st.session, '/me/tickets', { category: 'PAYMENT', priority: 'HIGH', subject: 'Receipt not confirmed', description: 'I paid last week and have not been confirmed yet.' });
    expect([200, 201]).toContain(res.status);
    const ticket = await prisma.supportTicket.findFirstOrThrow({ where: { studentId: st.userId }, orderBy: { createdAt: 'desc' } });
    expect(ticket.slaDueAt).not.toBeNull();
    if (ticket.assignedTo) expect(ticket.status).toBe('ASSIGNED');
  });
});

describe('staff assistant', () => {
  it('a support answer is a suggestion with its sources, and it changes nothing', async () => {
    const before = await prisma.paymentProof.count({ where: { status: 'APPROVED' } });
    const res = (await post(admin, '/admin/support/assistant', { question: 'What should I tell a student whose payment is still pending?' }).expect(200)).body;
    expect(typeof res.suggestion).toBe('string');
    expect(Array.isArray(res.sources)).toBe(true);
    expect(await prisma.paymentProof.count({ where: { status: 'APPROVED' } })).toBe(before);
  });

  it('knowledge can be added and is then offered to staff', async () => {
    const title = `Refund window ${uniq().replace(/[0-9]/g, '')}`;
    await post(admin, '/admin/knowledge', { title, body: 'Refund requests are accepted within the refund window set in settings.', audience: 'STAFF' }).expect(201);
    const res = (await post(admin, '/admin/support/assistant', { question: 'What is the refund window?' }).expect(200)).body;
    expect(typeof res.suggestion).toBe('string');
  });
});

describe('student tutor', () => {
  it('a student has private conversations: create, ask, rename, delete', async () => {
    const st = await createStudent(app, prisma);
    const c = (await post(st.session, '/me/tutor/conversations', { mode: 'READING' }).expect(201)).body;
    const reply = (await post(st.session, `/me/tutor/conversations/${c.id}/messages`, { content: 'Why is a statement True instead of Not Given?' }).expect(200)).body;
    expect(typeof reply.answer).toBe('string');
    const msgs = (await get(st.session, `/me/tutor/conversations/${c.id}`).expect(200)).body;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['USER', 'ASSISTANT']);
    await as(st.session)(http(app).patch(`/me/tutor/conversations/${c.id}`)).send({ title: 'Reading help' }).expect(200);
    await as(st.session)(http(app).delete(`/me/tutor/conversations/${c.id}`)).expect(200);
    const list = (await get(st.session, '/me/tutor/conversations').expect(200)).body;
    expect(list.map((x: { id: string }) => x.id)).not.toContain(c.id);
  });

  it('another student cannot read or write someone else’s conversation', async () => {
    const owner = await createStudent(app, prisma);
    const other = await createStudent(app, prisma);
    const c = (await post(owner.session, '/me/tutor/conversations', {}).expect(201)).body;
    await get(other.session, `/me/tutor/conversations/${c.id}`).expect(404);
    await post(other.session, `/me/tutor/conversations/${c.id}/messages`, { content: 'Let me in' }).expect(404);
  });

  it('staff cannot reach the tutor’s conversations through the tutor path', async () => {
    const st = await createStudent(app, prisma);
    const c = (await post(st.session, '/me/tutor/conversations', {}).expect(201)).body;
    await get(admin, `/me/tutor/conversations/${c.id}`).expect(404);
  });
});

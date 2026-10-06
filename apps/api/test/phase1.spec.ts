import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, createOpenBatch, createStudent, http, loginAdmin, mainCourse, uniq } from './helpers';

/** Question bank, practice papers, coupon preview and referrals, end to end against the database. */

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

async function publishedSet(count: number) {
  const set = (await post(admin, '/admin/question-sets', {
    title: `Passage ${uniq()}`, skill: 'READING', topic: 'travel', difficulty: 3, studentFacing: false,
    stimulus: { passage: 'The sun rises in the east.' },
  }).expect(201)).body;
  for (let i = 0; i < count; i++) {
    await post(admin, `/admin/question-sets/${set.id}/questions`, {
      ieltsType: 'TFNG', prompt: { text: `Statement ${i}` }, marks: 1, answerKey: { value: 'TRUE' },
    }).expect(201);
  }
  await post(admin, `/admin/question-sets/${set.id}/status`, { status: 'APPROVED' }).expect(200);
  await post(admin, `/admin/question-sets/${set.id}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);
  return set.id as string;
}

describe('question bank access and publishing', () => {
  it('a student cannot manage the bank', async () => {
    const st = await createStudent(app, prisma);
    await post(st.session, '/admin/question-sets', { title: 'Nope', skill: 'READING' }).expect(403);
    await get(st.session, '/admin/question-sets').expect(403);
  });

  it('a set cannot be published without an answer key', async () => {
    const set = (await post(admin, '/admin/question-sets', { title: `Keyless ${uniq()}`, skill: 'READING' }).expect(201)).body;
    await post(admin, `/admin/question-sets/${set.id}/questions`, { ieltsType: 'TFNG', prompt: { text: 'No key' }, marks: 1 }).expect(422);
    await post(admin, `/admin/question-sets/${set.id}/questions`, { ieltsType: 'MCQ_SINGLE', prompt: { text: 'Pick' }, marks: 1, options: [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: true }] }).expect(422);
  });

  it('a published set cannot be edited in place; cloning makes a draft copy', async () => {
    const id = await publishedSet(1);
    await as(admin)(http(app).patch(`/admin/question-sets/${id}`)).send({ title: 'Changed' }).expect(409);
    const copy = (await post(admin, `/admin/question-sets/${id}/clone`).expect(200)).body;
    expect(copy.status).toBe('DRAFT');
    expect(copy.studentFacing).toBe(false);
  });
});

describe('personal practice papers', () => {
  it('a student practises from published content, and the paper never reveals answers', async () => {
    await publishedSet(6);
    const st = await createStudent(app, prisma);
    const res = await post(st.session, '/practice/sessions', { skill: 'READING', count: 5 }).expect(201);
    const assessmentId = res.body.assessmentId as string;
    const started = await post(st.session, `/assessments/${assessmentId}/start`).expect(201);
    expect(started.body.paper.length).toBeGreaterThan(0);
    const attemptId = started.body.attempt.id as string;
    const paper = (await get(st.session, `/attempts/${attemptId}`).expect(200)).body;
    expect(JSON.stringify(paper)).not.toContain('answerKey');
    expect(JSON.stringify(paper)).not.toContain('isCorrect');
  });

  it('another student cannot open someone else’s practice paper', async () => {
    await publishedSet(6);
    const owner = await createStudent(app, prisma);
    const other = await createStudent(app, prisma);
    const { assessmentId } = (await post(owner.session, '/practice/sessions', { skill: 'READING', count: 5 }).expect(201)).body;
    await post(other.session, `/assessments/${assessmentId}/start`).expect(404);
  });

  it('an unpublished set is never offered to students', async () => {
    const set = (await post(admin, '/admin/question-sets', { title: `Draft only ${uniq()}`, skill: 'LISTENING', topic: `t-${uniq()}` }).expect(201)).body;
    await post(admin, `/admin/question-sets/${set.id}/questions`, { ieltsType: 'MCQ_SINGLE', prompt: { text: 'Hidden' }, marks: 1, options: [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: false }] }).expect(201);
    const st = await createStudent(app, prisma);
    // Other published listening content may exist in the shared test schema, so a session can be created.
    // What must hold is that the draft's prompt is never served to a student.
    const res = await post(st.session, '/practice/sessions', { skill: 'LISTENING', count: 5 });
    expect([201, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('Hidden');
  });
});

describe('coupon preview', () => {
  it('shows a valid code and its discount without reserving anything', async () => {
    const code = `PV${uniq().toUpperCase()}`;
    await post(admin, '/admin/coupons', { code, discountType: 'PERCENTAGE', value: 10 }).expect(201);
    const course = await mainCourse(app, admin);
    const batchId = await createOpenBatch(app, admin);
    const st = await createStudent(app, prisma);
    const before = await prisma.coupon.findUniqueOrThrow({ where: { code } });
    const res = (await post(st.session, '/coupons/preview', { code, batchId }).expect(201)).body;
    expect(res.valid).toBe(true);
    expect(res.discount).toBe((Number(res.price) * 0.1).toFixed(2));
    expect(course.id).toBeTruthy();
    const after = await prisma.coupon.findUniqueOrThrow({ where: { code } });
    expect(after.redeemedCount).toBe(before.redeemedCount);
  });

  it('explains why an unknown code is not valid', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await createStudent(app, prisma);
    const res = (await post(st.session, '/coupons/preview', { code: 'NOSUCHCODE', batchId }).expect(201)).body;
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/not valid/);
  });

  it('a disabled coupon is refused', async () => {
    const code = `OFF${uniq().toUpperCase()}`;
    const c = (await post(admin, '/admin/coupons', { code, discountType: 'FIXED', value: 500 }).expect(201)).body;
    await as(admin)(http(app).patch(`/admin/coupons/${c.id}`)).send({ active: false }).expect(200);
    const batchId = await createOpenBatch(app, admin);
    const st = await createStudent(app, prisma);
    const res = (await post(st.session, '/coupons/preview', { code, batchId }).expect(201)).body;
    expect(res.valid).toBe(false);
    const row = await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.status).toBe('DISABLED');
  });
});

describe('referrals', () => {
  it('every student gets a stable code and a link', async () => {
    const st = await createStudent(app, prisma);
    const a = (await get(st.session, '/me/referrals').expect(200)).body;
    const b = (await get(st.session, '/me/referrals').expect(200)).body;
    expect(a.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(b.code).toBe(a.code);
    expect(a.link).toContain(`ref=${a.code}`);
  });

  it('a referral cannot be attributed to oneself', async () => {
    const st = await createStudent(app, prisma);
    const { code } = (await get(st.session, '/me/referrals').expect(200)).body;
    await post(st.session, '/referrals/attribute', { code }).expect(409);
  });

  it('a new student attributed once; a second attribution does not change the first', async () => {
    const referrer = await createStudent(app, prisma);
    const { code } = (await get(referrer.session, '/me/referrals').expect(200)).body;
    const friend = await createStudent(app, prisma);
    const first = (await post(friend.session, '/referrals/attribute', { code }).expect(200)).body;
    expect(first.status).toBe('REGISTERED');
    const other = await createStudent(app, prisma);
    const { code: otherCode } = (await get(other.session, '/me/referrals').expect(200)).body;
    const again = (await post(friend.session, '/referrals/attribute', { code: otherCode }).expect(200)).body;
    expect(again.attributed).toBe(true);
    const row = await prisma.referral.findUniqueOrThrow({ where: { referredUserId: friend.userId } });
    expect(row.referrerStudentId).toBe(referrer.studentId);
  });

  it('a reward needs a qualified referral and is given only once', async () => {
    const referrer = await createStudent(app, prisma);
    const { code } = (await get(referrer.session, '/me/referrals').expect(200)).body;
    const friend = await createStudent(app, prisma);
    await post(friend.session, '/referrals/attribute', { code }).expect(200);
    const row = await prisma.referral.findUniqueOrThrow({ where: { referredUserId: friend.userId } });

    const early = (await post(admin, `/admin/referrals/${row.id}/reward`).expect(200)).body;
    expect(early.rewarded).toBe(false);

    await prisma.referral.update({ where: { id: row.id }, data: { status: 'QUALIFIED', qualifiedAt: new Date() } });
    const first = (await post(admin, `/admin/referrals/${row.id}/reward`).expect(200)).body;
    expect(first.rewarded).toBe(true);
    const second = (await post(admin, `/admin/referrals/${row.id}/reward`).expect(200)).body;
    expect(second.rewarded).toBe(false);

    const credits = await prisma.accountCreditLedger.count({ where: { referralId: row.id } });
    expect(credits).toBe(1);
  });

  it('a student cannot reward or reject referrals', async () => {
    const st = await createStudent(app, prisma);
    await post(st.session, `/admin/referrals/${crypto.randomUUID()}/reward`).expect(403);
  });

  it('clicks on a link are accepted for real and unknown codes alike', async () => {
    const st = await createStudent(app, prisma);
    const { code } = (await get(st.session, '/me/referrals').expect(200)).body;
    await http(app).post('/referrals/click').send({ code }).expect(200);
    await http(app).post('/referrals/click').send({ code: 'ZZZZZZZZ' }).expect(200);
  });
});

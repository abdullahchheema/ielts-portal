import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaClient } from '@ielts/db';
import { sha256 } from '../src/auth/tokens';

export interface Session { access: string; csrf: string; cookies: string }

export const uniq = () => Math.random().toString(36).slice(2, 8);
export const PASSWORD = 'Str0ngPassw0rd!';

export const http = (app: NestExpressApplication) => request(app.getHttpServer());

/** Attaches session cookies + CSRF header to a supertest request. */
export const as = (s: Session) => (req: request.Test) => req.set('Cookie', s.cookies).set('x-csrf-token', s.csrf);

export async function login(app: NestExpressApplication, email: string, password = PASSWORD): Promise<Session> {
  const res = await http(app).post('/auth/login').send({ email, password }).expect(200);
  const jar = ([] as string[]).concat(res.headers['set-cookie']);
  const get = (n: string) => jar.find((c) => c.startsWith(`${n}=`))!.split(';')[0].slice(n.length + 1);
  const access = get('access_token');
  const csrf = get('csrf_token');
  return { access, csrf, cookies: `access_token=${access}; csrf_token=${csrf}` };
}

export const loginAdmin = (app: NestExpressApplication) => login(app, 'admin@test.local', 'TestAdminPass123');

/** Registers a student, force-verifies the email, logs in. */
export async function createStudent(app: NestExpressApplication, prisma: PrismaClient, opts: { email?: string } = {}) {
  const email = opts.email ?? `stu-${uniq()}@test.local`;
  await http(app).post('/auth/register').send({ email, password: PASSWORD, firstName: 'Stu', lastName: 'Dent' }).expect(201);
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { student: true } });
  const token = `verify-${user.id}-abcdefghijklmnop`;
  await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) } });
  await http(app).post('/auth/verify-email').send({ token }).expect(200);
  const session = await login(app, email);
  return { email, userId: user.id, studentId: user.student!.id, session };
}

// ───────── the academy's one course ─────────
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

/** The seeded course. Every test file shares it, so helpers only ever add versions to it. */
export async function mainCourse(app: NestExpressApplication, admin: Session) {
  return (await as(admin)(http(app).get('/admin/course')).expect(200)).body as { id: string; title: string; price: string; versions: { id: string; status: string; versionNumber: number }[] };
}

/**
 * Starts a fresh, EMPTY draft version of the one course (previous content is cleared from the draft) and sets its price.
 * Tests then add their own sections/items and publish the version with `publishVersion`.
 */
export async function ensureDraft(app: NestExpressApplication, admin: Session) {
  const course = await mainCourse(app, admin);
  const existing = course.versions.find((v) => v.status === 'DRAFT');
  if (existing) return { courseId: course.id, versionId: existing.id };
  const draft = (await as(admin)(http(app).post(`/admin/courses/${course.id}/versions`)).send({}).expect(201)).body as { id: string };
  return { courseId: course.id, versionId: draft.id };
}

export async function newCourse(app: NestExpressApplication, admin: Session, prisma: PrismaClient, price = 1000) {
  const course = await mainCourse(app, admin);
  await as(admin)(http(app).patch(`/admin/courses/${course.id}`)).send({ price }).expect(200);
  const { versionId } = await ensureDraft(app, admin);
  await prisma.assignment.deleteMany({ where: { contentItem: { section: { courseVersionId: versionId } } } });
  await prisma.contentItem.deleteMany({ where: { section: { courseVersionId: versionId } } });
  await prisma.courseSection.updateMany({ where: { courseVersionId: versionId }, data: { parentSectionId: null } });
  await prisma.courseSection.deleteMany({ where: { courseVersionId: versionId } });
  return { courseId: course.id, id: course.id, versionId };
}

export const publishVersion = (app: NestExpressApplication, admin: Session, versionId: string) =>
  as(admin)(http(app).post(`/admin/course-versions/${versionId}/publish`)).expect(200);

/** A new published version with one required TEXT lesson; sets the course price. Returns ids. */
export async function createPublishedCourse(app: NestExpressApplication, admin: Session, prisma: PrismaClient, price = 10000) {
  const c = await newCourse(app, admin, prisma, price);
  const sec = (await as(admin)(http(app).post(`/admin/course-versions/${c.versionId}/sections`)).send({ title: 'Intro' }).expect(201)).body;
  const item = (await as(admin)(http(app).post(`/admin/sections/${sec.id}/items`)).send({ title: 'Welcome', contentType: 'TEXT', metadata: { body: 'hi' } }).expect(201)).body;
  await publishVersion(app, admin, c.versionId);
  return { courseId: c.courseId, versionId: c.versionId, sectionId: sec.id as string, itemId: item.id as string };
}

export const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/** An OPEN batch on the newest published version. Batches have no size limit and no teacher is required. */
export async function createOpenBatch(app: NestExpressApplication, admin: Session, extra: Record<string, unknown> = {}) {
  const batch = (await as(admin)(http(app).post('/admin/batches')).send({ name: `Batch ${uniq()}`, startAt: daysFromNow(7), ...extra }).expect(201)).body;
  await as(admin)(http(app).patch(`/admin/batches/${batch.id}`)).send({ status: 'OPEN' }).expect(200);
  return batch.id as string;
}

/** Submits an enrollment application (multipart) exactly like the web form does. */
export function apply(
  app: NestExpressApplication, session: Session | null, batchId: string,
  o: { amount?: number; txn?: string; method?: string; file?: Buffer; filename?: string; contentType?: string; coupon?: string; applicant?: Record<string, string> } = {},
) {
  let req = http(app).post('/applications');
  if (session) req = as(session)(req);
  req = req.field('batchId', batchId).field('paymentMethod', o.method ?? 'BANK_TRANSFER')
    .field('transactionReference', o.txn ?? `TXN${uniq()}${uniq()}`).field('claimedAmount', String(o.amount ?? 10000)).field('transferDate', '2026-09-28');
  if (o.coupon) req = req.field('couponCode', o.coupon);
  for (const [k, v] of Object.entries(o.applicant ?? {})) req = req.field(k, v);
  return req.attach('file', o.file ?? PNG, { filename: o.filename ?? 'proof.png', contentType: o.contentType ?? 'image/png' });
}

/** Applies as an existing (signed-in) student and returns the ids. */
export async function applyAs(app: NestExpressApplication, prisma: PrismaClient, s: { session: Session; studentId: string }, batchId: string, o: Parameters<typeof apply>[3] = {}) {
  const res = await apply(app, s.session, batchId, o).expect(201);
  const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: res.body.enrollmentId }, include: { orderItem: true } });
  const proof = await prisma.paymentProof.findFirstOrThrow({ where: { payment: { orderId: enrollment.orderItem!.orderId } }, orderBy: { createdAt: 'desc' } });
  return { enrollmentId: enrollment.id, orderId: enrollment.orderItem!.orderId, proofId: proof.id };
}

/** Admin verifies a proof: the student becomes enrolled. */
export const verifyProof = (app: NestExpressApplication, admin: Session, proofId: string, body: Record<string, unknown> = {}) =>
  as(admin)(http(app).post(`/admin/applications/proofs/${proofId}/verify`)).send(body);

/** Student applies and the admin verifies: returns an ACTIVE enrollment. */
export async function enrollStudent(app: NestExpressApplication, prisma: PrismaClient, admin: Session, batchId: string, student?: Awaited<ReturnType<typeof createStudent>>) {
  const s = student ?? (await createStudent(app, prisma));
  const a = await applyAs(app, prisma, s, batchId, { amount: Number((await mainCourse(app, admin)).price) });
  await verifyProof(app, admin, a.proofId).expect(200);
  return { ...s, ...a };
}

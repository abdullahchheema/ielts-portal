import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, createStudent, ensureDraft, http, loginAdmin, mainCourse, newCourse, uniq } from './helpers';

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

describe('the one course', () => {
  it('is Complete IELTS Preparation, is the only live course, and cannot be duplicated', async () => {
    const course = await mainCourse(app, admin);
    expect(course.title).toBe('Complete IELTS Preparation');
    expect(await prisma.course.count({ where: { deletedAt: null, status: { not: 'ARCHIVED' } } })).toBe(1);

    const res = await as(admin)(http(app).post('/admin/courses')).send({ code: `X-${uniq()}`, title: 'Another', slug: `another-${uniq()}`, price: 1 }).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
    // The database refuses it too, whatever the API does.
    await expect(prisma.course.create({ data: { code: `Y-${uniq()}`, title: 'Sneaky', slug: `sneaky-${uniq()}`, price: 1, status: 'DRAFT' } })).rejects.toThrow();
  });

  it('has no public catalogue of courses any more', async () => {
    await http(app).get('/courses').expect(404);
    const course = (await http(app).get('/public/course').expect(200)).body;
    expect(course.title).toBe('Complete IELTS Preparation');
    expect(Number(course.price)).toBeGreaterThan(0);
  });

  it('edits the details of the one course', async () => {
    const c = await mainCourse(app, admin);
    const before = Number(c.price);
    await as(admin)(http(app).patch(`/admin/courses/${c.id}`)).send({ price: before + 1 }).expect(200);
    expect(Number((await as(admin)(http(app).get('/admin/course')).expect(200)).body.price)).toBe(before + 1);
    await as(admin)(http(app).patch(`/admin/courses/${c.id}`)).send({ price: before }).expect(200);
  });
});

describe('course builder', () => {
  it('forbids students and anonymous callers', async () => {
    const student = await createStudent(app, prisma);
    const res = await as(student.session)(http(app).post('/admin/course-versions/00000000-0000-4000-8000-000000000000/sections')).send({}).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await as(student.session)(http(app).get('/admin/course')).expect(403);
    await http(app).get('/admin/course').expect(401);
  });

  it('rejects an invalid price', async () => {
    const c = await mainCourse(app, admin);
    const bad = await as(admin)(http(app).patch(`/admin/courses/${c.id}`)).send({ price: -5 }).expect(422);
    expect(bad.body.error.details.price).toBeTruthy();
  });

  it('builds a tree, publishes, then freezes the version', async () => {
    const { versionId: draftId } = await newCourse(app, admin, prisma, 10000);
    const course = await mainCourse(app, admin);

    const sec = (await as(admin)(http(app).post(`/admin/course-versions/${draftId}/sections`)).send({ title: 'Listening' }).expect(201)).body;
    const sub = (await as(admin)(http(app).post(`/admin/course-versions/${draftId}/sections`)).send({ title: 'Unit 1', parentSectionId: sec.id }).expect(201)).body;
    const a = (await as(admin)(http(app).post(`/admin/sections/${sub.id}/items`)).send({ title: 'Video', contentType: 'VIDEO' }).expect(201)).body;
    const b = (await as(admin)(http(app).post(`/admin/sections/${sub.id}/items`)).send({
      title: 'Quiz', contentType: 'QUIZ', releaseType: 'PREREQUISITE', releaseValue: { requiredItemId: a.id },
    }).expect(201)).body;

    // A section cannot be moved inside its own descendant.
    const cyc = await as(admin)(http(app).patch(`/admin/sections/${sec.id}`)).send({ parentSectionId: sub.id }).expect(422);
    expect(cyc.body.error.details.parentSectionId).toBeTruthy();

    // Prerequisite must exist in this version.
    await as(admin)(http(app).post(`/admin/sections/${sub.id}/items`)).send({
      title: 'Bad', contentType: 'PDF', releaseType: 'PREREQUISITE', releaseValue: { requiredItemId: '00000000-0000-4000-8000-000000000000' },
    }).expect(422);

    const tree = (await as(admin)(http(app).get(`/admin/course-versions/${draftId}/tree`)).expect(200)).body;
    expect(tree.sections[0].children[0].items).toHaveLength(2);

    await as(admin)(http(app).post(`/admin/course-versions/${draftId}/publish`)).expect(200);

    // Frozen: every edit path returns VERSION_PUBLISHED_IMMUTABLE.
    const edits = [
      () => as(admin)(http(app).post(`/admin/course-versions/${draftId}/sections`)).send({ title: 'Late' }),
      () => as(admin)(http(app).patch(`/admin/items/${a.id}`)).send({ title: 'Renamed' }),
      () => as(admin)(http(app).delete(`/admin/items/${a.id}`)),
      () => as(admin)(http(app).delete(`/admin/sections/${sec.id}`)),
    ];
    for (const edit of edits) {
      const res = await edit().expect(409);
      expect(res.body.error.code).toBe('VERSION_PUBLISHED_IMMUTABLE');
    }

    // The homepage outline lists the top-level sections only.
    const pub = (await http(app).get('/public/course').expect(200)).body;
    expect(pub.modules).toEqual(['Listening']);

    // Clone into a new version: prerequisites are remapped to the cloned items, the old version stays untouched.
    const v2 = (await as(admin)(http(app).post(`/admin/courses/${course.id}/versions`)).send({}).expect(201)).body;
    const tree2 = (await as(admin)(http(app).get(`/admin/course-versions/${v2.id}/tree`)).expect(200)).body;
    const items2 = tree2.sections[0].children[0].items as { id: string; title: string; releaseValue: { requiredItemId: string } | null }[];
    const video2 = items2.find((i) => i.title === 'Video')!;
    const quiz2 = items2.find((i) => i.title === 'Quiz')!;
    expect(video2.id).not.toBe(a.id);
    expect(quiz2.releaseValue?.requiredItemId).toBe(video2.id);
    expect(quiz2.id).not.toBe(b.id);

    // Only one draft at a time.
    await as(admin)(http(app).post(`/admin/courses/${course.id}/versions`)).send({}).expect(409);

    // Publishing the new version retires the previous one.
    await as(admin)(http(app).post(`/admin/course-versions/${v2.id}/publish`)).expect(200);
    const statuses = (await prisma.courseVersion.findMany({ where: { id: { in: [draftId, v2.id] } }, orderBy: { versionNumber: 'asc' } })).map((v) => v.status);
    expect(statuses).toEqual(['RETIRED', 'PUBLISHED']);
    expect(await prisma.courseVersion.count({ where: { courseId: course.id, status: 'PUBLISHED' } })).toBe(1);
  });

  it('writes an audit trail for admin changes', async () => {
    const { versionId } = await ensureDraft(app, admin);
    const rows = await prisma.auditLog.findMany({ where: { entityType: 'CourseVersion', entityId: versionId } });
    expect(rows.map((r) => r.action)).toContain('COURSE_VERSION_CREATED');
    expect(rows[0].userId).toBeTruthy();
  });
});

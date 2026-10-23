import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, http, loginAdmin, uniq } from './helpers';

/**
 * All 4 skills' free-test content lives only in the question bank — upload, approve, publish,
 * identical process for Listening, Reading, Writing, Speaking. Assessments are never created by an
 * admin for this purpose; Listening/Reading get a small internal "wrapper" Assessment lazily built
 * the first time a set is actually picked for a free test (never at publish time), since the timed,
 * graded attempt machinery has no bank-native equivalent. See FreeTestService.resolveWrapperAssessment.
 */

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

const post = (path: string, body: object = {}) => as(admin)(http(app).post(path)).send(body);
const get = (path: string) => as(admin)(http(app).get(path));

/** A minimal MP3 header. Enough for the server's content sniffing. */
const MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(400, 1)]);
/** A minimal JPEG header. Enough for the server's content sniffing. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);

async function buildListeningSet() {
  const title = `Free Listening ${uniq()}`;
  const set = (await post('/admin/question-sets', { title, skill: 'LISTENING', difficulty: 3, topic: `free-${uniq()}`, studentFacing: false }).expect(201)).body;
  await post(`/admin/question-sets/${set.id}/questions`, { ieltsType: 'TFNG', prompt: { text: `Q1 ${uniq()}` }, marks: 1, answerKey: { value: 'TRUE' } }).expect(201);
  await as(admin)(http(app).post(`/admin/question-sets/${set.id}/audio`)).attach('file', MP3, { filename: 'audio.mp3', contentType: 'audio/mpeg' }).expect(200);
  await post(`/admin/question-sets/${set.id}/status`, { status: 'APPROVED' }).expect(200);
  await post(`/admin/question-sets/${set.id}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);
  return { setId: set.id as string, title };
}

async function buildReadingSet() {
  const set = (await post('/admin/question-sets', { title: `Free Reading ${uniq()}`, skill: 'READING', difficulty: 3, topic: `free-${uniq()}`, studentFacing: false }).expect(201)).body;
  await post(`/admin/question-sets/${set.id}/questions`, { ieltsType: 'TFNG', prompt: { text: `Q1 ${uniq()}` }, marks: 1, answerKey: { value: 'TRUE' } }).expect(201);
  await post(`/admin/question-sets/${set.id}/status`, { status: 'APPROVED' }).expect(200);
  await post(`/admin/question-sets/${set.id}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);
  return set.id as string;
}

describe('free-test content lives only in the question bank', () => {
  it('publishing a Writing set (same process as Writing already used) makes it eligible with no Assessment involved', async () => {
    const set = (await post('/admin/question-sets', { title: `Free Writing ${uniq()}`, skill: 'WRITING', difficulty: 3, topic: `free-${uniq()}`, studentFacing: false }).expect(201)).body;
    await post(`/admin/question-sets/${set.id}/questions`, { ieltsType: 'WRITING_TASK2', prompt: { text: `Discuss. ${uniq()}` }, marks: 1 }).expect(201);
    await post(`/admin/question-sets/${set.id}/status`, { status: 'APPROVED' }).expect(200);
    const before = (await get('/admin/free-test-pool').expect(200)).body.writing;
    await post(`/admin/question-sets/${set.id}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);
    const after = (await get('/admin/free-test-pool').expect(200)).body.writing;
    expect(after).toBe(before + 1);

    const listing = (await get('/admin/free-test-pool/modules').expect(200)).body as { id: string; skill: string; published: boolean }[];
    const row = listing.find((m) => m.id === set.id);
    expect(row?.skill).toBe('WRITING');
    expect(row?.published).toBe(true);
  });

  it('a published Listening set stays a plain bank set — no wrapper Assessment until it is actually picked', async () => {
    const { setId } = await buildListeningSet();
    const before = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    expect(before.wrapperAssessmentId).toBeNull();
    expect(before.status).toBe('PUBLISHED');

    const listing = (await get('/admin/free-test-pool/modules').expect(200)).body as { id: string; skill: string }[];
    expect(listing.some((m) => m.id === setId)).toBe(true);
  });

  it('claiming a free test lazily builds a wrapper Assessment for the picked Listening set, carrying its audio and questions, and reuses it on later claims', async () => {
    const { setId, title } = await buildListeningSet();
    await buildReadingSet();

    // "Least used" ties resolve to the earliest-created set and never change on a tie, so at most
    // one other never-used set (from an earlier test in this file) could win once before this one's
    // count drops to the same level and it gets picked — a small bounded retry absorbs that.
    let wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    let leadId = '';
    for (let i = 0; i < 5 && !wrapped.wrapperAssessmentId; i++) {
      leadId = (await http(app).post('/free-test/claim').expect(201)).body.leadId;
      wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    }
    expect(wrapped.wrapperAssessmentId).not.toBeNull();

    // The student-facing claim that triggered the build gets a real, playable audio URL — the
    // existing AttemptsService.paper() signed-URL conversion, exercised end-to-end for the first time
    // against bank-sourced content.
    const studentSection = (await http(app).get(`/free-test/${leadId}/section`).expect(200)).body;
    expect(studentSection.paper[0].content.audioUrl).toBeTruthy();

    const assessment = (await get(`/admin/assessments/${wrapped.wrapperAssessmentId}`).expect(200)).body;
    expect(assessment.type).toBe('DIAGNOSTIC');
    expect(assessment.skill).toBe('LISTENING');
    expect(assessment.title).toBe(title);
    expect(assessment.timeLimitMin).toBe(30); // IELTS-standard Listening timing
    const versionId = assessment.versions[0].id;
    const full = (await get(`/admin/assessment-versions/${versionId}`).expect(200)).body;
    expect(full.sections).toHaveLength(1);
    expect(full.sections[0].questions).toHaveLength(1);
    // The admin view exposes the raw storage key; students get a signed `audioUrl` instead, via the
    // unchanged AttemptsService.paper() — not re-tested here, since that conversion isn't new.
    expect(full.sections[0].content.audioKey).toBeTruthy();

    // However many further claims land on this set, its wrapper never gets rebuilt — still exactly
    // one Assessment with this title, matching the one already found above.
    for (let i = 0; i < 3; i++) await http(app).post('/free-test/claim').expect(201);
    const wrapperCount = await prisma.assessment.count({ where: { title, type: 'DIAGNOSTIC' } });
    expect(wrapperCount).toBe(1);
  });

  it('a multi-passage Reading module imports as sections, and the wrapper Assessment gets one section per passage with only that passage\'s questions', async () => {
    const title = `Free Reading multi ${uniq()}`;
    const payload = {
      sets: [{
        title, skill: 'READING', module: 'ACADEMIC', difficulty: 3,
        sections: [
          {
            title: 'Passage 1', instructions: 'For questions 1, write TRUE or FALSE.', passage: `Passage one text ${uniq()}`,
            questions: [{ ieltsType: 'TFNG', prompt: { text: `P1 Q1 ${uniq()}` }, marks: 1, answerKey: { value: 'TRUE' } }],
          },
          {
            title: 'Passage 2', instructions: 'For question 2, choose the correct letter.', passage: `Passage two text ${uniq()}`,
            questions: [{ ieltsType: 'MCQ_SINGLE', prompt: { text: `P2 Q2 ${uniq()}` }, marks: 1, options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: false }] }],
          },
        ],
      }],
    };
    const commit = (await post('/admin/question-sets/import/commit', payload).expect(201)).body;
    const setId = commit.created[0].setId as string;
    expect(commit.created[0].questionCount).toBe(2);

    const stored = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    expect((stored.stimulus as { sections: unknown[] }).sections).toHaveLength(2);
    const questions = await prisma.question.findMany({ where: { questionSetId: setId }, orderBy: { sequence: 'asc' } });
    expect(questions.map((q) => q.bankSectionIndex)).toEqual([0, 1]);

    await post(`/admin/question-sets/${setId}/status`, { status: 'APPROVED' }).expect(200);
    await post(`/admin/question-sets/${setId}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);

    let wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    for (let i = 0; i < 5 && !wrapped.wrapperAssessmentId; i++) {
      await http(app).post('/free-test/claim').expect(201);
      wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    }
    expect(wrapped.wrapperAssessmentId).not.toBeNull();

    const assessment = (await get(`/admin/assessments/${wrapped.wrapperAssessmentId}`).expect(200)).body;
    expect(assessment.timeLimitMin).toBe(60); // IELTS-standard Reading timing
    const versionId = assessment.versions[0].id;
    const full = (await get(`/admin/assessment-versions/${versionId}`).expect(200)).body;
    expect(full.sections).toHaveLength(2);
    const [s1, s2] = full.sections.sort((a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title));
    expect(s1.title).toBe('Passage 1');
    expect(s1.questions).toHaveLength(1);
    expect(s1.content.instructions).toContain('TRUE or FALSE');
    expect(s2.title).toBe('Passage 2');
    expect(s2.questions).toHaveLength(1);
  });

  it('attaches a shared image to one section of a multi-passage set, without affecting other sections', async () => {
    const payload = {
      sets: [{
        title: `Free Listening multi ${uniq()}`, skill: 'LISTENING', module: 'BOTH', difficulty: 3,
        sections: [
          { title: 'Part 1', questions: [{ ieltsType: 'MAP_LABELLING', prompt: { text: `Label A ${uniq()}` }, marks: 1, options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: false }] }] },
          { title: 'Part 2', questions: [{ ieltsType: 'TFNG', prompt: { text: `Q2 ${uniq()}` }, marks: 1, answerKey: { value: 'TRUE' } }] },
        ],
      }],
    };
    const commit = (await post('/admin/question-sets/import/commit', payload).expect(201)).body;
    const setId = commit.created[0].setId as string;

    await as(admin)(http(app).post(`/admin/question-sets/${setId}/images?sectionIndex=0`)).attach('file', JPEG, { filename: 'map.jpg', contentType: 'image/jpeg' }).expect(201);

    const set = (await get(`/admin/question-sets/${setId}`).expect(200)).body;
    expect(set.stimulus.sections[0].images).toHaveLength(1);
    expect(set.stimulus.sections[0].images[0].url).toBeTruthy();
    expect(set.stimulus.sections[1].images ?? []).toHaveLength(0);

    // Out of range — this set only has 2 sections (indices 0-1).
    await as(admin)(http(app).post(`/admin/question-sets/${setId}/images?sectionIndex=5`)).attach('file', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(404);
  });

  it('a single whole-module audio file (no sectionIndex) plays once, attached to only the first part of a multi-part Listening module', async () => {
    const title = `Free Listening one-track ${uniq()}`;
    const payload = {
      sets: [{
        title, skill: 'LISTENING', module: 'BOTH', difficulty: 3,
        sections: [
          { title: 'Part 1', questions: [{ ieltsType: 'TFNG', prompt: { text: `P1 ${uniq()}` }, marks: 1, answerKey: { value: 'TRUE' } }] },
          { title: 'Part 2', questions: [{ ieltsType: 'TFNG', prompt: { text: `P2 ${uniq()}` }, marks: 1, answerKey: { value: 'TRUE' } }] },
        ],
      }],
    };
    const commit = (await post('/admin/question-sets/import/commit', payload).expect(201)).body;
    const setId = commit.created[0].setId as string;

    // Attached with no sectionIndex — the whole-module recording, not a per-part one.
    await as(admin)(http(app).post(`/admin/question-sets/${setId}/audio`)).attach('file', MP3, { filename: 'full.mp3', contentType: 'audio/mpeg' }).expect(200);
    await post(`/admin/question-sets/${setId}/status`, { status: 'APPROVED' }).expect(200);
    await post(`/admin/question-sets/${setId}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);

    let wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    for (let i = 0; i < 5 && !wrapped.wrapperAssessmentId; i++) {
      await http(app).post('/free-test/claim').expect(201);
      wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    }
    expect(wrapped.wrapperAssessmentId).not.toBeNull();

    const assessment = (await get(`/admin/assessments/${wrapped.wrapperAssessmentId}`).expect(200)).body;
    const versionId = assessment.versions[0].id;
    const full = (await get(`/admin/assessment-versions/${versionId}`).expect(200)).body;
    const [p1, p2] = full.sections.sort((a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title));
    expect(p1.content.audioKey).toBeTruthy(); // the whole-module file landed on the first part
    expect(p2.content?.audioKey).toBeFalsy(); // not duplicated onto the second part
  });

  it('a section\'s contentBlocks (inline-input paper layout) and its shared image survive import, wrapper build and reach the student paper with a signed image URL', async () => {
    const payload = {
      sets: [{
        title: `Free Listening inline ${uniq()}`, skill: 'LISTENING', module: 'BOTH', difficulty: 3,
        sections: [{
          title: 'Part 1',
          questions: [
            { ieltsType: 'FORM_COMPLETION', prompt: { text: `Guests ${uniq()}` }, marks: 1, answerKey: { accepted: ['12'] } },
            { ieltsType: 'MAP_LABELLING', prompt: { text: `Label A ${uniq()}` }, marks: 1, options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: false }] },
          ],
          contentBlocks: [
            { type: 'heading', value: 'Details of Order' },
            { type: 'table', rows: [['Number of Guests Invited', '{{1}}'], ['Marquee position', '{{2}}']] },
            { type: 'image', index: 0, alt: 'Castle diagram' },
          ],
        }],
      }],
    };
    const commit = (await post('/admin/question-sets/import/commit', payload).expect(201)).body;
    const setId = commit.created[0].setId as string;

    const stored = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    const storedSections = (stored.stimulus as { sections: { contentBlocks?: unknown[] }[] }).sections;
    expect(storedSections[0].contentBlocks).toHaveLength(3);

    await as(admin)(http(app).post(`/admin/question-sets/${setId}/images?sectionIndex=0`)).attach('file', JPEG, { filename: 'castle.jpg', contentType: 'image/jpeg' }).expect(201);
    await post(`/admin/question-sets/${setId}/status`, { status: 'APPROVED' }).expect(200);
    await post(`/admin/question-sets/${setId}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);

    let wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    let leadId = '';
    for (let i = 0; i < 5 && !wrapped.wrapperAssessmentId; i++) {
      leadId = (await http(app).post('/free-test/claim').expect(201)).body.leadId;
      wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    }
    expect(wrapped.wrapperAssessmentId).not.toBeNull();

    const studentSection = (await http(app).get(`/free-test/${leadId}/section`).expect(200)).body;
    const section = studentSection.paper[0];
    expect(section.content.contentBlocks).toHaveLength(3);
    expect(section.content.contentBlocks[1].rows[0][1]).toBe('{{1}}');
    expect(section.content.images).toHaveLength(1);
    expect(section.content.images[0].url).toBeTruthy();
    // Answer keys / correctness never reach the student paper, same guarantee as every other question type.
    expect(JSON.stringify(section.questions)).not.toContain('isCorrect');
  });

  it('a question\'s own attached image (e.g. a diagram-labelling figure) survives the free-test wrapper copy and reaches the student paper', async () => {
    const payload = {
      sets: [{
        title: `Free Listening question-image ${uniq()}`, skill: 'LISTENING', module: 'BOTH', difficulty: 3,
        questions: [{ ieltsType: 'MAP_LABELLING', prompt: { text: `Label the castle ${uniq()}` }, marks: 1, options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: false }] }],
      }],
    };
    const commit = (await post('/admin/question-sets/import/commit', payload).expect(201)).body;
    const setId = commit.created[0].setId as string;
    const bankQuestionId = (await prisma.question.findFirstOrThrow({ where: { questionSetId: setId } })).id;

    await as(admin)(http(app).post(`/admin/question-sets/questions/${bankQuestionId}/images`)).attach('file', JPEG, { filename: 'castle.jpg', contentType: 'image/jpeg' }).expect(201);
    await post(`/admin/question-sets/${setId}/status`, { status: 'APPROVED' }).expect(200);
    await post(`/admin/question-sets/${setId}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);

    let wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    let leadId = '';
    for (let i = 0; i < 5 && !wrapped.wrapperAssessmentId; i++) {
      leadId = (await http(app).post('/free-test/claim').expect(201)).body.leadId;
      wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    }
    expect(wrapped.wrapperAssessmentId).not.toBeNull();

    const studentSection = (await http(app).get(`/free-test/${leadId}/section`).expect(200)).body;
    const q = studentSection.paper[0].questions[0];
    expect(q.images).toHaveLength(1);
    expect(q.images[0].url).toBeTruthy();
  });

  it('editing a PUBLISHED set is allowed (no more clone-to-edit) and safely invalidates its already-built wrapper so the next pick rebuilds with the edit', async () => {
    const { setId } = await buildListeningSet();

    let wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    for (let i = 0; i < 5 && !wrapped.wrapperAssessmentId; i++) {
      await http(app).post('/free-test/claim').expect(201);
      wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    }
    const firstWrapperId = wrapped.wrapperAssessmentId;
    expect(firstWrapperId).not.toBeNull();

    // Editing a published set used to 409 with VERSION_PUBLISHED_IMMUTABLE — now it just works, and
    // clears the stale wrapper so the edit actually reaches the next student instead of silently not.
    const added = (await post(`/admin/question-sets/${setId}/questions`, {
      ieltsType: 'TFNG', prompt: { text: `New question ${uniq()}` }, marks: 1, answerKey: { value: 'FALSE' },
    }).expect(201)).body;
    const afterEdit = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    expect(afterEdit.wrapperAssessmentId).toBeNull();

    let rewrapped = afterEdit;
    let leadId = '';
    for (let i = 0; i < 8 && !rewrapped.wrapperAssessmentId; i++) {
      leadId = (await http(app).post('/free-test/claim').expect(201)).body.leadId;
      rewrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    }
    expect(rewrapped.wrapperAssessmentId).not.toBeNull();
    expect(rewrapped.wrapperAssessmentId).not.toBe(firstWrapperId); // a genuinely new wrapper, not the stale one

    const studentSection = (await http(app).get(`/free-test/${leadId}/section`).expect(200)).body;
    const prompts = studentSection.paper[0].questions.map((q: { prompt: { text: string } }) => q.prompt.text);
    expect(prompts).toHaveLength(2);
    expect(prompts).toContain((await get(`/admin/question-sets/${setId}`).expect(200)).body.questions.find((q: { id: string }) => q.id === added.id).versions[0].prompt.text);
  });

  it('marks the Listening audio as played once, persists it server-side, and lets a repeat call stay idempotent', async () => {
    const { setId } = await buildListeningSet();
    let wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    let leadId = '';
    for (let i = 0; i < 5 && !wrapped.wrapperAssessmentId; i++) {
      leadId = (await http(app).post('/free-test/claim').expect(201)).body.leadId;
      wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: setId } });
    }
    expect(wrapped.wrapperAssessmentId).not.toBeNull();

    const before = (await http(app).get(`/free-test/${leadId}/section`).expect(200)).body;
    expect(before.attempt.audioPlayed).toBe(false);

    await http(app).put(`/free-test/${leadId}/section/audio-played`).expect(200);
    // Idempotent — a second call (e.g. a retried request) is a harmless no-op, not an error.
    await http(app).put(`/free-test/${leadId}/section/audio-played`).expect(200);

    const after = (await http(app).get(`/free-test/${leadId}/section`).expect(200)).body;
    expect(after.attempt.audioPlayed).toBe(true);
  });
});

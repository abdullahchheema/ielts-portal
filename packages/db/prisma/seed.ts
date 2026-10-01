import { PrismaClient, ContentType, ReleaseType } from '@prisma/client';
import * as argon2 from 'argon2';

export const prisma = new PrismaClient();

const PERMISSIONS = [
  'course.view', 'course.create', 'course.edit', 'course.publish',
  'content.manage',
  'batch.view', 'batch.create', 'batch.edit', 'mentor.assign', 'teaching.view', 'teacher.manage',
  'student.view', 'student.edit',
  'enrollment.view', 'enrollment.create',
  'payment.view', 'payment.verify', 'payment.refund',
  'coupon.manage',
  'submission.view', 'submission.grade',
  'ticket.manage',
  'report.finance.view', 'report.academic.view',
  'audit.view', 'settings.edit', 'dashboard.view', 'assessment.manage',
  'admin.manage',
] as const;

const ROLES: Record<string, { description: string; permissions: readonly string[] | 'ALL' }> = {
  SUPER_ADMIN: { description: 'Full system control', permissions: 'ALL' },
  ACADEMIC_ADMIN: {
    description: 'Courses, curriculum, batches, mentors, academic reports',
    permissions: ['course.view', 'course.create', 'course.edit', 'course.publish', 'content.manage',
      'batch.view', 'batch.create', 'batch.edit', 'mentor.assign', 'teaching.view', 'teacher.manage', 'student.view',
      'enrollment.view', 'enrollment.create', 'report.academic.view', 'dashboard.view', 'assessment.manage'],
  },
  CONTENT_MANAGER: {
    description: 'Lessons, files and practice material',
    permissions: ['course.view', 'course.edit', 'content.manage', 'dashboard.view', 'assessment.manage'],
  },
  FINANCE_ADMIN: {
    description: 'Payments, refunds, coupons, revenue',
    permissions: ['payment.view', 'payment.verify', 'payment.refund', 'coupon.manage',
      'enrollment.view', 'report.finance.view', 'dashboard.view'],
  },
  SUPPORT_AGENT: {
    description: 'Tickets and limited enrolment lookup',
    permissions: ['ticket.manage', 'student.view', 'enrollment.view', 'dashboard.view'],
  },
  MARKETING: {
    description: 'Coupons and conversion reporting',
    permissions: ['coupon.manage', 'course.view', 'dashboard.view'],
  },
  MENTOR: {
    description: 'Assigned batches, grading and feedback',
    permissions: ['teaching.view', 'submission.view', 'submission.grade'],
  },
  STUDENT: { description: 'Learner', permissions: [] },
};

async function seedRbac() {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const perms = await prisma.permission.findMany();
  const byKey = new Map(perms.map((p) => [p.key, p.id]));

  for (const [name, def] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name }, update: { description: def.description }, create: { name, description: def.description },
    });
    const keys = def.permissions === 'ALL' ? [...PERMISSIONS] : def.permissions;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: keys.map((k) => ({ roleId: role.id, permissionId: byKey.get(k)! })),
      skipDuplicates: true,
    });
  }
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping super admin.');
    return;
  }
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: {
      email: email.toLowerCase(),
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {}, create: { userId: user.id, roleId: role.id },
  });
}

/**
 * Default raw-score -> band tables (out of 40). These are DATA, editable by the academic team; verify them
 * against the tables your academy uses. Shorter tests are scaled to /40 before lookup.
 */
const BAND_TABLES: Record<string, [number, number, number][]> = {
  LISTENING: [[39, 40, 9], [37, 38, 8.5], [35, 36, 8], [32, 34, 7.5], [30, 31, 7], [26, 29, 6.5], [23, 25, 6], [18, 22, 5.5], [16, 17, 5], [13, 15, 4.5], [10, 12, 4], [8, 9, 3.5], [6, 7, 3], [4, 5, 2.5], [0, 3, 2]],
  READING_ACADEMIC: [[39, 40, 9], [37, 38, 8.5], [35, 36, 8], [33, 34, 7.5], [30, 32, 7], [27, 29, 6.5], [23, 26, 6], [19, 22, 5.5], [15, 18, 5], [13, 14, 4.5], [10, 12, 4], [8, 9, 3.5], [6, 7, 3], [4, 5, 2.5], [0, 3, 2]],
  READING_GENERAL: [[40, 40, 9], [39, 39, 8.5], [37, 38, 8], [36, 36, 7.5], [34, 35, 7], [32, 33, 6.5], [30, 31, 6], [27, 29, 5.5], [23, 26, 5], [19, 22, 4.5], [15, 18, 4], [12, 14, 3.5], [9, 11, 3], [6, 8, 2.5], [0, 5, 2]],
};

async function seedAssessmentData() {
  for (const [testType, rows] of Object.entries(BAND_TABLES)) {
    if (await prisma.bandConversionTable.count({ where: { testType } })) continue;
    await prisma.bandConversionTable.createMany({
      data: rows.map(([rawMin, rawMax, bandValue]) => ({ testType, rawMin, rawMax, band: bandValue, version: 1, effectiveDate: new Date('2020-01-01') })),
    });
  }

  // Marking criteria live in the database, not in frontend code.
  const rubrics: { name: string; skill: string; criteria: string[] }[] = [
    { name: 'IELTS Writing Task 1', skill: 'WRITING', criteria: ['Task Achievement', 'Coherence and Cohesion', 'Lexical Resource', 'Grammatical Range and Accuracy'] },
    { name: 'IELTS Writing Task 2', skill: 'WRITING', criteria: ['Task Response', 'Coherence and Cohesion', 'Lexical Resource', 'Grammatical Range and Accuracy'] },
    { name: 'IELTS Speaking', skill: 'SPEAKING', criteria: ['Fluency and Coherence', 'Lexical Resource', 'Grammatical Range and Accuracy', 'Pronunciation'] },
  ];
  for (const r of rubrics) {
    if (await prisma.rubric.findFirst({ where: { name: r.name } })) continue;
    await prisma.rubric.create({ data: { name: r.name, skill: r.skill, criteria: { create: r.criteria.map((name, sequence) => ({ name, sequence })) } } });
  }
}

// ───────────────────────── the one course ─────────────────────────
interface Q { type: 'MCQ_SINGLE' | 'MCQ_MULTI' | 'TFNG' | 'YNNG' | 'COMPLETION'; text: string; options?: [string, boolean?][]; value?: string; accepted?: string[] }
interface AssessmentSpec {
  title: string; type: 'LISTENING' | 'READING' | 'MOCK' | 'DIAGNOSTIC' | 'QUIZ'; skill?: 'LISTENING' | 'READING'; timeLimitMin?: number; passPercent?: number; maxAttempts?: number;
  sections: { title: string; instructions?: string; passage?: string; questions: Q[] }[];
}

/** Creates a published assessment (version 1) from a compact spec. */
async function createAssessment(spec: AssessmentSpec): Promise<string> {
  const existing = await prisma.assessment.findFirst({ where: { title: spec.title } });
  if (existing) return existing.id;
  const a = await prisma.assessment.create({
    data: { title: spec.title, type: spec.type, skill: spec.skill, timeLimitMin: spec.timeLimitMin, passPercent: spec.passPercent ?? 0, maxAttempts: spec.maxAttempts },
  });
  const v = await prisma.assessmentVersion.create({ data: { assessmentId: a.id, version: 1, publishedAt: new Date() } });
  let sSeq = 0;
  for (const s of spec.sections) {
    const section = await prisma.assessmentSection.create({
      data: { assessmentVersionId: v.id, title: s.title, sequence: sSeq++, content: { instructions: s.instructions, passage: s.passage } },
    });
    let qSeq = 0;
    for (const q of s.questions) {
      const question = await prisma.question.create({ data: { sectionId: section.id, questionType: q.type, sequence: qSeq++ } });
      const usesKey = q.type === 'TFNG' || q.type === 'YNNG' || q.type === 'COMPLETION';
      const qv = await prisma.questionVersion.create({
        data: {
          questionId: question.id, version: 1, prompt: { text: q.text }, marks: 1,
          answerKey: usesKey ? (q.type === 'COMPLETION' ? { accepted: q.accepted } : { value: q.value }) : undefined,
        },
      });
      if (!usesKey && q.options) {
        await prisma.questionOption.createMany({ data: q.options.map(([label, isCorrect], i) => ({ questionVersionId: qv.id, label, isCorrect: !!isCorrect, sequence: i })) });
      }
    }
  }
  return a.id;
}

const PASSAGE = `Urban gardens have grown rapidly in many cities over the last two decades. Community groups convert empty lots and rooftops into small farms, and the produce is often sold locally within hours of harvest. Supporters say the gardens cut food transport costs, cool the surrounding streets and give residents a reason to meet. Critics point out that the yields are small and that the land might be used for housing. Recent surveys suggest most neighbours support the gardens, especially where volunteers also run free workshops for children.`;

const SPECS: Record<string, AssessmentSpec> = {
  listening: {
    title: 'Listening Practice Test 1', type: 'LISTENING', skill: 'LISTENING', timeLimitMin: 30, passPercent: 50,
    sections: [{
      title: 'Section 1 — Booking a course', instructions: 'Sample paper. Your teacher attaches the recording for each real test; answer as you listen.',
      questions: [
        { type: 'COMPLETION', text: 'The evening class starts on the ___ of March.', accepted: ['12th', 'twelfth', '12'] },
        { type: 'COMPLETION', text: 'The fee for the full course is ___ pounds.', accepted: ['240', '£240'] },
        { type: 'MCQ_SINGLE', text: 'Where will the class take place?', options: [['Main library'], ['Community centre', true], ['Town hall']] },
        { type: 'TFNG', text: 'Students must bring their own laptops.', value: 'FALSE' },
        { type: 'MCQ_MULTI', text: 'Which TWO things are included in the fee?', options: [['Textbook', true], ['Parking'], ['Online practice access', true], ['Lunch']] },
        { type: 'COMPLETION', text: 'Registration closes on ___.', accepted: ['Friday', 'friday'] },
      ],
    }],
  },
  reading: {
    title: 'Reading Practice Test 1', type: 'READING', skill: 'READING', timeLimitMin: 30, passPercent: 50,
    sections: [{
      title: 'Passage 1 — Urban gardens', instructions: 'Read the passage and answer the questions.', passage: PASSAGE,
      questions: [
        { type: 'TFNG', text: 'Produce from urban gardens is sometimes sold within hours of harvest.', value: 'TRUE' },
        { type: 'TFNG', text: 'All critics agree that gardens should be replaced by housing.', value: 'FALSE' },
        { type: 'TFNG', text: 'Urban gardens reduce the average price of vegetables in supermarkets.', value: 'NOT_GIVEN' },
        { type: 'MCQ_SINGLE', text: 'What do supporters say about the gardens?', options: [['They produce very large yields'], ['They help cool nearby streets', true], ['They replace public parks']] },
        { type: 'COMPLETION', text: 'Volunteers sometimes run free ___ for children.', accepted: ['workshops', 'workshop'] },
        { type: 'YNNG', text: 'The writer believes most neighbours dislike the gardens.', value: 'NO' },
      ],
    }],
  },
  mock1: {
    title: 'Daily Mock Test 1', type: 'MOCK', timeLimitMin: 20,
    sections: [{
      title: 'Mixed practice', instructions: 'A short daily mock covering reading and vocabulary in the IELTS style.', passage: PASSAGE,
      questions: [
        { type: 'TFNG', text: 'Community groups convert empty lots into small farms.', value: 'TRUE' },
        { type: 'MCQ_SINGLE', text: 'The word "yields" in the passage is closest in meaning to:', options: [['profits'], ['harvests', true], ['prices']] },
        { type: 'YNNG', text: 'The writer thinks urban gardens should be banned.', value: 'NO' },
        { type: 'COMPLETION', text: 'Urban gardens have grown rapidly over the last two ___.', accepted: ['decades'] },
      ],
    }],
  },
  mock2: {
    title: 'Daily Mock Test 2 — Past-paper style', type: 'MOCK', timeLimitMin: 20,
    sections: [{
      title: 'Question types', instructions: 'Practice the common question types.',
      questions: [
        { type: 'MCQ_SINGLE', text: 'Choose the correct sentence.', options: [['She have finished her homework.'], ['She has finished her homework.', true], ['She finish her homework.']] },
        { type: 'MCQ_MULTI', text: 'Which TWO are academic writing features?', options: [['Formal tone', true], ['Slang'], ['Clear paragraphing', true], ['Text-message spelling']] },
        { type: 'TFNG', text: 'IELTS Writing Task 2 requires at least 250 words.', value: 'TRUE' },
        { type: 'COMPLETION', text: 'The IELTS Speaking test has ___ parts.', accepted: ['3', 'three'] },
      ],
    }],
  },
  mock3: {
    title: 'Daily Mock Test 3 — Expected questions', type: 'MOCK', timeLimitMin: 20,
    sections: [{
      title: 'Expected question patterns', instructions: 'Practice built around question patterns that appear often.',
      questions: [
        { type: 'YNNG', text: 'Matching headings questions ask you to pair paragraphs with headings.', value: 'YES' },
        { type: 'MCQ_SINGLE', text: 'In True/False/Not Given, "Not Given" means the passage:', options: [['contradicts the statement'], ['gives no information about the statement', true], ['agrees with the statement']] },
        { type: 'COMPLETION', text: 'In sentence completion you must use no more than ___ words unless told otherwise.', accepted: ['three', '3'] },
      ],
    }],
  },
  diagnostic: {
    title: 'Diagnostic Test — Reading', type: 'DIAGNOSTIC', skill: 'READING', timeLimitMin: 15, maxAttempts: 2,
    sections: [{
      title: 'Passage — Urban gardens', instructions: 'A short check of your current reading level. It is not part of the course.', passage: PASSAGE,
      questions: [
        { type: 'TFNG', text: 'Urban gardens have become more common in recent decades.', value: 'TRUE' },
        { type: 'MCQ_SINGLE', text: 'What is one criticism of urban gardens?', options: [['They cost too much to plant'], ['Their yields are small', true], ['They attract too many visitors']] },
        { type: 'TFNG', text: 'Most surveys were carried out by the city council.', value: 'NOT_GIVEN' },
        { type: 'COMPLETION', text: 'Gardens are often sold locally within ___ of harvest.', accepted: ['hours'] },
      ],
    }],
  },
};

const COURSE_CODE = 'IELTS-COMPLETE';

async function seedCourse() {
  let course = await prisma.course.findFirst({ where: { deletedAt: null, status: { not: 'ARCHIVED' } } });
  if (!course) {
    course = await prisma.course.create({
      data: {
        code: COURSE_CODE, title: 'Complete IELTS Preparation', slug: 'complete-ielts-preparation', courseType: 'COMPLETE',
        description: 'Everything you need for IELTS in one course: teacher-led daily classes, all four modules (Listening, Reading, Writing and Speaking), daily mock tests based on IELTS past papers, expected-question practice and AI-powered learning tools.',
        durationWeeks: 12, defaultAccessDays: 180, price: 45000, currency: 'PKR', status: 'PUBLISHED',
      },
    });
  }
  let version = await prisma.courseVersion.findFirst({ where: { courseId: course.id, status: 'PUBLISHED' }, orderBy: { versionNumber: 'desc' } });
  if (!version) {
    version = await prisma.courseVersion.create({ data: { courseId: course.id, versionNumber: (await prisma.courseVersion.count({ where: { courseId: course.id } })) + 1, status: 'PUBLISHED', publishedAt: new Date() } });
  }
  if ((await prisma.courseSection.count({ where: { courseVersionId: version.id } })) > 0) return;

  const ids = {
    listening: await createAssessment(SPECS.listening), reading: await createAssessment(SPECS.reading),
    mock1: await createAssessment(SPECS.mock1), mock2: await createAssessment(SPECS.mock2), mock3: await createAssessment(SPECS.mock3),
    diagnostic: await createAssessment(SPECS.diagnostic),
  };

  let seq = 0;
  const section = (title: string, description?: string) => prisma.courseSection.create({ data: { courseVersionId: version!.id, title, description, sequence: seq++ } });
  const item = async (sectionId: string, sequence: number, title: string, contentType: ContentType, metadata: object, extra: { release?: ReleaseType; releaseValue?: object; required?: boolean; minutes?: number } = {}) =>
    prisma.contentItem.create({
      data: {
        sectionId, sequence, title, contentType, metadataJson: metadata as never, isRequired: extra.required ?? true, estimatedMinutes: extra.minutes,
        releaseType: extra.release ?? 'IMMEDIATE', releaseValue: extra.releaseValue as never,
      },
    });

  const start = await section('Getting Started');
  await item(start.id, 0, 'Welcome to the course', 'TEXT', { body: 'Welcome! This course prepares you for all four IELTS modules. You attend daily classes with your teacher, practise every day, and sit daily mock tests. Work through the sections in order and ask your teacher if anything is unclear.' }, { minutes: 5 });
  await item(start.id, 1, 'How the course works', 'TEXT', { body: 'Each day: 1) join your live class, 2) complete the practice for that module, 3) take the daily mock test. Your progress and estimated band are updated automatically as you complete work.' }, { minutes: 5 });

  const listening = await section('Listening', 'Sections 1–4, note completion, multiple choice and map/diagram questions.');
  const l1 = await item(listening.id, 0, 'Listening strategies', 'TEXT', { body: 'Read the questions before the audio plays. Underline key words. Write answers as you listen and check spelling and plurals at the end.' }, { minutes: 10 });
  await item(listening.id, 1, 'Listening Practice Test 1', 'LISTENING_TEST', { assessmentId: ids.listening }, { release: 'PREREQUISITE', releaseValue: { requiredItemId: l1.id }, minutes: 30 });

  const reading = await section('Reading', 'Skimming, scanning and every IELTS reading question type.');
  const r1 = await item(reading.id, 0, 'Reading strategies', 'TEXT', { body: 'Skim for the main idea, then scan for names, numbers and keywords. For True/False/Not Given, decide whether the passage agrees, contradicts or says nothing.' }, { minutes: 10 });
  await item(reading.id, 1, 'Reading Practice Test 1', 'READING_TEST', { assessmentId: ids.reading }, { release: 'PREREQUISITE', releaseValue: { requiredItemId: r1.id }, minutes: 30 });

  const writing = await section('Writing', 'Task 1 (report) and Task 2 (essay).');
  await item(writing.id, 0, 'Task 2 essay structure', 'TEXT', { body: 'Introduction (paraphrase + your position), two body paragraphs (point, explanation, example), conclusion. Aim for 250+ words in 40 minutes.' }, { minutes: 10 });
  const essay = await item(writing.id, 1, 'Task 2 practice essay', 'WRITING_TASK', {}, { minutes: 40 });

  const speaking = await section('Speaking', 'Parts 1, 2 and 3.');
  await item(speaking.id, 0, 'Speaking Part 2 tips', 'TEXT', { body: 'Use the one minute to note key points. Speak for the full two minutes, use linking words and add a personal example.' }, { minutes: 10 });
  const talk = await item(speaking.id, 1, 'Speaking Part 2 recording', 'SPEAKING_TASK', {}, { minutes: 15 });

  const mocks = await section('Daily Mock Tests', 'Take a new mock every day. Built from past-paper styles and expected question patterns.');
  await item(mocks.id, 0, 'Daily Mock Test 1', 'MOCK_TEST', { assessmentId: ids.mock1 }, { minutes: 20 });
  await item(mocks.id, 1, 'Daily Mock Test 2 — Past-paper style', 'MOCK_TEST', { assessmentId: ids.mock2 }, { minutes: 20 });
  await item(mocks.id, 2, 'Daily Mock Test 3 — Expected questions', 'MOCK_TEST', { assessmentId: ids.mock3 }, { minutes: 20 });

  const writingRubric = await prisma.rubric.findFirstOrThrow({ where: { name: 'IELTS Writing Task 2' } });
  const speakingRubric = await prisma.rubric.findFirstOrThrow({ where: { name: 'IELTS Speaking' } });
  await prisma.assignment.create({ data: { contentItemId: essay.id, skill: 'WRITING', rubricId: writingRubric.id, minWords: 250, instructions: 'Some people think universities should teach practical skills rather than academic subjects. To what extent do you agree or disagree? Write at least 250 words.' } });
  await prisma.assignment.create({ data: { contentItemId: talk.id, skill: 'SPEAKING', rubricId: speakingRubric.id, instructions: 'Describe a place you enjoy visiting. Say where it is, how often you go, what you do there, and explain why you like it. Speak for up to two minutes.' } });
}

async function seedSettings() {
  const settings: Record<string, unknown> = {
    'payment.methods': [
      { method: 'BANK_TRANSFER', enabled: true, bankName: 'Demo Bank Ltd', accountTitle: 'Demo IELTS Academy', accountNumber: '0000-0000000000', iban: 'PK00DEMO0000000000000000', instructions: 'Send the exact amount and keep the receipt. Use your name as the payment reference.' },
      { method: 'JAZZCASH', enabled: true, bankName: '', accountTitle: 'Demo IELTS Academy', accountNumber: '0300-0000000', iban: '', instructions: 'Send to this JazzCash number and upload a screenshot of the confirmation.' },
      { method: 'EASYPAISA', enabled: true, bankName: '', accountTitle: 'Demo IELTS Academy', accountNumber: '0345-0000000', iban: '', instructions: 'Send to this Easypaisa number and upload a screenshot of the confirmation.' },
    ],
    'commerce.currency': 'PKR',
    'commerce.refund_window_days': 7,
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }
}

/** Everything a fresh install needs: safe to run in production and to re-run. */
export async function seedReference() {
  await seedRbac();
  await seedAdmin();
  await seedAssessmentData(); // band tables + rubrics (the course tasks below reference the rubrics)
  await seedCourse();
  await seedSettings();
}

if (require.main === module) {
  seedReference()
    .then(() => console.log('Seed complete.'))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}

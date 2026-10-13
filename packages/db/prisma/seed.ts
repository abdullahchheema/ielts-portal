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
  'curriculum.manage', 'curriculum.assign', 'mock.review', 'recording.manage', 'recording.review', 'batch.analytics.view',
] as const;

const ROLES: Record<string, { description: string; permissions: readonly string[] | 'ALL' }> = {
  SUPER_ADMIN: { description: 'Full system control', permissions: 'ALL' },
  ACADEMIC_ADMIN: {
    description: 'Courses, curriculum, batches, mentors, academic reports',
    permissions: ['course.view', 'course.create', 'course.edit', 'course.publish', 'content.manage',
      'batch.view', 'batch.create', 'batch.edit', 'mentor.assign', 'teaching.view', 'teacher.manage', 'student.view',
      'enrollment.view', 'enrollment.create', 'report.academic.view', 'dashboard.view', 'assessment.manage',
      'curriculum.manage', 'curriculum.assign', 'mock.review', 'recording.manage', 'recording.review', 'batch.analytics.view'],
  },
  CONTENT_MANAGER: {
    description: 'Lessons, files and practice material',
    permissions: ['course.view', 'course.edit', 'content.manage', 'dashboard.view', 'assessment.manage', 'curriculum.manage'],
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
    permissions: ['teaching.view', 'submission.view', 'submission.grade', 'curriculum.assign', 'recording.manage', 'mock.review'],
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
interface Q {
  type: 'MCQ_SINGLE' | 'MCQ_MULTI' | 'TFNG' | 'YNNG' | 'MATCHING' | 'COMPLETION'; text: string; options?: [string, boolean?][]; value?: string; accepted?: string[];
  // IELTS-facing taxonomy (spec §28–§29): the grader stays `type` above; these are for filtering, practice generation and insights.
  skillKey?: string; ieltsQuestionType?: string; difficulty?: 'FOUNDATION' | 'EASY' | 'MEDIUM' | 'HARD';
}
interface AssessmentSpec {
  title: string; type: 'LISTENING' | 'READING' | 'MOCK' | 'DIAGNOSTIC' | 'QUIZ'; skill?: 'LISTENING' | 'READING'; timeLimitMin?: number; passPercent?: number; maxAttempts?: number;
  module?: 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING' | 'GENERAL'; track?: 'ACADEMIC' | 'GENERAL' | 'BOTH';
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
      const question = await prisma.question.create({
        data: {
          sectionId: section.id, questionType: q.type, sequence: qSeq++,
          module: spec.module, track: spec.track ?? 'BOTH', skillKey: q.skillKey, ieltsQuestionType: q.ieltsQuestionType, difficulty: q.difficulty,
        },
      });
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

  // ── Representative practice banks for the IELTS question-type taxonomy (spec §16, §29) ──
  listeningFormCompletion: {
    title: 'Listening Form Completion — Practice Set 1', type: 'LISTENING', skill: 'LISTENING', timeLimitMin: 10, passPercent: 50, module: 'LISTENING',
    sections: [{
      title: 'Community Centre Membership Form', instructions: 'Sample paper. Your teacher attaches the recording for each real test; answer as you listen.',
      questions: [
        { type: 'COMPLETION', text: 'Applicant surname: ___', accepted: ['Harrison', 'harrison'], skillKey: 'listening.qtype.form_completion', ieltsQuestionType: 'FORM_COMPLETION', difficulty: 'EASY' },
        { type: 'COMPLETION', text: 'Preferred membership type: ___', accepted: ['family', 'Family'], skillKey: 'listening.qtype.form_completion', ieltsQuestionType: 'FORM_COMPLETION', difficulty: 'EASY' },
        { type: 'COMPLETION', text: 'Membership fee per month: £___', accepted: ['35', '£35'], skillKey: 'listening.qtype.form_completion', ieltsQuestionType: 'FORM_COMPLETION', difficulty: 'MEDIUM' },
        { type: 'COMPLETION', text: 'Preferred start date: ___ of next month', accepted: ['1st', 'first', '1'], skillKey: 'listening.qtype.form_completion', ieltsQuestionType: 'FORM_COMPLETION', difficulty: 'MEDIUM' },
        { type: 'COMPLETION', text: 'Contact phone number ends in: ___', accepted: ['4471'], skillKey: 'listening.qtype.form_completion', ieltsQuestionType: 'FORM_COMPLETION', difficulty: 'MEDIUM' },
        { type: 'COMPLETION', text: 'Closest car park: ___ Street car park', accepted: ['Mill', 'mill'], skillKey: 'listening.qtype.form_completion', ieltsQuestionType: 'FORM_COMPLETION', difficulty: 'HARD' },
      ],
    }],
  },
  listeningMatching: {
    title: 'Listening Matching — Practice Set 1', type: 'LISTENING', skill: 'LISTENING', timeLimitMin: 10, passPercent: 50, module: 'LISTENING',
    sections: [{
      title: 'Orientation Day Activity Choices', instructions: 'Sample paper. Match each student to the activity they chose. Your teacher attaches the recording for each real test; answer as you listen.',
      questions: [
        { type: 'MATCHING', text: 'Priya', options: [['Campus tour'], ['Library induction', true], ['Sports taster session'], ['Welcome lunch']], skillKey: 'listening.qtype.matching', ieltsQuestionType: 'MATCHING', difficulty: 'MEDIUM' },
        { type: 'MATCHING', text: 'Daniel', options: [['Campus tour', true], ['Library induction'], ['Sports taster session'], ['Welcome lunch']], skillKey: 'listening.qtype.matching', ieltsQuestionType: 'MATCHING', difficulty: 'MEDIUM' },
        { type: 'MATCHING', text: 'Fatima', options: [['Campus tour'], ['Library induction'], ['Sports taster session', true], ['Welcome lunch']], skillKey: 'listening.qtype.matching', ieltsQuestionType: 'MATCHING', difficulty: 'MEDIUM' },
        { type: 'MATCHING', text: 'Leo', options: [['Campus tour'], ['Library induction'], ['Sports taster session'], ['Welcome lunch', true]], skillKey: 'listening.qtype.matching', ieltsQuestionType: 'MATCHING', difficulty: 'HARD' },
      ],
    }],
  },
  listeningMcq: {
    title: 'Listening Multiple Choice — Practice Set 1', type: 'LISTENING', skill: 'LISTENING', timeLimitMin: 10, passPercent: 50, module: 'LISTENING',
    sections: [{
      title: 'University Library Tour', instructions: 'Sample paper. Your teacher attaches the recording for each real test; answer as you listen.',
      questions: [
        { type: 'MCQ_SINGLE', text: 'Where should students return books after closing time?', options: [['At the main desk'], ['In the night drop box', true], ['They cannot return books after closing']], skillKey: 'listening.qtype.mcq_single', ieltsQuestionType: 'MULTIPLE_CHOICE_SINGLE', difficulty: 'EASY' },
        { type: 'MCQ_SINGLE', text: 'How long can undergraduate students borrow a book for?', options: [['One week'], ['Two weeks'], ['Four weeks', true]], skillKey: 'listening.qtype.mcq_single', ieltsQuestionType: 'MULTIPLE_CHOICE_SINGLE', difficulty: 'EASY' },
        { type: 'MCQ_SINGLE', text: 'What does the guide say about the silent study floor?', options: [['It is on the ground floor'], ['It is the top floor', true], ['It was closed for renovation']], skillKey: 'listening.qtype.mcq_single', ieltsQuestionType: 'MULTIPLE_CHOICE_SINGLE', difficulty: 'MEDIUM' },
        { type: 'MCQ_SINGLE', text: 'What is required to book a group study room?', options: [['A student ID card', true], ['A deposit'], ['Permission from a tutor']], skillKey: 'listening.qtype.mcq_single', ieltsQuestionType: 'MULTIPLE_CHOICE_SINGLE', difficulty: 'MEDIUM' },
        { type: 'MCQ_SINGLE', text: 'What does the guide recommend for finding journal articles?', options: [['The printed catalogue'], ['Asking at the help desk'], ['The online database', true]], skillKey: 'listening.qtype.mcq_single', ieltsQuestionType: 'MULTIPLE_CHOICE_SINGLE', difficulty: 'HARD' },
      ],
    }],
  },
  readingMatchingHeadings: {
    title: 'Reading Matching Headings — Practice Set 1', type: 'READING', skill: 'READING', timeLimitMin: 15, passPercent: 50, module: 'READING', track: 'ACADEMIC',
    sections: [{
      title: 'Passage — The History of Street Lighting',
      instructions: 'The passage has four paragraphs, A–D. Choose the correct heading for each paragraph from the list below. There are more headings than paragraphs. i. An unexpected safety debate · ii. Early methods and their limits · iii. A technology that changed city life at night · iv. The move toward automation · v. Modern concerns about light itself · vi. The cost of maintaining the system',
      passage: 'A. Before artificial lighting, city streets after dark were lit only by moonlight or the occasional lantern carried by a passer-by. Oil lamps, and later gas lamps, were the first organised attempt to light public streets, but they required a lamplighter to visit each one by hand every evening, which limited how many a city could realistically maintain. B. The introduction of electric street lighting in the late nineteenth century transformed urban life. Shops could stay open later, public spaces felt safer to pedestrians, and cities began to plan their layouts around the assumption that streets would remain usable after sunset. C. As electric networks expanded, lamplighters were gradually replaced by centrally controlled switching, and eventually by photocells that turn lights on and off automatically as daylight levels change, removing the need for manual intervention almost entirely. D. In recent years, researchers have begun to raise concerns not about the absence of street lighting but about its overuse — arguing that excessive artificial light at night disrupts wildlife and interferes with people\'s sleep, prompting some cities to dim or redesign their lighting after midnight.',
      questions: [
        { type: 'MATCHING', text: 'Paragraph A', options: [['An unexpected safety debate'], ['Early methods and their limits', true], ['A technology that changed city life at night'], ['The move toward automation'], ['Modern concerns about light itself'], ['The cost of maintaining the system']], skillKey: 'reading.academic.qtype.matching_headings', ieltsQuestionType: 'MATCHING_HEADINGS', difficulty: 'MEDIUM' },
        { type: 'MATCHING', text: 'Paragraph B', options: [['An unexpected safety debate'], ['Early methods and their limits'], ['A technology that changed city life at night', true], ['The move toward automation'], ['Modern concerns about light itself'], ['The cost of maintaining the system']], skillKey: 'reading.academic.qtype.matching_headings', ieltsQuestionType: 'MATCHING_HEADINGS', difficulty: 'MEDIUM' },
        { type: 'MATCHING', text: 'Paragraph C', options: [['An unexpected safety debate'], ['Early methods and their limits'], ['A technology that changed city life at night'], ['The move toward automation', true], ['Modern concerns about light itself'], ['The cost of maintaining the system']], skillKey: 'reading.academic.qtype.matching_headings', ieltsQuestionType: 'MATCHING_HEADINGS', difficulty: 'HARD' },
        { type: 'MATCHING', text: 'Paragraph D', options: [['An unexpected safety debate'], ['Early methods and their limits'], ['A technology that changed city life at night'], ['The move toward automation'], ['Modern concerns about light itself', true], ['The cost of maintaining the system']], skillKey: 'reading.academic.qtype.matching_headings', ieltsQuestionType: 'MATCHING_HEADINGS', difficulty: 'HARD' },
      ],
    }],
  },
  readingTfng: {
    title: 'Reading True/False/Not Given — Practice Set 1', type: 'READING', skill: 'READING', timeLimitMin: 15, passPercent: 50, module: 'READING', track: 'ACADEMIC',
    sections: [{
      title: 'Passage — The Return of the Sea Otter',
      instructions: 'Do the following statements agree with the information in the passage?',
      passage: 'Sea otter populations along the Pacific coast were hunted to near-extinction for their fur by the early twentieth century, with only a small number of isolated colonies surviving. Conservation efforts beginning in the 1970s, including legal protection and reintroduction programmes, allowed numbers to recover steadily in several regions, though recovery has been uneven: some areas have seen populations rebound strongly, while others remain far below historic levels. Sea otters are considered a keystone species because they prey on sea urchins, which would otherwise overgraze kelp forests; healthy otter populations are therefore linked to healthier kelp ecosystems. Researchers note that current threats include oil spills, disease, and competition with fisheries, and that full recovery to historic population levels has not yet been achieved anywhere along the coast.',
      questions: [
        { type: 'TFNG', text: 'Sea otters were hunted close to extinction for their fur.', value: 'TRUE', skillKey: 'reading.academic.qtype.tfng', ieltsQuestionType: 'TRUE_FALSE_NOT_GIVEN', difficulty: 'EASY' },
        { type: 'TFNG', text: 'Every region along the coast has seen sea otter populations recover at the same rate.', value: 'FALSE', skillKey: 'reading.academic.qtype.tfng', ieltsQuestionType: 'TRUE_FALSE_NOT_GIVEN', difficulty: 'MEDIUM' },
        { type: 'TFNG', text: 'Sea otters help kelp forests by eating sea urchins.', value: 'TRUE', skillKey: 'reading.academic.qtype.tfng', ieltsQuestionType: 'TRUE_FALSE_NOT_GIVEN', difficulty: 'MEDIUM' },
        { type: 'TFNG', text: 'Oil spills are the single biggest threat to sea otters today.', value: 'NOT_GIVEN', skillKey: 'reading.academic.qtype.tfng', ieltsQuestionType: 'TRUE_FALSE_NOT_GIVEN', difficulty: 'HARD' },
        { type: 'TFNG', text: 'Sea otter populations have fully recovered to their historic levels along the whole coast.', value: 'FALSE', skillKey: 'reading.academic.qtype.tfng', ieltsQuestionType: 'TRUE_FALSE_NOT_GIVEN', difficulty: 'MEDIUM' },
      ],
    }],
  },
  readingSummaryCompletion: {
    title: 'Reading Summary Completion — Practice Set 1', type: 'READING', skill: 'READING', timeLimitMin: 15, passPercent: 50, module: 'READING', track: 'ACADEMIC',
    sections: [{
      title: 'Passage — Community-Supported Agriculture',
      instructions: 'Complete the summary below using NO MORE THAN TWO WORDS from the passage for each answer.\nSummary: Under a community-supported agriculture scheme, customers pay a farm at the start of the (Q1: ___) in exchange for a regular share of produce once harvesting begins. Supporters say the arrangement gives farmers more financial (Q2: ___), since the money arrives before the main costs of the season are paid. Customers, in turn, often report a stronger sense of (Q3: ___) to the farm that grows their food, and some schemes additionally invite members to take part in (Q4: ___) days at the farm itself. Critics note that members take on some of the (Q5: ___) of a poor harvest, since the size of each week\'s share is not guaranteed in advance.',
      passage: 'Under a community-supported agriculture (CSA) scheme, customers pay a farm a lump sum at the start of the growing season, in exchange for a regular share of the farm\'s produce once harvesting begins each week. Supporters argue the arrangement gives small farms greater financial security, since the upfront payment arrives before the season\'s main costs — seed, labour, equipment repairs — have to be paid. Members, meanwhile, often report feeling a stronger connection to the farm that grows their food than they would from an anonymous supermarket purchase, and many CSA schemes additionally invite members to volunteer on open farm days throughout the season. Critics point out that this model also transfers some of the risk of a poor harvest onto members themselves, since a CSA share is not a guaranteed fixed quantity of produce each week — a bad growing season can mean a smaller share for everyone, a risk a supermarket customer never faces.',
      questions: [
        { type: 'COMPLETION', text: 'Q1 — Under a community-supported agriculture scheme, customers pay at the start of the ___.', accepted: ['growing season', 'season'], skillKey: 'reading.academic.qtype.summary_completion', ieltsQuestionType: 'SUMMARY_COMPLETION', difficulty: 'EASY' },
        { type: 'COMPLETION', text: 'Q2 — The arrangement gives farmers more financial ___.', accepted: ['security'], skillKey: 'reading.academic.qtype.summary_completion', ieltsQuestionType: 'SUMMARY_COMPLETION', difficulty: 'MEDIUM' },
        { type: 'COMPLETION', text: 'Q3 — Customers report a stronger sense of ___ to the farm.', accepted: ['connection'], skillKey: 'reading.academic.qtype.summary_completion', ieltsQuestionType: 'SUMMARY_COMPLETION', difficulty: 'MEDIUM' },
        { type: 'COMPLETION', text: 'Q4 — Some schemes invite members to take part in ___ days at the farm.', accepted: ['open farm', 'open farm days', 'volunteer'], skillKey: 'reading.academic.qtype.summary_completion', ieltsQuestionType: 'SUMMARY_COMPLETION', difficulty: 'HARD' },
        { type: 'COMPLETION', text: 'Q5 — Members take on some of the ___ of a poor harvest.', accepted: ['risk'], skillKey: 'reading.academic.qtype.summary_completion', ieltsQuestionType: 'SUMMARY_COMPLETION', difficulty: 'MEDIUM' },
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

  // ───────── section/item helpers, extended with the curriculum taxonomy (spec §11–§15, §28) ─────────
  // All original practice/lesson text below is the academy's own writing, labelled ORIGINAL —
  // never presented as official IELTS or British Council material (spec §30).
  let seq = 0;
  interface Taxonomy {
    track?: 'ACADEMIC' | 'GENERAL' | 'BOTH'; module?: 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING' | 'GENERAL';
    kind?: 'MODULE' | 'AREA' | 'UNIT'; area?: string; skillKey?: string;
  }
  const section = (title: string, description?: string, parentSectionId?: string, tax: Taxonomy = {}) =>
    prisma.courseSection.create({
      data: {
        courseVersionId: version!.id, parentSectionId, title, description, sequence: seq++,
        track: tax.track ?? 'BOTH', module: tax.module, kind: tax.kind ?? 'UNIT', area: tax.area, skillKey: tax.skillKey,
      },
    });

  interface ItemTax {
    track?: 'ACADEMIC' | 'GENERAL' | 'BOTH'; module?: 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING' | 'GENERAL';
    skillKey?: string; testPart?: string; activityKind?: 'LESSON' | 'WORKED_EXAMPLE' | 'GUIDED_EXERCISE' | 'PRACTICE' | 'TIMED_PRACTICE' | 'MASTERY_CHECK' | 'PROMPT' | 'REVISION';
    difficulty?: 'FOUNDATION' | 'EASY' | 'MEDIUM' | 'HARD'; isTimed?: boolean; teacherAssignable?: boolean; recommendable?: boolean; masteryPercent?: number;
  }
  const item = async (
    sectionId: string, sequence: number, title: string, contentType: ContentType, metadata: object,
    extra: { release?: ReleaseType; releaseValue?: object; required?: boolean; minutes?: number } & ItemTax = {},
  ) =>
    prisma.contentItem.create({
      data: {
        sectionId, sequence, title, contentType, metadataJson: metadata as never, isRequired: extra.required ?? true, estimatedMinutes: extra.minutes,
        releaseType: extra.release ?? 'IMMEDIATE', releaseValue: extra.releaseValue as never,
        track: extra.track ?? 'BOTH', module: extra.module, skillKey: extra.skillKey, testPart: extra.testPart,
        activityKind: extra.activityKind ?? 'LESSON', difficulty: extra.difficulty, isTimed: extra.isTimed ?? false,
        teacherAssignable: extra.teacherAssignable ?? true, recommendable: extra.recommendable ?? true, masteryPercent: extra.masteryPercent,
      },
    });
  /** A lesson is the one content item every unit gets; title/skillKey/body carry its substance. */
  const lesson = (sectionId: string, title: string, skillKey: string, body: string, tax: ItemTax = {}) =>
    item(sectionId, 0, title, 'TEXT', { body }, { minutes: 8, ...tax, skillKey, activityKind: tax.activityKind ?? 'LESSON' });
  /** A unit (UNIT-kind sub-section) holding exactly one lesson item, for a flat list of [title, skillKey, body]. */
  const unitWithLesson = async (parentId: string, title: string, skillKey: string, body: string, tax: Taxonomy & ItemTax = {}) => {
    const s = await section(title, undefined, parentId, { kind: 'UNIT', track: tax.track, module: tax.module, area: tax.area, skillKey });
    await lesson(s.id, `${title} — lesson`, skillKey, body, tax);
    return s;
  };
  const units = (parentId: string, rows: [string, string, string][], tax: Taxonomy & ItemTax = {}) =>
    Promise.all(rows.map(([title, skillKey, body]) => unitWithLesson(parentId, title, skillKey, body, tax)));

  // ───────── Getting Started (unchanged) ─────────
  const start = await section('Getting Started', undefined, undefined, { kind: 'MODULE', module: 'GENERAL' });
  await item(start.id, 0, 'Welcome to the course', 'TEXT', { body: 'Welcome! This course prepares you for all four IELTS modules. You attend daily classes with your teacher, practise every day, and sit daily mock tests. Work through the sections in order and ask your teacher if anything is unclear.' }, { minutes: 5, module: 'GENERAL' });
  await item(start.id, 1, 'How the course works', 'TEXT', { body: 'Each day: 1) join your live class, 2) complete the practice for that module, 3) take the daily mock test. Your progress and estimated band are updated automatically as you complete work.' }, { minutes: 5, module: 'GENERAL' });

  // ═════════════════════════════ LISTENING (shared: Academic and General Training) ═════════════════════════════
  const listening = await section('Listening', 'Sections 1–4, note completion, multiple choice and map/diagram questions.', undefined, { kind: 'MODULE', module: 'LISTENING' });
  const l1 = await item(listening.id, 0, 'Listening strategies', 'TEXT', { body: 'Read the questions before the audio plays. Underline key words. Write answers as you listen and check spelling and plurals at the end.' }, { minutes: 10, module: 'LISTENING', skillKey: 'listening.strategies' });
  await item(listening.id, 1, 'Listening Practice Test 1', 'LISTENING_TEST', { assessmentId: ids.listening }, { release: 'PREREQUISITE', releaseValue: { requiredItemId: l1.id }, minutes: 30, module: 'LISTENING', skillKey: 'listening.mixed_practice', activityKind: 'PRACTICE' });

  const listeningFoundations = await section('Listening Foundations', 'The core skills every part of the test relies on.', listening.id, { kind: 'AREA', module: 'LISTENING', area: 'FOUNDATIONS' });
  await units(listeningFoundations.id, [
    ['Understanding the Test Format', 'listening.foundations.test_format', 'The Listening test has four recorded sections, each harder than the last: a everyday conversation, a monologue in a social context, an academic discussion between up to four people, and an academic monologue. You hear each recording once, answer as you listen, and get ten minutes at the end (paper-based) to transfer answers. On the computer-delivered test you type directly and can flag questions to revisit before time runs out.'],
    ['Predicting Answers and Recognising Paraphrase', 'listening.foundations.prediction', 'Before the audio starts, read the questions and predict the kind of answer each one needs — a name, a number, a type of place. The recording almost never uses the exact words in the question; it paraphrases them. Training yourself to hear a paraphrase of what you read is the single biggest skill gain available in Listening.'],
    ['Numbers, Dates, Spelling and Word Limits', 'listening.foundations.numbers_spelling', 'Practise writing numbers, dates, times, prices and addresses quickly and accurately under pressure — these appear in almost every Section 1. Always check the word limit given in the instructions (e.g. "NO MORE THAN TWO WORDS"): going over it marks the whole answer wrong, even if the words themselves are correct.'],
    ['Note-Taking and Tracking Speakers', 'listening.foundations.note_taking', 'Use abbreviations and symbols so you can write fast enough to keep up. In multi-speaker recordings, listen for who is talking and watch for a change of speaker or topic — a changed opinion or correction later in the recording is a common trap.'],
    ['Distractors and Staying on Track if You Miss an Answer', 'listening.foundations.distractors', 'Speakers often start to say one thing and then correct themselves ("the class is on Tuesday — actually, sorry, it moved to Wednesday"). The first answer mentioned is a distractor; listen for the correction. If you miss an answer, do not dwell on it — move straight to the next question so you do not also miss the one after it.'],
    ['Accent Familiarisation and Computer-Delivered Skills', 'listening.foundations.accents_cb', 'IELTS recordings use a mix of British, Australian, American and other native-English accents. Regular exposure to different accents is the only real preparation. On the computer-delivered test, practise typing answers directly, using the on-screen notepad, and navigating between questions with the review flags before the recording ends.'],
  ], { module: 'LISTENING' });

  const listeningQTypes = await section('Listening Question Types', 'A dedicated unit for every IELTS Listening question type.', listening.id, { kind: 'AREA', module: 'LISTENING', area: 'QUESTION_TYPES' });
  const lqRows: [string, string, string][] = [
    ['Form Completion', 'listening.qtype.form_completion', 'Form Completion asks you to fill gaps in a form — typically a booking, application or registration. Names, numbers and addresses are common. Read the form\'s headings first: they tell you what kind of information is missing before you hear a single word.'],
    ['Note Completion', 'listening.qtype.note_completion', 'Note Completion gives you a partially-filled outline of the talk. The structure of the notes mirrors the structure of the recording, so follow along heading by heading rather than waiting for keywords to jump out.'],
    ['Table Completion', 'listening.qtype.table_completion', 'Table Completion organises information into rows and columns — often comparing several options (prices, times, features). Read the column headers before listening so you know which cell each piece of information belongs in.'],
    ['Flow-Chart Completion', 'listening.qtype.flow_chart_completion', 'Flow-chart Completion tracks a sequence of steps or a process. Arrows show the order events happen in, which usually (but not always) matches the order they are mentioned in the recording — listen for sequencing language like "after that" and "once you have".'],
    ['Summary Completion', 'listening.qtype.summary_completion', 'Summary Completion gives you a short paragraph that restates part of the recording with some words removed. The summary paraphrases the audio, so the exact words you hear rarely match the summary text around each gap.'],
    ['Sentence Completion', 'listening.qtype.sentence_completion', 'Sentence Completion gives you single sentences with a gap. Check the grammar of the sentence around the gap — it tells you whether a noun, verb or adjective is missing, which narrows down what you are listening for.'],
    ['Multiple Choice: One Answer', 'listening.qtype.mcq_single', 'Multiple Choice with one correct answer tests whether you can follow an argument or description to its actual conclusion. Distractor options are usually mentioned in the audio too, then ruled out or corrected — pick the option that is confirmed, not just mentioned.'],
    ['Multiple Choice: Multiple Answers', 'listening.qtype.mcq_multi', 'Multiple Choice with more than one correct answer asks you to choose, for example, exactly two options from five. All the options are usually discussed; listen for which ones the speaker actually confirms, recommends or decides on.'],
    ['Matching', 'listening.qtype.matching', 'Matching questions ask you to connect items from one list (e.g. speakers, places, dates) to a list of options. Options are often used only once, so track which ones you have already matched to avoid reusing one by mistake.'],
    ['Map, Plan and Diagram Labelling', 'listening.qtype.map_labelling', 'Map and Plan Labelling asks you to mark locations on a diagram as someone describes a route or layout. Orient yourself first — find the starting point and any landmarks mentioned early — then follow the directions step by step as they are given.'],
    ['Short-Answer Questions', 'listening.qtype.short_answer', 'Short-Answer Questions want a brief, factual answer within the stated word limit. They are usually direct "wh-" questions (what, where, how many) — predicting the type of fact needed before you listen narrows down what to listen for.'],
  ];
  const lqSections = Object.fromEntries((await Promise.all(lqRows.map(async ([title, skillKey, body]) => {
    const s = await unitWithLesson(listeningQTypes.id, title, skillKey, body, { module: 'LISTENING' });
    return [skillKey, s.id] as const;
  }))));

  // Representative practice banks with real, gradable, original questions (spec §16, §29).
  const lFormCompletionAssessment = await createAssessment(SPECS.listeningFormCompletion);
  await item(lqSections['listening.qtype.form_completion'], 1, 'Form Completion — Practice Set', 'LISTENING_TEST', { assessmentId: lFormCompletionAssessment }, { minutes: 10, module: 'LISTENING', skillKey: 'listening.qtype.form_completion', activityKind: 'PRACTICE', difficulty: 'EASY' });
  const lMatchingAssessment = await createAssessment(SPECS.listeningMatching);
  await item(lqSections['listening.qtype.matching'], 1, 'Matching — Practice Set', 'LISTENING_TEST', { assessmentId: lMatchingAssessment }, { minutes: 10, module: 'LISTENING', skillKey: 'listening.qtype.matching', activityKind: 'PRACTICE', difficulty: 'MEDIUM' });
  const lMcqAssessment = await createAssessment(SPECS.listeningMcq);
  await item(lqSections['listening.qtype.mcq_single'], 1, 'Multiple Choice — Practice Set', 'LISTENING_TEST', { assessmentId: lMcqAssessment }, { minutes: 10, module: 'LISTENING', skillKey: 'listening.qtype.mcq_single', activityKind: 'PRACTICE', difficulty: 'MEDIUM' });

  const listeningParts = await section('Listening Parts', 'What to expect in each of the four recorded sections.', listening.id, { kind: 'AREA', module: 'LISTENING', area: 'PARTS' });
  await Promise.all([
    unitWithLesson(listeningParts.id, 'Part 1: Everyday Conversation', 'listening.part1', 'Part 1 is a conversation between two people in an everyday social context — booking a service, asking about accommodation, enrolling in a class. It is the most straightforward section: expect Form Completion and Note Completion built from concrete facts.', { module: 'LISTENING', testPart: 'PART_1' }),
    unitWithLesson(listeningParts.id, 'Part 2: Social Monologue', 'listening.part2', 'Part 2 is one person giving information in a social context — a guided tour, a talk about local facilities, an induction. Expect Table Completion, Matching and Map Labelling, since the speaker is often describing a place or a set of options.', { module: 'LISTENING', testPart: 'PART_2' }),
    unitWithLesson(listeningParts.id, 'Part 3: Academic Discussion', 'listening.part3', 'Part 3 is a discussion between up to four people in an educational context — students discussing an assignment, planning a project. Opinions, agreement and disagreement matter here: track who holds which view and whether it changes.', { module: 'LISTENING', testPart: 'PART_3' }),
    unitWithLesson(listeningParts.id, 'Part 4: Academic Monologue', 'listening.part4', 'Part 4 is an uninterrupted academic lecture — the hardest section, with no second speaker to clarify points. Note-taking discipline matters most here: follow the lecture\'s own structure (it is usually signposted) rather than waiting for individual facts.', { module: 'LISTENING', testPart: 'PART_4' }),
  ]);

  const listeningLabs = await section('Listening Skill Labs', 'Short, focused drills on one skill at a time.', listening.id, { kind: 'AREA', module: 'LISTENING', area: 'SKILL_LABS' });
  await units(listeningLabs.id, [
    ['Numbers and Dates Drill', 'listening.lab.numbers_dates', 'A short, repeatable drill: write down numbers, dates, times and prices as fast as you can from a read-aloud list (ask your teacher to read a practice list, or generate your own from a number generator). The goal is automatic, error-free transcription, not comprehension.'],
    ['Spelling Drill', 'listening.lab.spelling', 'Practise spelling names and places aloud and in writing. The test frequently expects you to write a spelled-out name correctly — one letter wrong marks the whole answer incorrect.'],
    ['Paraphrase Recognition Drill', 'listening.lab.paraphrase', 'Take a question and write down five different ways the same idea could be expressed in natural speech. Over time this builds the instinct to hear past the exact wording of a question.'],
    ['Distractor Detection Drill', 'listening.lab.distractors', 'Listen to short extracts where a speaker mentions, then rules out, an option. Practise identifying the moment the correct answer is confirmed, not just first mentioned.'],
    ['Speaker Tracking Drill', 'listening.lab.speaker_tracking', 'In a multi-speaker recording, note who says what in shorthand (initials or symbols). This habit prevents answers being attributed to the wrong person in Matching and Multiple Choice questions.'],
    ['Maps and Directions Drill', 'listening.lab.maps', 'Practise following spoken directions on a simple diagram: "turn left at the junction, the entrance is the second door." Mark your path as you listen rather than afterwards.'],
    ['Part 3 Opinions Drill', 'listening.lab.part3_opinions', 'Listen for the language speakers use to agree, disagree, or change their mind ("I take your point, but...", "actually, now that you mention it..."). These phrases usually signal the answer.'],
    ['Part 4 Note-Taking Drill', 'listening.lab.part4_notes', 'Practise taking notes from a short recorded or read-aloud talk using only headings, abbreviations and numbers — then compare your notes to a model outline to see what you missed.'],
  ], { module: 'LISTENING', activityKind: 'PRACTICE', difficulty: 'MEDIUM' });

  // ═════════════════════════════ READING (track-specific: Academic vs General Training) ═════════════════════════════
  const reading = await section('Reading', 'Skimming, scanning and every IELTS reading question type.', undefined, { kind: 'MODULE', module: 'READING' });
  const r1 = await item(reading.id, 0, 'Reading strategies', 'TEXT', { body: 'Skim for the main idea, then scan for names, numbers and keywords. For True/False/Not Given, decide whether the passage agrees, contradicts or says nothing.' }, { minutes: 10, module: 'READING', skillKey: 'reading.strategies' });
  await item(reading.id, 1, 'Reading Practice Test 1', 'READING_TEST', { assessmentId: ids.reading }, { release: 'PREREQUISITE', releaseValue: { requiredItemId: r1.id }, minutes: 30, module: 'READING', skillKey: 'reading.mixed_practice', activityKind: 'PRACTICE' });

  const readingShared = await section('Reading Foundations (Shared Skills)', 'Strategies every IELTS reading candidate needs, Academic or General Training.', reading.id, { kind: 'AREA', module: 'READING', area: 'FOUNDATIONS' });
  await units(readingShared.id, [
    ['Skimming and Scanning', 'reading.shared.skim_scan', 'Skim a passage first for its general topic and structure — read the first and last sentence of each paragraph. Then scan for specific details (names, numbers, dates) only once you know roughly where in the passage to look.'],
    ['Main Ideas and Supporting Details', 'reading.shared.main_ideas', 'Every paragraph has one main idea, usually stated early, and supporting details that develop it. Learning to separate the two quickly is what makes Matching Headings and Summary Completion fast rather than slow.'],
    ['Paraphrase Recognition and Vocabulary in Context', 'reading.shared.paraphrase_vocab', 'Questions almost never reuse the passage\'s exact wording. Build the habit of asking "what else could this idea be called?" and use context — not a dictionary definition — to work out what an unfamiliar word most likely means.'],
    ['Reference Words and Inference', 'reading.shared.reference_inference', 'Pronouns and reference words ("this", "it", "such an approach") point back to something earlier in the text — misreading what they refer to is a common source of wrong answers. Inference means accepting only what the passage logically supports, not what seems reasonable in general.'],
    ['Writer Attitude and Argument Structure', 'reading.shared.writer_attitude', 'Academic and opinion-based passages often take a position. Look for hedging language ("it could be argued", "critics claim") that signals the writer is reporting a view rather than stating a fact, and track how one paragraph\'s argument builds on or challenges the last.'],
    ['Time Management Across the Test', 'reading.shared.time_management', 'You have 60 minutes for three passages (Academic) or three sections (General Training) and no extra transfer time. A simple rule: budget 20 minutes per passage/section, and if you are not making progress on one question, mark your best guess and move on.'],
    ['Computer-Delivered Reading Skills', 'reading.shared.cb_skills', 'On the computer-delivered test you scroll through the passage on one side of the screen and answer on the other. Practise highlighting text on screen and using the split view, since you cannot physically underline the paper.'],
  ], { module: 'READING' });

  // ── Academic Reading ──
  const readingAcademic = await section('Academic Reading', 'Question types, the three passages, and skill labs for the Academic test.', reading.id, { kind: 'AREA', module: 'READING', track: 'ACADEMIC', area: 'ACADEMIC' });
  const raQTypes = await section('Academic Reading — Question Types', undefined, readingAcademic.id, { kind: 'AREA', module: 'READING', track: 'ACADEMIC', area: 'ACADEMIC_QUESTION_TYPES' });
  const raRows: [string, string, string][] = [
    ['Multiple Choice', 'reading.academic.qtype.mcq', 'Academic Reading Multiple Choice questions follow the order of the passage. Read the question stem carefully — the wrong options are usually built from real passage details used in a misleading way, not invented facts.'],
    ['True / False / Not Given', 'reading.academic.qtype.tfng', 'TRUE means the passage confirms the statement; FALSE means it contradicts it; NOT GIVEN means the passage simply does not address it. The hardest part is accepting "Not Given" rather than guessing from general knowledge.'],
    ['Yes / No / Not Given', 'reading.academic.qtype.ynng', 'Yes/No/Not Given is used for passages with opinions or claims, not pure facts. YES/NO checks whether the statement matches the writer\'s views, not whether it is objectively true.'],
    ['Matching Information', 'reading.academic.qtype.matching_information', 'Matching Information asks which paragraph contains a specific piece of information (not its main idea). Scan for the detail itself — a number, a name, a specific claim — rather than reading every paragraph in full again.'],
    ['Matching Headings', 'reading.academic.qtype.matching_headings', 'Matching Headings asks for each paragraph\'s main idea, chosen from a list with more headings than paragraphs. Read the first and last sentence of a paragraph first, and eliminate headings that are too narrow or too broad for what the paragraph actually covers.'],
    ['Matching Features', 'reading.academic.qtype.matching_features', 'Matching Features connects people, theories or things named in the passage to statements about them, often spread across the whole text rather than one paragraph at a time.'],
    ['Matching Sentence Endings', 'reading.academic.qtype.matching_sentence_endings', 'Matching Sentence Endings gives you a sentence beginning and several possible endings. Check grammar as well as meaning — only one ending will both fit grammatically and match the passage\'s content.'],
    ['Sentence Completion', 'reading.academic.qtype.sentence_completion', 'Sentence Completion in Reading follows the same word-limit discipline as Listening: check the stated limit, and make sure the completed sentence is grammatically correct, not just factually accurate.'],
    ['Summary Completion', 'reading.academic.qtype.summary_completion', 'Summary Completion may give you a word bank or ask you to find words from the passage itself. Either way, the summary is a paraphrase — locate the relevant part of the passage by meaning, not by matching exact words.'],
    ['Note Completion', 'reading.academic.qtype.note_completion', 'Note Completion in Reading mirrors Listening\'s version: the notes follow the passage\'s own structure, so work through them in order rather than searching at random.'],
    ['Table Completion', 'reading.academic.qtype.table_completion', 'Table Completion organises passage details by category. Identify which row and column a piece of information belongs to before searching the passage for it.'],
    ['Flow-Chart Completion', 'reading.academic.qtype.flow_chart_completion', 'Flow-chart Completion in Reading usually describes a process from the passage (a procedure, a cycle). Find the paragraph describing the process and work through it step by step.'],
    ['Diagram Labelling', 'reading.academic.qtype.diagram_labelling', 'Diagram Labelling asks you to label parts of a diagram using words from the passage that describes it. Find the descriptive paragraph first, then match each labelled part to its description.'],
    ['Short-Answer Questions', 'reading.academic.qtype.short_answer', 'Short-Answer Questions in Reading want a brief answer taken directly from the passage, within the stated word limit — do not paraphrase your answer, use the passage\'s own words.'],
  ];
  const raSections = Object.fromEntries((await Promise.all(raRows.map(async ([title, skillKey, body]) => {
    const s = await unitWithLesson(raQTypes.id, title, skillKey, body, { module: 'READING', track: 'ACADEMIC' });
    return [skillKey, s.id] as const;
  }))));
  const rMatchingHeadingsAssessment = await createAssessment(SPECS.readingMatchingHeadings);
  await item(raSections['reading.academic.qtype.matching_headings'], 1, 'Matching Headings — Practice Set', 'READING_TEST', { assessmentId: rMatchingHeadingsAssessment }, { minutes: 15, module: 'READING', track: 'ACADEMIC', skillKey: 'reading.academic.qtype.matching_headings', activityKind: 'PRACTICE', difficulty: 'HARD' });
  const rTfngAssessment = await createAssessment(SPECS.readingTfng);
  await item(raSections['reading.academic.qtype.tfng'], 1, 'True/False/Not Given — Practice Set', 'READING_TEST', { assessmentId: rTfngAssessment }, { minutes: 15, module: 'READING', track: 'ACADEMIC', skillKey: 'reading.academic.qtype.tfng', activityKind: 'PRACTICE', difficulty: 'MEDIUM' });
  const rSummaryAssessment = await createAssessment(SPECS.readingSummaryCompletion);
  await item(raSections['reading.academic.qtype.summary_completion'], 1, 'Summary Completion — Practice Set', 'READING_TEST', { assessmentId: rSummaryAssessment }, { minutes: 15, module: 'READING', track: 'ACADEMIC', skillKey: 'reading.academic.qtype.summary_completion', activityKind: 'PRACTICE', difficulty: 'MEDIUM' });

  const raPassages = await section('Academic Reading — Passage Mastery', 'Managing complexity and time across all three passages.', readingAcademic.id, { kind: 'AREA', module: 'READING', track: 'ACADEMIC', area: 'PASSAGE_MASTERY' });
  await units(raPassages.id, [
    ['Passage 1', 'reading.academic.passage1', 'Passage 1 is usually the most accessible of the three — a descriptive or factual text. Use it to bank time: if you finish in under 17 minutes here, you gain time for the harder passages later.'],
    ['Passage 2', 'reading.academic.passage2', 'Passage 2 steps up in complexity, often with a more argumentative or discursive structure. Expect a mix of question types rather than one type dominating.'],
    ['Passage 3', 'reading.academic.passage3', 'Passage 3 is the hardest — dense, often abstract or academic in register, with challenging vocabulary. Protect enough time for it rather than overspending on Passage 1 or 2.'],
  ], { module: 'READING', track: 'ACADEMIC' });

  const raLabs = await section('Academic Reading — Skill Labs', 'Short, focused drills on one reading skill at a time.', readingAcademic.id, { kind: 'AREA', module: 'READING', track: 'ACADEMIC', area: 'SKILL_LABS' });
  await units(raLabs.id, [
    ['Main Idea Drill', 'reading.academic.lab.main_idea', 'Read a paragraph and write its main idea in one sentence, without looking back at the text. Compare against a model answer to check you captured the idea, not just a detail.'],
    ['Paraphrase Drill', 'reading.academic.lab.paraphrase', 'Take a sentence from a passage and rewrite it in different words, keeping the meaning identical. This is the exact skill Matching Headings and Summary Completion test in reverse.'],
    ['TFNG Logic Drill', 'reading.academic.lab.tfng_logic', 'Practise short True/False/Not Given sets with an explanation required for every answer — "FALSE because the passage says X" or "Not Given because the passage never mentions Y." Explaining forces real logic, not guessing.'],
    ['Writer Opinion Drill', 'reading.academic.lab.writer_opinion', 'Underline hedging and stance language in a short opinion passage ("arguably", "it is often assumed", "in my view"). This habit makes Yes/No/Not Given questions far faster.'],
    ['Vocabulary in Context Drill', 'reading.academic.lab.vocab_in_context', 'Cover an unfamiliar word in a sentence and guess its meaning from context alone, then reveal and check. This trains the exact skill the test rewards — working from context under time pressure.'],
    ['Inference Drill', 'reading.academic.lab.inference', 'Practise distinguishing "the passage states this" from "the passage implies this" from "this seems true but is not supported." Only the first two are valid IELTS answers.'],
    ['Speed and Time Management Drill', 'reading.academic.lab.speed', 'Time yourself answering ten questions from a passage you have already read once. The goal is to build a reliable personal pace, not to go as fast as possible.'],
  ], { module: 'READING', track: 'ACADEMIC', activityKind: 'PRACTICE', difficulty: 'MEDIUM' });

  // ── General Training Reading ──
  const readingGeneral = await section('General Training Reading', 'Three sections of increasing length and complexity, in a General Training-specific structure.', reading.id, { kind: 'AREA', module: 'READING', track: 'GENERAL', area: 'GENERAL_TRAINING' });
  const rgSection1 = await section('Section 1: Everyday Texts', 'Short, practical texts — notices, advertisements, timetables.', readingGeneral.id, { kind: 'AREA', module: 'READING', track: 'GENERAL', area: 'GT_SECTION_1' });
  await units(rgSection1.id, [
    ['Notices and Advertisements', 'reading.general.s1.notices_ads', 'Section 1 texts include notices and advertisements — read the purpose first (what is this text trying to tell or sell?) before hunting for specific details.'],
    ['Transport and Accommodation Information', 'reading.general.s1.transport_accommodation', 'Timetables, tickets and accommodation listings pack a lot of information into a small space. Practise locating one specific fact (a time, a price, a condition) quickly within a dense layout.'],
    ['Public Services and Health Information', 'reading.general.s1.public_health', 'Public-service and health leaflets use plain, instructional language. Watch for conditions and exceptions ("unless", "except for") — they are frequently what a question tests.'],
    ['Events, Schedules and Community Information', 'reading.general.s1.events_community', 'Event listings and community noticeboards mix several short texts on one page. Identify which notice a question is actually about before reading in detail.'],
  ], { module: 'READING', track: 'GENERAL' });

  const rgSection2 = await section('Section 2: Workplace and Training Texts', 'Job-related and workplace texts.', readingGeneral.id, { kind: 'AREA', module: 'READING', track: 'GENERAL', area: 'GT_SECTION_2' });
  await units(rgSection2.id, [
    ['Job Advertisements and Employment Policies', 'reading.general.s2.job_ads', 'Job advertisements list requirements and conditions precisely — look for must-have vs. desirable qualifications, since questions often hinge on that distinction.'],
    ['Contracts and Workplace Information', 'reading.general.s2.contracts', 'Workplace documents use formal, precise language. Read modal verbs carefully ("must", "should", "may") — they carry different levels of obligation that questions can test directly.'],
    ['Training Instructions and Staff Notices', 'reading.general.s2.training_notices', 'Instructional texts are usually sequential — read them as a set of ordered steps, since questions often ask what happens before or after a given step.'],
    ['Health, Safety and Workplace Procedures', 'reading.general.s2.health_safety', 'Safety documents emphasise conditions and consequences ("if X occurs, then Y"). Track the condition-result pairs explicitly as you read.'],
  ], { module: 'READING', track: 'GENERAL' });

  const rgSection3 = await section('Section 3: Longer General-Interest Texts', 'A longer, more complex text, closer in style to Academic Reading.', readingGeneral.id, { kind: 'AREA', module: 'READING', track: 'GENERAL', area: 'GT_SECTION_3' });
  await units(rgSection3.id, [
    ['Main Ideas and Supporting Details', 'reading.general.s3.main_ideas', 'Section 3 texts are long enough to need the same main-idea/detail separation skill as Academic Reading — treat each paragraph the same way you would in an Academic passage.'],
    ['Argument and Inference', 'reading.general.s3.argument_inference', 'Section 3 sometimes carries a point of view. Apply the same inference discipline as Academic Reading: only accept what the text actually supports.'],
    ['Writer Position', 'reading.general.s3.writer_position', 'Identify where the writer agrees, disagrees, or stays neutral on the topic — this is usually signalled in the introduction and conclusion.'],
    ['Complex Paraphrasing', 'reading.general.s3.paraphrasing', 'Section 3\'s vocabulary and sentence structures are noticeably more complex than Sections 1–2. Slow down on long sentences and identify the core subject-verb-object before worrying about the detail around it.'],
  ], { module: 'READING', track: 'GENERAL' });

  const rgQTypes = await section('General Training Reading — Question Types', 'The same IELTS question-type families, with General Training texts and track-specific practice.', readingGeneral.id, { kind: 'AREA', module: 'READING', track: 'GENERAL', area: 'GT_QUESTION_TYPES' });
  await units(rgQTypes.id, [
    ['True / False / Not Given', 'reading.general.qtype.tfng', 'The same TFNG logic as Academic Reading, applied to General Training\'s practical and general-interest texts.'],
    ['Yes / No / Not Given', 'reading.general.qtype.ynng', 'Used where a General Training text expresses an opinion or claim rather than a pure instruction.'],
    ['Matching Headings', 'reading.general.qtype.matching_headings', 'Matching Headings appears in General Training\'s longer Section 3 texts in the same way it does in Academic Reading.'],
    ['Matching Information', 'reading.general.qtype.matching_information', 'Matching a specific detail to the paragraph or notice that contains it — common in Section 1\'s set of short texts.'],
    ['Sentence Completion', 'reading.general.qtype.sentence_completion', 'The same word-limit and grammar-checking discipline as Academic Reading, applied to workplace and everyday texts.'],
    ['Note Completion', 'reading.general.qtype.note_completion', 'Frequently used for the more instructional Section 2 texts, following their step-by-step structure.'],
    ['Short-Answer Questions', 'reading.general.qtype.short_answer', 'Brief, exact answers taken from the text, common across all three General Training sections.'],
    ['Summary Completion', 'reading.general.qtype.summary_completion', 'A paraphrased summary of part of a Section 2 or 3 text, with the same approach as Academic Reading\'s version.'],
  ], { module: 'READING', track: 'GENERAL', activityKind: 'GUIDED_EXERCISE' });

  // ═════════════════════════════ WRITING (track-specific: Academic Task 1 vs General Training Letters) ═════════════════════════════
  const writing = await section('Writing', 'Task 1 and Task 2, Academic and General Training.', undefined, { kind: 'MODULE', module: 'WRITING' });
  const writingFoundations = await section('Writing Foundations', 'Shared across both tracks: test structure, planning, and the assessment criteria.', writing.id, { kind: 'AREA', module: 'WRITING', area: 'FOUNDATIONS' });
  await units(writingFoundations.id, [
    ['Understanding the Writing Test and Its Assessment Criteria', 'writing.foundations.test_criteria', 'Both tasks are marked on four criteria: Task Achievement/Response, Coherence and Cohesion, Lexical Resource, and Grammatical Range and Accuracy, each worth 25% of the Writing band. Knowing the criteria in advance tells you exactly what to practise.'],
    ['Task Requirements and Planning Time', 'writing.foundations.task_requirements', 'Task 1 asks you to describe or report something in 150+ words in about 20 minutes; Task 2 asks for an argumentative essay in 250+ words in about 40 minutes. Spend 3–5 minutes planning before you write — unplanned essays usually lose organisation marks.'],
    ['Paragraph Construction and Coherence', 'writing.foundations.paragraphs_coherence', 'A clear paragraph has one main idea, developed with explanation or example, and linked to the sentence before it. Coherence is about the whole text making logical sense, not just using linking words.'],
    ['Lexical Resource', 'writing.foundations.lexical_resource', 'A wide and precise vocabulary matters more than "impressive" words used incorrectly. Aim for accurate word choice and natural collocations rather than forcing in rare vocabulary.'],
    ['Grammatical Range and Accuracy', 'writing.foundations.grammar', 'Markers want to see a range of sentence structures (simple, compound, complex) used accurately. A long sentence with an error is worth less than a correct one, but relying only on short simple sentences also caps your band.'],
    ['Editing and Proofreading', 'writing.foundations.editing', 'Leave two minutes at the end of each task to reread what you wrote. Look specifically for subject-verb agreement, articles, and whether you actually answered the full question.'],
    ['Computer-Delivered Writing Skills', 'writing.foundations.cb_skills', 'On the computer-delivered test you type your response directly, and the word count updates live. Practise typing under timed conditions so unfamiliarity with the keyboard does not cost you time on test day.'],
  ], { module: 'WRITING' });

  // ── Academic Writing ──
  const writingAcademic = await section('Academic Writing', 'Task 1 (describing visual information) and Task 2 (essay).', writing.id, { kind: 'AREA', module: 'WRITING', track: 'ACADEMIC', area: 'ACADEMIC' });
  const waTask1 = await section('Academic Writing — Task 1', undefined, writingAcademic.id, { kind: 'AREA', module: 'WRITING', track: 'ACADEMIC', area: 'ACADEMIC_TASK1', skillKey: 'writing.academic.task1' });
  await units(waTask1.id, [
    ['Line Graphs', 'writing.academic.task1.line_graphs', 'Line graphs usually show change over time. Describe the overall trend first, then the most significant individual movements — do not describe every single data point.'],
    ['Bar Charts', 'writing.academic.task1.bar_charts', 'Bar charts usually compare categories at one point in time, or across a few points in time. Group similar categories together in your description rather than listing every bar in order.'],
    ['Pie Charts and Tables', 'writing.academic.task1.pie_tables', 'Pie charts show proportions of a whole; tables often combine several categories and time points. In both cases, select the most significant figures rather than reporting every number.'],
    ['Mixed Visuals', 'writing.academic.task1.mixed_visuals', 'When two different chart types appear together, look for a connection between them before writing — often one chart explains or breaks down a category from the other.'],
    ['Process Diagrams', 'writing.academic.task1.process_diagrams', 'Process diagrams describe a sequence of stages (natural or manufacturing). Use sequencing language and the passive voice where the process happens to something ("the material is heated, then cooled").'],
    ['Maps and Changes Over Time', 'writing.academic.task1.maps', 'Map tasks ask you to describe how a place changed between two (or more) points in time. Organise your description by area of the map, and use clear comparative language ("where the car park used to be, there is now a library").'],
    ['Writing an Overview and Selecting Significant Features', 'writing.academic.task1.overview', 'A strong Task 1 response always has an overview paragraph stating the two or three biggest patterns, before any supporting detail. Examiners specifically look for this overview — a response without one is capped on Task Achievement.'],
    ['Making Comparisons and Data Language', 'writing.academic.task1.data_language', 'Build a working vocabulary of comparison and trend language: "whereas", "in contrast", "a sharp rise", "a gradual decline", "roughly double". Precision here is what separates a Task 1 response that merely lists numbers from one that actually reports them.'],
    ['Grammar for Task 1 and Timed Practice', 'writing.academic.task1.grammar_timed', 'Task 1 relies heavily on comparatives, superlatives and the language of approximation ("just over", "nearly half"). Practise a full Task 1 response under 20-minute timed conditions regularly, not only when you have unlimited time.'],
  ], { module: 'WRITING', track: 'ACADEMIC' });

  const waTask2 = await section('Academic Writing — Task 2', undefined, writingAcademic.id, { kind: 'AREA', module: 'WRITING', track: 'ACADEMIC', area: 'ACADEMIC_TASK2', skillKey: 'writing.academic.task2' });
  const waT2Lessons: [string, string, string][] = [
    ['Understanding Essay Prompts', 'writing.academic.task2.understanding_prompts', 'The most common Task 2 failure is answering a memorised essay instead of the actual question. Identify precisely what the prompt asks — an opinion, a discussion of two views, an evaluation of advantages — before you plan.'],
    ['Opinion / Agree or Disagree Essays', 'writing.academic.task2.opinion', 'State your position clearly in the introduction and keep it consistent throughout. You can agree fully, disagree fully, or partly agree — all are valid as long as the position is clear and supported.'],
    ['Discuss Both Views Essays', 'writing.academic.task2.discuss_both_views', 'Give both views a fair, balanced treatment with roughly equal space, then state your own opinion — usually in the conclusion, though some responses state it earlier too.'],
    ['Advantages and Disadvantages Essays', 'writing.academic.task2.advantages_disadvantages', 'Check whether the prompt asks you to simply discuss advantages and disadvantages, or asks whether the advantages outweigh the disadvantages (an "outweigh" question needs a clear final judgement).'],
    ['Problems and Solutions / Causes and Effects Essays', 'writing.academic.task2.problems_causes', 'Problem/solution essays need a real solution for each problem raised, not a vague call to action. Cause/effect essays should distinguish clearly between what causes something and what results from it.'],
    ['Two-Part Questions and Evaluation Prompts', 'writing.academic.task2.two_part_eval', 'Two-part question prompts (e.g. "why is this happening, and what can be done?") need both parts answered with roughly equal attention — answering only one part caps Task Response.'],
    ['Writing Introductions and Conclusions', 'writing.academic.task2.intro_conclusion', 'An introduction paraphrases the question and states your position; a conclusion restates your position and summarises your main points without introducing new ideas.'],
    ['Developing Body Paragraphs with Relevant Examples', 'writing.academic.task2.body_paragraphs', 'Each body paragraph should make one point, explain it, and support it with a specific example — invented but plausible examples are acceptable; vague generalisations are not.'],
    ['Planning, Outlining and Timed Task 2 Practice', 'writing.academic.task2.planning_timed', 'Spend five minutes outlining your position and two main points before writing. Practise a full Task 2 response under 40-minute timed conditions regularly.'],
  ];
  await units(waTask2.id, waT2Lessons, { module: 'WRITING', track: 'ACADEMIC' });
  // Keep the existing "Task 2 essay structure" lesson and "Task 2 practice essay" assignment exactly as seeded before (seed-demo.ts depends on these exact titles), now nested logically under this area.
  await item(waTask2.id, 100, 'Task 2 essay structure', 'TEXT', { body: 'Introduction (paraphrase + your position), two body paragraphs (point, explanation, example), conclusion. Aim for 250+ words in 40 minutes.' }, { minutes: 10, module: 'WRITING', track: 'ACADEMIC', skillKey: 'writing.academic.task2.structure' });
  const essay = await item(waTask2.id, 101, 'Task 2 practice essay', 'WRITING_TASK', {}, { minutes: 40, module: 'WRITING', track: 'ACADEMIC', skillKey: 'writing.academic.task2.opinion', activityKind: 'PROMPT', isTimed: true });
  // One additional, genuinely distinct Task 1 prompt so the submission lifecycle has more than one essay type to exercise.
  const task1LineGraph = await item(waTask1.id, 100, 'Task 1 — Line Graph Practice Prompt', 'WRITING_TASK', {}, { minutes: 20, module: 'WRITING', track: 'ACADEMIC', skillKey: 'writing.academic.task1.line_graphs', activityKind: 'PROMPT', isTimed: true });

  const waLabs = await section('Writing Criterion Labs (Academic)', 'Dedicated practice for each of the four marking criteria.', writingAcademic.id, { kind: 'AREA', module: 'WRITING', track: 'ACADEMIC', area: 'CRITERION_LABS' });
  await units(waLabs.id, [
    ['Task Achievement / Task Response', 'writing.academic.criterion.task_response', 'Task Achievement (Task 1) and Task Response (Task 2) ask whether you actually did what the task required — covered the key features, answered every part of the prompt, reached a clear position. Fluent writing that misses the task still scores poorly here.'],
    ['Coherence and Cohesion', 'writing.academic.criterion.coherence', 'This criterion asks whether your ideas are logically organised into paragraphs and connected clearly — through linking words, but also through pronoun reference and logical sequencing, not linking words alone.'],
    ['Lexical Resource', 'writing.academic.criterion.lexical', 'This criterion rewards a range of vocabulary used accurately and naturally, including less common words and collocations, with only occasional errors that do not affect communication.'],
    ['Grammatical Range and Accuracy', 'writing.academic.criterion.grammar', 'This criterion rewards a mix of simple and complex sentence structures used with good control, where errors (if any) rarely impede understanding.'],
  ], { module: 'WRITING', track: 'ACADEMIC', activityKind: 'GUIDED_EXERCISE' });

  // ── General Training Writing ──
  const writingGeneral = await section('General Training Writing', 'Task 1 (a letter) and Task 2 (an essay), in the General Training format.', writing.id, { kind: 'AREA', module: 'WRITING', track: 'GENERAL', area: 'GENERAL_TRAINING' });
  const wgFoundations = await section('General Training Writing Foundations', undefined, writingGeneral.id, { kind: 'AREA', module: 'WRITING', track: 'GENERAL', area: 'GT_FOUNDATIONS' });
  await units(wgFoundations.id, [
    ['Understanding the General Training Writing Test', 'writing.general.foundations.test_overview', 'General Training Task 1 is a letter (150+ words, ~20 minutes); Task 2 is an essay (250+ words, ~40 minutes), marked on the same four criteria as Academic — Task Achievement, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy.'],
    ['Planning and Time Management', 'writing.general.foundations.planning', 'Identify every bullet point the letter task asks you to cover before you start writing — missing one caps Task Achievement regardless of how well the rest is written.'],
    ['Task Achievement, Coherence and Lexical/Grammatical Range', 'writing.general.foundations.criteria_combined', 'The same writing quality standards apply as Academic Writing — organisation, vocabulary range and grammatical accuracy — but Task Achievement for a letter means covering every bullet point in an appropriate register.'],
    ['Editing and Proofreading', 'writing.general.foundations.editing', 'As with Academic Writing, leave time to check your letter answers every bullet point and that the register (formal, semi-formal or informal) stays consistent throughout.'],
  ], { module: 'WRITING', track: 'GENERAL' });

  const wgTask1 = await section('General Training Task 1: Letters', undefined, writingGeneral.id, { kind: 'AREA', module: 'WRITING', track: 'GENERAL', area: 'GT_TASK1_LETTERS', skillKey: 'writing.general.task1' });
  await units(wgTask1.id, [
    ['Understanding Letter Prompts and Register', 'writing.general.task1.understanding_register', 'Every GT Task 1 prompt names a relationship (a friend, a landlord, a company) that tells you the register to use: informal for friends and family, semi-formal or formal for anyone else.'],
    ['Formal Letters', 'writing.general.task1.formal', 'Formal letters (to a company, an official, someone you do not know) use "Dear Sir/Madam" or a surname, no contractions, and a clear professional closing ("Yours faithfully").'],
    ['Semi-Formal Letters', 'writing.general.task1.semi_formal', 'Semi-formal letters (to a landlord, a colleague) sit between the two — polite but can use a first name if one is given, and a warmer but still professional tone.'],
    ['Informal Letters', 'writing.general.task1.informal', 'Informal letters (to friends or family) can use contractions, casual expressions and a warm, personal tone — "Dear Sam" and "Lots of love" rather than formal openings and closings.'],
    ['Requests and Complaints', 'writing.general.task1.requests_complaints', 'A request letter clearly states what you want and why; a complaint letter states the problem, its impact, and what resolution you expect — vague complaints without a stated outcome lose marks.'],
    ['Apologies and Explanations', 'writing.general.task1.apologies_explanations', 'An apology letter should acknowledge the issue directly, explain briefly, and offer a next step — over-explaining at the expense of the apology itself reads as evasive.'],
    ['Invitations, Advice and Suggestions', 'writing.general.task1.invitations_advice', 'Invitation letters need the essential details (what, when, where); advice letters should give specific, actionable suggestions rather than generic reassurance.'],
    ['Applications and Other Letter Purposes', 'writing.general.task1.applications', 'Application-style letters (for a course, a position, membership) should state your purpose early and address every requirement named in the prompt.'],
    ['Openings, Closings and Addressing Every Bullet Point', 'writing.general.task1.structure', 'Match your opening and closing to the register, and work through the prompt\'s bullet points in order so none are accidentally skipped.'],
    ['Timed Letter Writing', 'writing.general.task1.timed_practice', 'Practise a complete letter — all bullet points, correct register, 150+ words — within 20 minutes regularly, since register decisions take longer under pressure than in untimed practice.'],
  ], { module: 'WRITING', track: 'GENERAL' });
  const gtLetterPrompt = await item(wgTask1.id, 100, 'GT Task 1 — Formal Letter Practice Prompt', 'WRITING_TASK', {}, { minutes: 20, module: 'WRITING', track: 'GENERAL', skillKey: 'writing.general.task1.formal', activityKind: 'PROMPT', isTimed: true });

  const wgTask2 = await section('General Training Task 2', undefined, writingGeneral.id, { kind: 'AREA', module: 'WRITING', track: 'GENERAL', area: 'GT_TASK2', skillKey: 'writing.general.task2' });
  await units(wgTask2.id, [
    ['Opinion Essays', 'writing.general.task2.opinion', 'The same opinion-essay structure as Academic Task 2: a clear position in the introduction, held consistently, with supporting paragraphs.'],
    ['Discussion Essays', 'writing.general.task2.discussion', 'Discuss-both-views prompts in General Training follow the same balanced-treatment approach as Academic Writing.'],
    ['Advantages and Disadvantages Essays', 'writing.general.task2.advantages_disadvantages', 'As with Academic Writing, check whether the prompt asks for a simple discussion or an "outweigh" judgement.'],
    ['Problems and Solutions Essays', 'writing.general.task2.problems_solutions', 'General Training problem/solution prompts are often about everyday or community issues rather than academic ones, but the same real-solution requirement applies.'],
    ['Causes and Effects Essays', 'writing.general.task2.causes_effects', 'Keep causes and effects clearly separated, with examples relevant to everyday life rather than academic research.'],
    ['Direct and Two-Part Questions', 'writing.general.task2.direct_two_part', 'Two-part prompts need both parts answered with roughly equal attention, exactly as in Academic Writing.'],
  ], { module: 'WRITING', track: 'GENERAL' });

  // ═════════════════════════════ SPEAKING (shared: Academic and General Training) ═════════════════════════════
  const speaking = await section('Speaking', 'Parts 1, 2 and 3.', undefined, { kind: 'MODULE', module: 'SPEAKING' });
  await item(speaking.id, 0, 'Speaking Part 2 tips', 'TEXT', { body: 'Use the one minute to note key points. Speak for the full two minutes, use linking words and add a personal example.' }, { minutes: 10, module: 'SPEAKING', skillKey: 'speaking.part2.tips' });
  const talk = await item(speaking.id, 1, 'Speaking Part 2 recording', 'SPEAKING_TASK', {}, { minutes: 15, module: 'SPEAKING', skillKey: 'speaking.part2.describe_place', activityKind: 'PROMPT', isTimed: true });

  const speakingFoundations = await section('Speaking Foundations', 'Test structure, assessment criteria, and the habits that raise every part of the test.', speaking.id, { kind: 'AREA', module: 'SPEAKING', area: 'FOUNDATIONS' });
  await units(speakingFoundations.id, [
    ['Test Structure and Assessment Criteria', 'speaking.foundations.structure_criteria', 'The Speaking test has three parts (introduction and familiar questions, a 2-minute long turn from a cue card, then a discussion) and is marked live on Fluency and Coherence, Lexical Resource, Grammatical Range and Accuracy, and Pronunciation.'],
    ['Fluency and Coherence', 'speaking.foundations.fluency_coherence', 'Fluency means speaking at a natural pace without excessive hesitation; coherence means your answer is organised and easy to follow, not necessarily longer.'],
    ['Vocabulary, Paraphrasing and Avoiding Memorised Answers', 'speaking.foundations.vocab_paraphrase', 'Examiners are trained to recognise memorised, scripted answers and will ask a follow-up question that a memorised answer cannot handle. Practising real, spontaneous responses — and paraphrasing the question back into your own words — is worth more than rehearsing "model" answers.'],
    ['Grammar, Pronunciation and Natural Self-Correction', 'speaking.foundations.grammar_pronunciation', 'A natural self-correction ("I go— I went there last year") is not penalised and can show good control. Pronunciation is marked on clarity and natural intonation, not on sounding like a particular accent.'],
    ['Thinking While Speaking', 'speaking.foundations.thinking_aloud', 'Short filler phrases ("let me think", "that\'s an interesting question") buy you a second to organise your answer without an awkward silence — used occasionally, not as a crutch.'],
    ['Expressing and Supporting Opinions', 'speaking.foundations.opinions', 'A strong spoken answer states an opinion and then supports it with a reason or example, the same structure as a written argument but shorter and more conversational.'],
  ], { module: 'SPEAKING' });

  const speakingPart1 = await section('Part 1', 'Familiar topics and everyday questions.', speaking.id, { kind: 'AREA', module: 'SPEAKING', area: 'PART1' });
  await units(speakingPart1.id, [
    ['Familiar Topics and Preferences', 'speaking.part1.familiar_preferences', 'Part 1 asks about everyday topics — home, work, study, hobbies. Give a direct answer, then one supporting detail or reason, rather than a one-word response.'],
    ['Past, Present and Future Questions', 'speaking.part1.tenses', 'Questions often ask you to compare now with the past, or state a future plan. Practise moving smoothly between tenses within one answer.'],
    ['Habits and Routines', 'speaking.part1.habits_routines', 'Habit and routine questions ("how often do you...") invite frequency language and a brief reason, not just a frequency word on its own.'],
    ['Descriptions and Developing Short Answers', 'speaking.part1.descriptions', 'When asked to describe something, add one sensory or specific detail (what it looks or feels like) to turn a short answer into a fuller one without over-explaining.'],
    ['Topic-Based Question Banks', 'speaking.part1.question_banks', 'Practising across a bank of Part 1 topics (home, food, weather, free time, technology) builds the flexibility to handle whichever topic actually comes up.'],
  ], { module: 'SPEAKING' });

  const speakingPart2 = await section('Part 2', 'The cue card: one minute to prepare, two minutes to speak.', speaking.id, { kind: 'AREA', module: 'SPEAKING', area: 'PART2' });
  await units(speakingPart2.id, [
    ['Understanding Cue Cards and the Preparation Timer', 'speaking.part2.cue_cards', 'A cue card gives a topic and three or four bullet points to cover. Use the 60-second preparation time to jot one or two words per bullet point — not full sentences, which waste the time you have.'],
    ['People', 'speaking.part2.people', 'Cue cards about a person (someone you admire, a friend) reward specific detail — a particular incident or quality — over a generic description.'],
    ['Places', 'speaking.part2.places', 'Place cue cards (somewhere you visited, your hometown) benefit from sensory detail and a clear structure: what it is, when you went, what you did there, why it matters to you.'],
    ['Events and Experiences', 'speaking.part2.events_experiences', 'Event and experience cue cards are naturally sequential — describe what happened in order, then reflect on why it was memorable.'],
    ['Objects and Activities', 'speaking.part2.objects_activities', 'Object cue cards (something you own, a gift) and activity cue cards (a hobby, a skill) both benefit from explaining not just what the thing is, but why you value doing or having it.'],
    ['Decisions and Future Plans', 'speaking.part2.decisions_plans', 'Decision and future-plan cue cards need a clear structure: what the decision/plan is, the reasoning behind it, and (for decisions) how it turned out.'],
    ['Note-Making and Structuring the Two-Minute Talk', 'speaking.part2.note_making', 'A simple four-point structure — introduce the topic, cover each bullet point, add a closing reflection — fills two minutes naturally without running out of things to say halfway through.'],
  ], { module: 'SPEAKING' });

  const speakingPart3 = await section('Part 3', 'An abstract discussion that extends the Part 2 topic.', speaking.id, { kind: 'AREA', module: 'SPEAKING', area: 'PART3' });
  await units(speakingPart3.id, [
    ['Explaining Reasons and Comparing', 'speaking.part3.reasons_comparing', 'Part 3 often asks "why" questions and comparisons between past and present, or between your country and others. A reason plus an example makes a fuller answer than a bare opinion.'],
    ['Causes, Effects, Advantages and Disadvantages', 'speaking.part3.causes_effects_adv_disadv', 'Discussing causes/effects or advantages/disadvantages of a broader trend (named in the Part 2 topic) requires moving from the personal (Part 2) to the general and abstract.'],
    ['Solutions and Predictions', 'speaking.part3.solutions_predictions', 'When asked what should be done about an issue, or what will happen in future, qualify your answer realistically ("it probably depends on...") rather than overclaiming certainty.'],
    ['Abstract Discussions and Evaluating Ideas', 'speaking.part3.abstract_evaluating', 'Part 3 questions can be genuinely abstract (e.g. about societal values). Evaluate an idea by weighing it, not just describing it — "on one hand... but on the other..."'],
    ['Qualifying Opinions', 'speaking.part3.qualifying_opinions', 'Native-like qualification ("to some extent", "in most cases, though not all") shows range and avoids overgeneralising — a common weakness in Part 3 answers.'],
    ['Extending and Supporting Arguments', 'speaking.part3.extending_arguments', 'A strong Part 3 answer develops across two or three sentences — opinion, reason, example or counterpoint — rather than stopping after the first sentence.'],
  ], { module: 'SPEAKING' });

  const speakingLabs = await section('Speaking Criterion Labs', 'Dedicated practice and feedback for each of the four marking criteria.', speaking.id, { kind: 'AREA', module: 'SPEAKING', area: 'CRITERION_LABS' });
  await units(speakingLabs.id, [
    ['Fluency and Coherence', 'speaking.criterion.fluency_coherence', 'This criterion rewards speech at a natural pace with logical organisation and appropriate use of linking words — not speed for its own sake.'],
    ['Lexical Resource', 'speaking.criterion.lexical', 'This criterion rewards a flexible, idiomatic vocabulary used naturally, including less common words and paraphrasing when the right word does not come to mind.'],
    ['Grammatical Range and Accuracy', 'speaking.criterion.grammar', 'This criterion rewards a mix of simple and complex structures used with good control, with self-corrected slips not counted against you.'],
    ['Pronunciation', 'speaking.criterion.pronunciation', 'This criterion rewards clear, easily understood speech with natural stress, rhythm and intonation — not a particular accent.'],
  ], { module: 'SPEAKING', activityKind: 'GUIDED_EXERCISE' });

  const mocks = await section('Daily Mock Tests', 'Take a new mock every day. Built from past-paper styles and expected question patterns.', undefined, { kind: 'MODULE', module: 'GENERAL' });
  await item(mocks.id, 0, 'Daily Mock Test 1', 'MOCK_TEST', { assessmentId: ids.mock1 }, { minutes: 20, module: 'GENERAL', activityKind: 'TIMED_PRACTICE', isTimed: true });
  await item(mocks.id, 1, 'Daily Mock Test 2 — Past-paper style', 'MOCK_TEST', { assessmentId: ids.mock2 }, { minutes: 20, module: 'GENERAL', activityKind: 'TIMED_PRACTICE', isTimed: true });
  await item(mocks.id, 2, 'Daily Mock Test 3 — Expected questions', 'MOCK_TEST', { assessmentId: ids.mock3 }, { minutes: 20, module: 'GENERAL', activityKind: 'TIMED_PRACTICE', isTimed: true });

  const writingRubric = await prisma.rubric.findFirstOrThrow({ where: { name: 'IELTS Writing Task 2' } });
  const writingTask1Rubric = await prisma.rubric.findFirstOrThrow({ where: { name: 'IELTS Writing Task 1' } });
  const speakingRubric = await prisma.rubric.findFirstOrThrow({ where: { name: 'IELTS Speaking' } });
  await prisma.assignment.create({ data: { contentItemId: essay.id, skill: 'WRITING', rubricId: writingRubric.id, minWords: 250, instructions: 'Some people think universities should teach practical skills rather than academic subjects. To what extent do you agree or disagree? Write at least 250 words.' } });
  await prisma.assignment.create({ data: { contentItemId: talk.id, skill: 'SPEAKING', rubricId: speakingRubric.id, instructions: 'Describe a place you enjoy visiting. Say where it is, how often you go, what you do there, and explain why you like it. Speak for up to two minutes.' } });
  await prisma.assignment.create({ data: { contentItemId: task1LineGraph.id, skill: 'WRITING', rubricId: writingTask1Rubric.id, minWords: 150, instructions: 'The line graph below shows the number of overseas visitors to a particular country between 2000 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words.' } });
  await prisma.assignment.create({ data: { contentItemId: gtLetterPrompt.id, skill: 'WRITING', rubricId: writingTask1Rubric.id, minWords: 150, instructions: 'You recently moved into a new rented apartment and have found several problems with it. Write a letter to your landlord. In your letter: describe the problems, explain how this is affecting you, say what action you want the landlord to take. Write at least 150 words. Begin your letter "Dear ...".' } });
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

/**
 * Realistic but obviously fake demo data. NEVER runs in production.
 * Every account uses the password DemoPass123.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as argon2 from 'argon2';
import { prisma, seedReference } from './seed';

export const DEMO_PASSWORD = 'DemoPass123';
const STORAGE_ROOT = resolve(__dirname, '../../../.storage'); // repo root; the API reads the same folder in development
const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);
const daysAgo = (n: number, hour = 12) => { const d = new Date(Date.now() - n * DAY); d.setUTCHours(hour, 0, 0, 0); return d; };
const daysAhead = (n: number, hour = 14) => { const d = new Date(Date.now() + n * DAY); d.setUTCHours(hour, 0, 0, 0); return d; };

/** Small placeholder files so the admin queue and teacher screens have something to open. */
function writeStorage(key: string, data: Buffer) {
  const path = resolve(STORAGE_ROOT, key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

async function receiptPdf(lines: string[]): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 10, y: 10, width: 400, height: 280, borderColor: rgb(0.3, 0.3, 0.8), borderWidth: 2 });
  page.drawText('DEMO PAYMENT RECEIPT', { x: 30, y: 255, size: 16, font: bold, color: rgb(0.2, 0.2, 0.6) });
  lines.forEach((l, i) => page.drawText(l, { x: 30, y: 220 - i * 22, size: 12, font }));
  page.drawText('Fake receipt generated for demonstration only', { x: 30, y: 24, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  return Buffer.from(await doc.save());
}

/** 1 second of silence — a valid WAV, standing in for a student's speaking recording. */
function silentWav(): Buffer {
  const rate = 8000; const samples = rate; const data = Buffer.alloc(samples * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load demo data with NODE_ENV=production.');
  await seedReference();

  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const role = async (name: string) => (await prisma.role.findUniqueOrThrow({ where: { name } })).id;
  const [superAdmin, mentorRole, studentRole] = [await role('SUPER_ADMIN'), await role('MENTOR'), await role('STUDENT')];

  // ── staff ──
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' }, update: { passwordHash, status: 'ACTIVE' },
    create: { email: 'admin@example.com', passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(), phone: '0300-1111111' },
  });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: superAdmin } }, update: {}, create: { userId: admin.id, roleId: superAdmin } });

  const mkTeacher = async (email: string, displayName: string, bio: string, specializations: string[]) => {
    const u = await prisma.user.create({
      data: { email, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(), roles: { create: { roleId: mentorRole } }, mentor: { create: { displayName, bio, specializations } } },
      include: { mentor: true },
    });
    return u.mentor!;
  };
  const ahmed = await mkTeacher('ahmed.khan@example.com', 'Ahmed Khan', 'IELTS trainer with 8 years of classroom experience. Band 8.5 overall.', ['Listening', 'Reading', 'Speaking']);
  const sara = await mkTeacher('sara.ahmed@example.com', 'Sara Ahmed', 'Writing specialist and former IELTS examiner trainer.', ['Writing', 'Speaking']);

  // ── the one course ──
  const course = await prisma.course.findFirstOrThrow({ where: { deletedAt: null, status: { not: 'ARCHIVED' } } });
  const version = await prisma.courseVersion.findFirstOrThrow({ where: { courseId: course.id, status: 'PUBLISHED' }, orderBy: { versionNumber: 'desc' } });
  const items = await prisma.contentItem.findMany({ where: { section: { courseVersionId: version.id } }, orderBy: [{ section: { sequence: 'asc' } }, { sequence: 'asc' }] });
  const itemByTitle = (t: string) => items.find((i) => i.title.startsWith(t))!;

  // ── batches (no capacity; two have no teacher yet) ──
  const mkBatch = (name: string, startAt: Date, status: 'OPEN' | 'IN_PROGRESS', days: string[], classTime: string, description: string) =>
    prisma.batch.create({ data: { courseId: course.id, courseVersionId: version.id, name, startAt, endAt: new Date(startAt.getTime() + 84 * DAY), days, classTime, description, status, deliveryMode: 'ONLINE', timezone: 'Asia/Karachi' } });
  const sept = await mkBatch('IELTS September 2026', at('2026-09-07T14:00:00Z'), 'IN_PROGRESS', ['MON', 'TUE', 'WED', 'THU', 'FRI'], '19:00', 'Evening batch, already running. Late joiners can still enroll.');
  const oct = await mkBatch('IELTS October 2026', at('2026-10-05T14:00:00Z'), 'OPEN', ['MON', 'TUE', 'WED', 'THU', 'FRI'], '19:00', 'Weekday evenings. A teacher will be announced before the batch starts.');
  const nov = await mkBatch('IELTS November 2026', at('2026-11-02T13:00:00Z'), 'OPEN', ['MON', 'WED', 'FRI'], '18:00', 'Three evenings a week with weekend mock tests.');
  const dec = await mkBatch('IELTS December 2026', at('2026-12-07T06:00:00Z'), 'OPEN', ['SAT', 'SUN'], '11:00', 'Weekend batch for working professionals.');
  await prisma.batchMentor.createMany({ data: [
    { batchId: sept.id, mentorId: ahmed.id, mentorRole: 'MAIN' }, { batchId: sept.id, mentorId: sara.id, mentorRole: 'WRITING' },
    { batchId: nov.id, mentorId: sara.id, mentorRole: 'MAIN' },
  ] }); // October and December deliberately have no teacher yet

  // ── students ──
  const mkStudent = async (n: number, firstName: string, lastName: string, city: string, current: number | null, target: number, test: 'ACADEMIC' | 'GENERAL') => {
    const u = await prisma.user.create({
      data: {
        email: `student${n}@example.com`, passwordHash, status: 'ACTIVE', emailVerifiedAt: n === 6 ? null : daysAgo(20), phone: `030${n}-55500${n}0`,
        roles: { create: { roleId: studentRole } },
        student: { create: { firstName, lastName, city, country: 'Pakistan', currentBand: current, targetBand: target, academicOrGeneral: test, ieltsExamDate: daysAhead(60 + n * 7) } },
      },
      include: { student: true },
    });
    return { user: u, id: u.student!.id, name: `${firstName} ${lastName}` };
  };
  const s1 = await mkStudent(1, 'Ayesha', 'Malik', 'Lahore', 5.5, 7, 'ACADEMIC');
  const s2 = await mkStudent(2, 'Bilal', 'Hussain', 'Karachi', 5, 6.5, 'GENERAL');
  const s3 = await mkStudent(3, 'Hira', 'Zahid', 'Islamabad', 6, 7.5, 'ACADEMIC');
  const s4 = await mkStudent(4, 'Usman', 'Tariq', 'Faisalabad', 5, 6.5, 'ACADEMIC');
  const s5 = await mkStudent(5, 'Fatima', 'Noor', 'Multan', 4.5, 6, 'GENERAL');
  const s6 = await mkStudent(6, 'Zain', 'Abbas', 'Rawalpindi', 5.5, 7, 'ACADEMIC');
  const s7 = await mkStudent(7, 'Mariam', 'Sheikh', 'Peshawar', 5, 6.5, 'GENERAL');
  await mkStudent(8, 'Hamza', 'Raza', 'Lahore', null, 7, 'ACADEMIC'); // registered, has not applied

  // ── applications in every state ──
  const price = course.price;
  let refCounter = 1000;
  async function application(o: {
    s: { id: string; name: string }; batch: { id: string; startAt: Date }; state: 'PENDING' | 'ENROLLED' | 'REJECTED'; method: 'BANK_TRANSFER' | 'JAZZCASH' | 'EASYPAISA';
    ref: string; claimed?: number; submittedDaysAgo: number; flags?: string[]; rejection?: string;
  }) {
    const submitted = daysAgo(o.submittedDaysAgo);
    const order = await prisma.order.create({
      data: { reference: `IEL-DEMO${++refCounter}`, studentId: o.s.id, subtotal: price, total: price, currency: 'PKR', createdAt: submitted, status: o.state === 'ENROLLED' ? 'PAID' : o.state === 'REJECTED' ? 'CANCELLED' : 'PENDING_REVIEW' },
    });
    const item = await prisma.orderItem.create({ data: { orderId: order.id, courseId: course.id, batchId: o.batch.id, originalPrice: price, finalPrice: price } });
    const payment = await prisma.payment.create({
      data: { orderId: order.id, provider: 'BANK_TRANSFER', reference: order.reference, amount: price, currency: 'PKR', createdAt: submitted, status: o.state === 'ENROLLED' ? 'PAID' : o.state === 'REJECTED' ? 'FAILED' : 'PENDING', paidAt: o.state === 'ENROLLED' ? submitted : null, verifiedBy: o.state === 'ENROLLED' ? admin.id : null, verifiedAt: o.state === 'ENROLLED' ? submitted : null },
    });
    const fileKey = `proofs/applications/${randomUUID()}.pdf`;
    const claimed = o.claimed ?? Number(price);
    writeStorage(fileKey, await receiptPdf([`Payer: ${o.s.name}`, `Method: ${o.method.replace('_', ' ')}`, `Reference: ${o.ref}`, `Amount: PKR ${claimed.toLocaleString('en-US')}`, `Date: ${submitted.toISOString().slice(0, 10)}`]));
    await prisma.paymentProof.create({
      data: {
        paymentId: payment.id, paymentMethod: o.method, senderName: o.s.name, bankTxnReference: o.ref, claimedAmount: claimed, transferDate: submitted, fileKey, fileMime: 'application/pdf',
        flags: o.flags ?? [], createdAt: submitted, status: o.state === 'ENROLLED' ? 'APPROVED' : o.state === 'REJECTED' ? 'REJECTED' : 'SUBMITTED',
        rejectionReason: o.rejection, allowResubmit: false, reviewedBy: o.state === 'PENDING' ? null : admin.id, reviewedAt: o.state === 'PENDING' ? null : daysAgo(o.submittedDaysAgo - 1),
      },
    });
    const enrolledAt = o.state === 'ENROLLED' ? daysAgo(Math.max(0, o.submittedDaysAgo - 1)) : null;
    const enrollment = await prisma.enrollment.create({
      data: {
        studentId: o.s.id, courseId: course.id, courseVersionId: version.id, batchId: o.batch.id, orderItemId: item.id, source: 'ONLINE_PURCHASE', createdAt: submitted,
        status: o.state === 'ENROLLED' ? 'ACTIVE' : o.state === 'REJECTED' ? 'REJECTED' : 'PENDING_PAYMENT',
        enrolledAt, accessStartsAt: enrolledAt, accessEndsAt: enrolledAt ? new Date(Math.max(o.batch.startAt.getTime(), enrolledAt.getTime()) + course.defaultAccessDays * DAY) : null,
      },
    });
    await prisma.studentTimelineEvent.create({ data: { studentId: o.s.id, type: 'APPLICATION_SUBMITTED', summary: 'Applied — payment awaiting verification', createdAt: submitted } });
    if (o.state === 'ENROLLED') await prisma.studentTimelineEvent.create({ data: { studentId: o.s.id, type: 'ENROLLED', summary: 'Payment verified — enrolled', createdAt: enrolledAt! } });
    return enrollment;
  }

  const e1 = await application({ s: s1, batch: sept, state: 'ENROLLED', method: 'BANK_TRANSFER', ref: 'BNK20260905A1', submittedDaysAgo: 24 });
  const e2 = await application({ s: s2, batch: sept, state: 'ENROLLED', method: 'JAZZCASH', ref: 'JC7788221', submittedDaysAgo: 23 });
  const e3 = await application({ s: s3, batch: sept, state: 'ENROLLED', method: 'EASYPAISA', ref: 'EP5566110', submittedDaysAgo: 22 });
  await application({ s: s4, batch: oct, state: 'PENDING', method: 'BANK_TRANSFER', ref: 'BNK20260928B7', submittedDaysAgo: 2 });
  await application({ s: s5, batch: nov, state: 'PENDING', method: 'JAZZCASH', ref: 'JC9900313', claimed: 40000, flags: ['AMOUNT_MISMATCH'], submittedDaysAgo: 1 });
  await application({ s: s6, batch: oct, state: 'PENDING', method: 'EASYPAISA', ref: 'EP1234098', submittedDaysAgo: 0 });
  await application({ s: s7, batch: oct, state: 'REJECTED', method: 'BANK_TRANSFER', ref: 'BNK20260920C2', submittedDaysAgo: 9, rejection: 'The receipt was unreadable and the amount could not be confirmed.' });

  // ── learning activity for enrolled students ──
  const requiredCount = items.filter((i) => i.isRequired).length;
  const setProgress = async (enrollmentId: string, studentId: string, titles: string[]) => {
    for (const t of titles) {
      const it = itemByTitle(t);
      await prisma.contentProgress.create({ data: { enrollmentId, studentId, contentItemId: it.id, status: 'COMPLETED', progressPercent: 100, startedAt: daysAgo(15), completedAt: daysAgo(14), timeSpentSeconds: 600 } });
    }
    await prisma.enrollment.update({ where: { id: enrollmentId }, data: { progressPercent: Math.round((titles.length / requiredCount) * 10_000) / 100 } });
  };
  await setProgress(e1.id, s1.id, ['Welcome', 'How the course', 'Listening strategies', 'Listening Practice', 'Reading strategies', 'Reading Practice', 'Task 2 essay structure', 'Task 2 practice essay']);
  await setProgress(e2.id, s2.id, ['Welcome', 'How the course', 'Listening strategies', 'Task 2 essay structure', 'Task 2 practice essay']);
  await setProgress(e3.id, s3.id, ['Welcome', 'How the course', 'Speaking Part 2 tips', 'Speaking Part 2 recording']);

  // Realistic attempts: real answers, graded like the live engine would.
  const bandRows = async (testType: string) => prisma.bandConversionTable.findMany({ where: { testType }, orderBy: { version: 'desc' } });
  async function attempt(studentId: string, enrollmentId: string, assessmentTitle: string, correct: number, when: Date) {
    const a = await prisma.assessment.findFirstOrThrow({ where: { title: { startsWith: assessmentTitle } } });
    const v = await prisma.assessmentVersion.findFirstOrThrow({ where: { assessmentId: a.id } });
    const questions = (await prisma.assessmentSection.findMany({ where: { assessmentVersionId: v.id }, orderBy: { sequence: 'asc' }, include: { questions: { orderBy: { sequence: 'asc' }, include: { versions: { include: { options: true } } } } } })).flatMap((s) => s.questions);
    const n = (await prisma.assessmentAttempt.count({ where: { assessmentId: a.id, studentId } })) + 1;
    const att = await prisma.assessmentAttempt.create({ data: { assessmentId: a.id, assessmentVersionId: v.id, studentId, enrollmentId, attemptNumber: n, status: 'IN_PROGRESS', startedAt: when } });
    let raw = 0;
    for (const [i, q] of questions.entries()) {
      const qv = q.versions[0];
      const right = i < correct;
      const key = qv.answerKey as { value?: string; accepted?: string[] } | null;
      let answer: object;
      if (q.questionType === 'TFNG' || q.questionType === 'YNNG') answer = { value: right ? key!.value : key!.value === 'NOT_GIVEN' ? (q.questionType === 'TFNG' ? 'TRUE' : 'YES') : 'NOT_GIVEN' };
      else if (q.questionType === 'COMPLETION') answer = { text: right ? key!.accepted![0] : 'not sure' };
      else answer = { optionIds: (right ? qv.options.filter((o) => o.isCorrect) : qv.options.filter((o) => !o.isCorrect).slice(0, 1)).map((o) => o.id) };
      if (right) raw++;
      await prisma.attemptAnswer.create({ data: { attemptId: att.id, questionVersionId: qv.id, answer: answer as never, isCorrect: right } });
    }
    let band: number | null = null;
    if (a.skill) {
      const rows = await bandRows(a.skill === 'LISTENING' ? 'LISTENING' : 'READING_ACADEMIC');
      const latest = rows.filter((r) => r.version === rows[0]?.version);
      const scaled = Math.round((raw / questions.length) * 40);
      band = Number(latest.find((r) => scaled >= r.rawMin && scaled <= r.rawMax)?.band ?? null) || null;
    }
    await prisma.assessmentAttempt.update({
      where: { id: att.id }, data: { status: 'AUTO_GRADED', submittedAt: new Date(when.getTime() + 25 * 60_000), rawScore: raw, maxScore: questions.length, percent: Math.round((raw / questions.length) * 10_000) / 100, bandScore: band },
    });
  }
  await attempt(s1.id, e1.id, 'Listening Practice Test 1', 5, daysAgo(12));
  await attempt(s1.id, e1.id, 'Reading Practice Test 1', 6, daysAgo(10));
  await attempt(s1.id, e1.id, 'Daily Mock Test 1', 3, daysAgo(4));
  await attempt(s2.id, e2.id, 'Daily Mock Test 1', 2, daysAgo(5));
  await attempt(s3.id, e3.id, 'Daily Mock Test 1', 4, daysAgo(3));
  await attempt(s1.id, e1.id, 'Diagnostic Test', 3, daysAgo(24));

  // Writing: one graded, one waiting. Speaking: one waiting.
  const essay = await prisma.assignment.findFirstOrThrow({ where: { contentItemId: itemByTitle('Task 2 practice essay').id }, include: { rubric: { include: { criteria: { orderBy: { sequence: 'asc' } } } } } });
  const talk = await prisma.assignment.findFirstOrThrow({ where: { contentItemId: itemByTitle('Speaking Part 2 recording').id } });
  const essayText = (opening: string) => `${opening} In my opinion, universities should balance academic study with practical training. Firstly, graduates who can apply what they learned are more employable. For example, engineering students who complete internships often find jobs faster. Secondly, academic subjects build critical thinking, which practical courses alone cannot provide. However, if a university focuses only on theory, students may struggle in the workplace. Therefore, a mixed curriculum is the most sensible approach. In conclusion, I agree only partly with the statement, because both kinds of learning are valuable and should be offered together.`;
  const graded = await prisma.submission.create({
    data: { assignmentId: essay.id, studentId: s1.id, enrollmentId: e1.id, body: essayText('Some people believe practical skills matter more than academic subjects.'), wordCount: 118, status: 'GRADED', revision: 2, submittedAt: daysAgo(8), gradedAt: daysAgo(7), finalBand: 6.5 },
  });
  const feedback = await prisma.submissionFeedback.create({ data: { submissionId: graded.id, mentorId: sara.userId, comment: 'Clear position and good examples. Extend your body paragraphs and vary your linking words. Watch article use ("the graduates").', finalBand: 6.5, createdAt: daysAgo(7) } });
  const scores = [6.5, 6.5, 6, 7];
  await prisma.rubricScore.createMany({ data: essay.rubric!.criteria.map((c, i) => ({ submissionId: graded.id, feedbackId: feedback.id, criterionId: c.id, score: scores[i], gradedBy: sara.userId, comment: i === 2 ? 'Good range but repeats "important".' : null })) });
  await prisma.submission.create({ data: { assignmentId: essay.id, studentId: s2.id, enrollmentId: e2.id, body: essayText('Nowadays many people discuss what universities should teach.'), wordCount: 112, status: 'SUBMITTED', submittedAt: daysAgo(1) } });
  const audioKey = `submissions/${s3.id}/${talk.id}/${randomUUID()}.wav`;
  writeStorage(audioKey, silentWav());
  await prisma.submission.create({ data: { assignmentId: talk.id, studentId: s3.id, enrollmentId: e3.id, fileKey: audioKey, fileMime: 'audio/wav', status: 'SUBMITTED', submittedAt: daysAgo(0, 8) } });

  // Live classes and attendance for the running batch.
  const session = (topic: string, when: Date, provider = 'ZOOM') => prisma.liveSession.create({ data: { batchId: sept.id, mentorId: ahmed.id, topic, startsAt: when, endsAt: new Date(when.getTime() + 90 * 60_000), provider, meetingUrl: 'https://meet.example.com/ielts-demo' } });
  const past = [await session('Listening: note completion', daysAgo(6, 14)), await session('Reading: True / False / Not Given', daysAgo(5, 14)), await session('Writing Task 2: essay structure', daysAgo(3, 14))];
  await session('Speaking Part 2 practice', daysAhead(1, 14));
  await session('Full mock test review', daysAhead(3, 14));
  const marks: [string, string, string][] = [[past[0].id, s1.id, 'PRESENT'], [past[0].id, s2.id, 'PRESENT'], [past[0].id, s3.id, 'LATE'], [past[1].id, s1.id, 'PRESENT'], [past[1].id, s2.id, 'ABSENT'], [past[1].id, s3.id, 'PRESENT'], [past[2].id, s1.id, 'PRESENT'], [past[2].id, s2.id, 'EXCUSED'], [past[2].id, s3.id, 'PRESENT']];
  await prisma.attendance.createMany({ data: marks.map(([sessionId, studentId, status]) => ({ sessionId, studentId, status: status as never, markedBy: ahmed.userId })) });

  // ── 30-session attendance scenario for risk and attendance analytics ────────────
  // s1 attends almost everything (healthy), s2 mostly misses (at risk), s3 misses about a quarter of sessions (needs attention).
  // Sessions are spaced two days apart, so the pattern covers roughly the last two months.
  const scenarioRows: { sessionId: string; studentId: string; status: string; markedBy: string }[] = [];
  const scenarioSessions: { id: string; startsAt: Date }[] = [];
  for (let i = 0; i < 30; i++) {
    const when = daysAgo(3 + i * 2, 14);
    const ended = await prisma.liveSession.create({ data: { batchId: sept.id, mentorId: ahmed.id, topic: `Class ${i + 1}`, startsAt: when, endsAt: new Date(when.getTime() + 90 * 60_000), provider: 'ZOOM' } });
    scenarioSessions.push({ id: ended.id, startsAt: when });
    scenarioRows.push({ sessionId: ended.id, studentId: s1.id, status: i % 7 === 6 ? 'EXCUSED' : 'PRESENT', markedBy: ahmed.userId });
    scenarioRows.push({ sessionId: ended.id, studentId: s2.id, status: i % 3 === 0 ? 'PRESENT' : 'ABSENT', markedBy: ahmed.userId });
    scenarioRows.push({ sessionId: ended.id, studentId: s3.id, status: i % 4 === 0 ? 'ABSENT' : 'PRESENT', markedBy: ahmed.userId });
  }
  await prisma.attendance.createMany({ data: scenarioRows as never, skipDuplicates: true });

  // ── A full batch of 25 for the running class, plus one late joiner ───────────────
  // Twenty-one students with four attendance habits, and one student who joined ten days ago. The
  // late joiner has no marks for classes that ran before they joined, which is how the engine should see them.
  const extraRows: { sessionId: string; studentId: string; status: string; markedBy: string }[] = [];
  for (let n = 9; n <= 30; n++) {
    const late = n === 30;
    const joined = daysAgo(late ? 10 : 40);
    const u = await prisma.user.create({
      data: {
        email: `student${n}@example.com`, passwordHash, status: 'ACTIVE', emailVerifiedAt: daysAgo(20),
        roles: { create: { roleId: studentRole } },
        student: { create: { firstName: 'Demo', lastName: `Student ${n}`, city: 'Lahore', country: 'Pakistan', targetBand: 6.5, academicOrGeneral: 'ACADEMIC', ieltsExamDate: daysAhead(60 + n) } },
      },
      include: { student: true },
    });
    const studentId = u.student!.id;
    await prisma.enrollment.create({
      data: {
        studentId, courseId: course.id, courseVersionId: version.id, batchId: sept.id, source: 'ONLINE_PURCHASE', status: 'ACTIVE',
        createdAt: joined, enrolledAt: joined, accessStartsAt: joined, accessEndsAt: new Date(joined.getTime() + course.defaultAccessDays * DAY),
      },
    });
    const habit = n % 4;
    scenarioSessions.forEach((session, i) => {
      if (session.startsAt < joined) return; // not enrolled yet: no mark
      const status = habit === 0 ? 'PRESENT'
        : habit === 1 ? (i % 5 === 0 ? 'ABSENT' : 'PRESENT')
        : habit === 2 ? (i % 2 === 0 ? 'ABSENT' : 'PRESENT')
        : (i % 4 === 0 ? 'LATE' : 'PRESENT');
      extraRows.push({ sessionId: session.id, studentId, status, markedBy: ahmed.userId });
    });
  }
  await prisma.attendance.createMany({ data: extraRows as never, skipDuplicates: true });

  // ── Lifecycle history and feedback for the running class ───────────────────────
  // Students 9 to 29 went through enrolment and activation; student 30 (the late joiner) is still enrolled.
  // Feedback comes from a fixed list of scores, so the NPS dashboard shows every category. Every feedback
  // row here follows the same anonymity rule the app uses: an anonymous response has no student or request link.
  const onboarding = await prisma.feedbackSurvey.findUniqueOrThrow({ where: { triggerKind: 'ONBOARDING' } });
  const demoScores = [10, 9, 9, 8, 7, 6, 4, 10, 9, 3, 8, 9, 10, 5, 9, 8, 7, 10, 6, 9, 9, 10, 4];
  const demoComments = [
    'The speaking practice helped a lot, and the teacher explains clearly.',
    'Speaking classes are useful. The schedule changed twice, which was confusing.',
    'Helpful teacher and clear feedback on my speaking.',
    'More speaking practice please. The recordings help when I miss a class.',
    null,
    'The platform works well on my phone.',
  ];
  const studentRows = await prisma.studentProfile.findMany({ where: { firstName: 'Demo', lastName: { startsWith: 'Student' } }, select: { id: true, lastName: true } });
  const ordered = studentRows.sort((a, b) => Number(a.lastName.replace(/\D/g, '')) - Number(b.lastName.replace(/\D/g, '')));
  for (const [i, st] of ordered.entries()) {
    const n = Number(st.lastName.replace(/\D/g, ''));
    const steps = n === 30 ? ['ENROLLED'] : ['ENROLLED', 'ACTIVE'];
    let from: string | null = null;
    for (const to of steps) {
      await prisma.studentLifecycleTransition.create({ data: { studentId: st.id, fromStage: from, toStage: to, reason: from === null ? 'Enrolment activated (demo)' : 'First class attended (demo)', source: 'SYSTEM' } });
      from = to;
    }
    await prisma.studentLifecycle.create({ data: { studentId: st.id, stage: steps[steps.length - 1] } });

    if (n === 30 || i >= demoScores.length) continue;
    const req = await prisma.feedbackRequest.create({
      data: { surveyId: onboarding.id, studentId: st.id, batchId: sept.id, triggerRef: st.id, status: 'COMPLETED', respondedAt: daysAgo(i % 9) },
    });
    const anonymous = i % 3 === 0;
    await prisma.feedbackResponse.create({
      data: {
        surveyId: onboarding.id, batchId: sept.id, triggerKind: 'ONBOARDING', anonymous, score: demoScores[i],
        studentId: anonymous ? null : st.id, requestId: anonymous ? null : req.id,
        commentOverall: demoComments[i % demoComments.length],
      },
    });
  }

  console.log('Demo data loaded.');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
export { main as seedDemo };

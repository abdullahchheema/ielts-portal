# IELTS Academy

A single-course IELTS academy platform. The academy sells one product, **Complete IELTS Preparation**, in scheduled batches (teacher-led daily classes, Listening / Reading / Writing / Speaking modules, daily mock tests, past-paper practice). Students apply for a batch, pay by bank transfer / JazzCash / Easypaisa and upload the receipt; an admin verifies it and the student is enrolled. There are three portals: **Student**, **Teacher** and **Admin**.

**Stack:** Next.js (App Router) · NestJS (modular monolith) · Prisma · PostgreSQL (Supabase) · TypeScript · npm workspaces + Turborepo.

```
apps/api        NestJS API (auth, courses, batches, commerce/applications, learning, assessments, grading, live, support, reports, admin)
apps/web        Next.js app: public site, /student, /teacher, /admin
packages/db     Prisma schema, migrations (incl. hand-written SQL), seed, demo seed, reset script
packages/types  Shared error codes
packages/validation  Zod schemas shared by API and web forms
packages/config Environment validation
```

## Quick start

1. **Install:** `npm install`
2. **Configure:** copy `.env.example` to `.env` and fill in `DATABASE_URL`, `DIRECT_URL` (Supabase pooler strings), `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.
   Redis, S3 storage and Resend are optional in development (in-memory rate limiting, a local `.storage/` folder at the repo root, emails logged to the console).
3. **Database:** `npm run db:migrate`, then either
   - `npm run db:seed`: reference data only (roles, the one course, tests, band tables, payment settings, your admin). Safe to re-run.
   - `npm run db:reset`: **wipes all data**, then loads reference data plus realistic fake demo data (see below).
4. **Run everything:** `npm run dev` starts the API (http://localhost:4000) and the web app (http://localhost:3000) together. Output is prefixed `[api]` / `[web]`; Ctrl+C stops both.

`npm run build`, `npm start` and `npm test` are unchanged.

## Demo data (`npm run db:reset`)

Refuses to run when `NODE_ENV=production`. Every demo account uses the password **`DemoPass123`**.

| Role | Email |
|---|---|
| Admin | admin@example.com |
| Teachers | ahmed.khan@example.com (main teacher of *IELTS September 2026*), sara.ahmed@example.com (writing teacher there, main teacher of *November*) |
| Students | student1 to student8 @example.com |

Batches: September 2026 (running, two teachers), **October 2026 (open, no teacher yet)**, November 2026 (open, Sara), **December 2026 (open, no teacher yet)**.
Students: student1-3 enrolled (progress, test attempts, a graded essay, attendance); student4 and student6 pending verification; student5 pending with an amount-mismatch flag; student7 rejected; student8 registered but not yet applied.

## Enrollment flow

Homepage → **Select batch** → **Register** (name, email, phone, city/country, background) → **Payment** (method, reference number, amount, date, receipt screenshot/PDF) → *Pending payment verification* → admin **Verifies** (one click = enrolled) or **Rejects** (with a reason; optionally letting the student upload a corrected proof) → **Student portal** with the full course.

- Until verification the student can sign in but sees a "pending" state; the course content is locked (the API answers `PAYMENT_PENDING`).
- A batch needs **no teacher** and has **no capacity**. Applicants can join a batch showing "Teacher: not assigned yet"; when the admin assigns a teacher, the batch and its enrolled students appear in the teacher portal.
- A student has one live application/enrollment at a time (there is one course).

Enrollment states in the database are reused: `PENDING_PAYMENT` = *pending payment verification*, `ACTIVE` = *enrolled*, `REJECTED` = *rejected* (plus `PAUSED`, `COMPLETED`, `EXPIRED`, `REFUNDED`, `CANCELLED`).

## Portals and access

| Portal | URL | Who |
|---|---|---|
| Student | `/student` | accounts with a student profile |
| Teacher | `/teacher` | accounts with the MENTOR role (they see only *assigned* batches) |
| Admin | `/admin` | staff roles (permission-based menus) |

A first gate in `apps/web/src/proxy.ts` redirects visitors without a session to the login page, and the layouts pick the portal by role. **The API is the real enforcement**: every endpoint checks the session, CSRF and a permission, and teacher endpoints additionally check batch assignment.

## What is in it

| Area | Highlights |
|---|---|
| **Applications** | Public batch list, one-request application (creates the account, stores the receipt), admin queue with Pending / Enrolled / Rejected tabs, duplicate-reference and amount-mismatch flags, coupons, manual enrollment, refunds. |
| **Learning** | Release rules, per-item progress, module pages (Listening, Reading, Writing, Speaking, Mock Tests), skill progress history. |
| **Assessments** | Question bank with versions, timed attempts, autosave, idempotent submit, auto-grading, raw-to-band conversion from versioned tables. |
| **Writing and speaking** | Draft autosave, browser audio recording, teacher grading queue scoped to assigned batches, rubric scores, IELTS rounding, regrades keep history. |
| **Live classes** | Scheduling, join links 15 minutes before class, attendance sheets. |
| **Teacher portal** | Dashboard, assigned batches, roster, classes and attendance, per-student **Results** (latest/best band per skill, last mock), grading queue. |
| **Admin portal** | Dashboard (students, pending applications, enrolled, active/upcoming batches, teachers), applications, batches (days, time, optional teachers, remove/archive), teachers, the one course and its content builder, assessments, settings (payment methods), staff and roles, audit log, reports. |
| **AI** | Writing and speaking estimates shown beside teacher grades, an AI tutor, and a support reply assistant. Advisory only and always labelled; off, or a deterministic mock, when not configured. See [docs/AI.md](docs/AI.md). |
| **Question bank and mocks** | Stimulus sets with items tagged by IELTS task type, composed mock exams drawn from approved content, and a full timed simulator (listening, reading, writing, speaking) that resumes after a refresh. |
| **Student intelligence** | Weakness analysis by skill and task type, a readiness estimate with plain reasons, a target-band planner, a personal study plan, spaced vocabulary review, a grammar tracker, writing history, and an optional leaderboard. |
| **Engagement** | Attendance corrections with an audit trail, activity status with follow-ups, class recordings, reminders that skip cancelled classes, and batch-level attendance. |
| **Teacher workspace** | Grading queue with autosaved drafts and priorities, a workload view, batch health, and cohort comparison with an audited CSV export. |
| **Admin command centre** | Permission-filtered metrics that link to filtered lists, global search, internal notes with visibility rules, support routing with response targets, referrals, and coupons with a live preview. |
| **Finance and security** | Payment risk flags that a person reviews (nothing is rejected automatically), statement import and reconciliation, numbered certificates with QR verification, and revocation. |
| **Lifecycle, alumni and feedback** | A student stage history, an alumni area with certificates and a revision library, and NPS with anonymous feedback. |

## Two-factor sign-in

Controlled by `TWO_FACTOR_ENABLED` (default: on in production, **off** elsewhere). While off, nobody is asked for a code and admins are not forced to enrol. All the TOTP code is still there; set `TWO_FACTOR_ENABLED=true` to bring it back.

## Tests

```
npm run test:unit -w @ielts/api   # pure logic and the route inventory, no database, seconds
npm test -w @ielts/api            # full integration suite (long: it talks to the remote database)
npm test -w @ielts/web            # component and hook tests, jsdom, no network
```

Integration tests run against an isolated `test` schema **in the same database** (never `public`). It is dropped and rebuilt each run; set `REUSE_TEST_DB=1` to keep it between runs (rebuild after adding migrations or changing the seed).

## Security notes

- Passwords: Argon2id. Sessions: 15-minute access JWT + rotating refresh token (reuse revokes the whole session family), httpOnly cookies, double-submit CSRF.
- Every sensitive action is written to an append-only audit log (database triggers block edits/deletes).
- Row Level Security is enabled on every table; the API connects as `postgres` and is the only intended client.
- Financial rows (orders, payments, proofs, refunds) cannot be deleted; verification is idempotent (conditional updates) and approved reference numbers are unique.
- Uploads are content-sniffed (never trusted by name/MIME); files are private and read through short-lived signed URLs.

## Deploying

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Not built yet

Known gaps, roughly in order of value:

- Attempts and speaking responses do not yet complete study-plan tasks; only writing and vocabulary reviews do.
- The NPS theme summary is generated on request and is not cached.
- Grading still checks teacher scope in its own service; the other teacher checks now use the shared scope service for batches.
- Refund-return of checkout credit is written but has no integration test yet.
- The Playwright suite is set up and lists its tests, but it has not been run against a seeded stack in this environment.
- The demo seed adds coupons, vocabulary, a grammar note and a welcome credit. Question bank sets, composed mocks, recordings, AI evaluations, risk flags, a statement import and a revoked certificate are not in it yet.

Also not built: subscriptions · mobile app · SMS/WhatsApp channels · non-Latin names on certificates · drag-and-drop reordering in the course builder.

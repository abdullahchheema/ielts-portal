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
| **Learning** | Release rules, per-item progress, module pages (Listening, Reading, Writing, Speaking, Mock Tests), skill progress history. AI practice is a placeholder page. |
| **Assessments** | Question bank with versions, timed attempts, autosave, idempotent submit, auto-grading, raw-to-band conversion from versioned tables. |
| **Writing and speaking** | Draft autosave, browser audio recording, teacher grading queue scoped to assigned batches, rubric scores, IELTS rounding, regrades keep history. |
| **Live classes** | Scheduling, join links 15 minutes before class, attendance sheets. |
| **Teacher portal** | Dashboard, assigned batches, roster, classes and attendance, per-student **Results** (latest/best band per skill, last mock), grading queue. |
| **Admin portal** | Dashboard (students, pending applications, enrolled, active/upcoming batches, teachers), applications, batches (days, time, optional teachers, remove/archive), teachers, the one course and its content builder, assessments, settings (payment methods), staff and roles, audit log, reports. |

## Two-factor sign-in

Controlled by `TWO_FACTOR_ENABLED` (default: on in production, **off** elsewhere). While off, nobody is asked for a code and admins are not forced to enrol. All the TOTP code is still there; set `TWO_FACTOR_ENABLED=true` to bring it back.

## Tests

```
npm run test:unit -w @ielts/api   # pure logic, no database, seconds
npm test -w @ielts/api            # full integration suite (long: it talks to the remote database)
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

AI-assisted practice and feedback (placeholder page only) · subscriptions · mobile app · a dedicated worker process (sweepers run inside the API) · SMS/WhatsApp channels · non-Latin names on certificates · drag-and-drop reordering in the course builder.

# Architecture

The academy is one course, run through three portals (student, teacher, admin) and an alumni area. The code is a monorepo that extends one architecture: no second API, no duplicate services, one place for each concern.

## Repository layout

| Path | What it is |
|---|---|
| `apps/api` | NestJS API. Every domain has its own directory under `src/`. |
| `apps/web` | Next.js app. Pages call the API through `/api/*`, which the server proxies, so login cookies stay first-party. |
| `packages/db` | Prisma schema and **hand-written SQL migrations**. The schema is a subset of the database, and the migrations are the source of truth. |
| `packages/validation` | Zod schemas shared by the API and the web app. |
| `packages/types` | Error codes and shared types. |
| `packages/config` | Environment validation. |
| `docs/` | This document, `AI.md`, and `DEPLOYMENT.md`. |

## Rules that apply everywhere

- **Migrations** are forward-only and additive. Each one starts with `SET lock_timeout`, uses idempotent DDL, enables row-level security on every new table, and puts new enum values in their own migration. `npm run drift` compares the schema with the database. Never run `prisma migrate dev`.
- **Append-only tables** have a trigger that forbids `UPDATE` and `DELETE`: audit logs, payment events, submission feedback, rubric scores, writing and speaking evaluations, attendance events, engagement history, vocabulary reviews, grammar observations, notification deliveries, account credit, certificate revocations, lifecycle transitions and feedback responses.
- **Authorisation** is server-side. Every route is authenticated by default. Admin routes declare `@RequirePermission`. A route inventory test (`apps/api/test/route-inventory.spec.ts`) fails if an admin or mentor route has no permission, and it keeps the list of public routes reviewed.
- **Teacher scope.** A teacher sees only batches they are assigned to. A query outside that scope returns 404, not 403, so the existence of other batches is not revealed.
- **Audit.** Changes to money, grades, roles, settings, lifecycle stages and certificates are recorded in the same transaction as the change.
- **Settings** are a whitelist. A setting can be written only if it has a schema, a default and a patch rule. Each change is audited.
- **Notifications** go through one service that records each delivery. Optional types can be switched off per user. Financial and enrolment messages are always sent.

## Modules

| Area | Modules |
|---|---|
| Account and access | `auth`, `roles`, `settings`, `audit` |
| Catalogue and sales | `courses`, `batches`, `commerce` (applications, payments, coupons, orders), `referrals`, `payment-risk`, `reconciliation` |
| Learning | `learning` (release rules, progress), `assessments` (attempts, grading), `question-bank`, `mock-exams`, `simulator`, `writing`, `speaking`, `grading` |
| Intelligence | `ai`, `insights` (weakness, readiness, target band), `study-plan`, `vocabulary` (SM-2), `grammar`, `analytics` |
| Engagement | `live` (classes, attendance, corrections), `engagement` (activity status, follow-ups), `recordings`, `leaderboards` |
| Teacher | `teacher-workspace` (queue, drafts, workload, batch health, cohorts) |
| Admin | `admin-ops` (command centre, search, notes, assistant), `support` (routing, SLAs), `certificates`, `reports` |
| Lifecycle | `student-lifecycle` (stages, history, alumni area), `feedback` (requests, anonymous responses, NPS), `lifecycle` (account sweeps) |
| Infrastructure | `jobs` (queue and scheduler), `integrations` (storage, mail, rate limiter), `notifications`, `config`, `prisma` |

## Events

Modules talk through named events on `EventEmitter2` rather than importing each other, which keeps the import graph acyclic.

| Event | Emitted by | Listened to by |
|---|---|---|
| `enrollment.activated` | `commerce` (payment approved) | `referrals`, `student-lifecycle` (ENROLLED) |
| `lifecycle.signal` | `commerce`, `learning`, `engagement`, `certificates`, `auth` | `student-lifecycle` (applies it if the stage allows) |
| `lifecycle.changed` | `student-lifecycle`, after each committed change | `feedback` (onboarding and completion requests) |
| `simulator.completed` | `simulator` | `feedback` (mock-exam request) |

Signals are applied only when the current stage allows them. An ignored signal is logged, not thrown, because events can arrive out of order.

## Jobs and scheduling

- **Jobs table.** A job is enqueued with a key, so the same work is never queued twice. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, and failures retry with backoff. A request can run its own job inline within a time budget; anything left over is picked up later.
- **Scheduled tasks.** Each task has one row with a lease, so overlapping runs cannot double-run a task. Tasks include attempt auto-submit, enrolment expiry, class reminders, the engagement recompute, study-plan refresh and simulator advancement.
- **Triggering.** Inside the API, a timer ticks every minute unless `DISABLE_SWEEPER` is set. The `/api/internal/cron` route runs due tasks with a 45-second budget, and a GitHub Actions workflow calls it every five minutes with `CRON_SECRET`. A late or duplicated call is harmless, because every task is idempotent.

## Snapshots

Insight calculations are expensive and mostly unchanged between visits. They are stored as snapshots keyed by an input fingerprint. A snapshot is recomputed only when its inputs change, so loading a dashboard reads snapshots and makes no AI calls.

## Storage

Files go to S3-compatible storage. Large media (speaking answers and class recordings) is uploaded directly to storage with a presigned `PUT`, so it never passes through the API. The API then completes the upload: it checks the object's size, sniffs its type from the first bytes (never trusting the file name or the declared type), and checks ownership. Playback and downloads use short-lived signed links. Without S3 configured, a development fallback writes to a local folder with signed links.

## Student lifecycle and alumni

Each student has one current stage and an append-only history. The allowed transitions are a single map (`student-lifecycle/lifecycle-rules.ts`). A student reaches ALUMNI only through completion followed by a certificate. The alumni area (`/alumni`) is open only to students at that stage, and the `alumni.access` setting can switch it off without changing anyone's stage.

## Feedback

A request is created once per survey, student and trigger, and the database enforces that. An anonymous response is stored without the student or the request, and one pure function (`feedback/nps.ts`) decides that shape. Scores and groups below five responses are withheld.

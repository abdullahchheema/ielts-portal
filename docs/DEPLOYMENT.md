# Deploying the IELTS Prep Portal

This guide describes a sensible first production setup. The application itself is tested (see the README); the hosting steps below are guidance and have **not** been run against a specific host, so follow them with a staging environment first.

## Shape

```
Browser ──► Web (Next.js, port 3000) ──/api/*──► API (NestJS, port 4000) ──► Supabase Postgres
                                                     │
                                                     ├─► S3-compatible storage (receipts, PDFs, audio, recordings)
                                                     ├─► Resend (email)
                                                     └─► Redis (optional: shared rate limiting)
```

The browser only ever talks to the **web** origin. Next.js proxies `/api/*` to the API, so login cookies are first-party (no CORS, `SameSite=Lax` works, CSRF protection stays simple). Keep it that way: do not expose the API on a different site that the browser calls directly.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | API | Supabase **Transaction pooler** (port 6543) with `?pgbouncer=true` |
| `DIRECT_URL` | migrations | Supabase **Session pooler** (port 5432). Used by `npm run db:migrate` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | API | Two different random 48+ byte secrets. Rotating the refresh secret also invalidates enrolled MFA secrets — plan a re-enrolment. |
| `APP_URL` | API | Public URL of the **web** app (used in email links and CORS) |
| `API_URL` | Web | Internal/public URL the web server uses to reach the API (build **and** runtime) |
| `NODE_ENV=production` | API | Enables `Secure` cookies |
| `TWO_FACTOR_ENABLED` | API | `true` requires an authenticator code for admin accounts. Defaults to `true` in production and `false` elsewhere. Set it to `true` before a real launch. |
| `RESEND_API_KEY`, `MAIL_FROM` | API | Without them, emails are only logged |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | API | **Required in production.** Without them files are written to the server's disk (`.storage/`), which is lost on redeploy and not shared between instances. Use a **private** bucket. |
| `REDIS_URL` | API | Optional. Without it rate limiting is per instance. |
| `DISABLE_SWEEPER` | API | See "Background work" |
| `CRON_SECRET` | API, GitHub secret | Shared secret for `/api/internal/cron`. Set the same value on both sides. |
| `CRON_URL` | GitHub secret | Full URL of `/api/internal/cron` on the deployed web app, used by `.github/workflows/cron.yml` |
| `CLASS_REMINDER_ENABLED` | API | Kill switch for class reminder emails. Defaults to on. |
| `OWNER_EMAIL` | API | The owner account. Staff cannot change its roles or suspend it through the app. |
| `AI_PROVIDER` | API | `mock`, `openai` or `none`. Production with no key and no value set runs with AI off. See `docs/AI.md`. |
| `AI_API_KEY` | API | OpenAI key. Keep it in the host's secret store. |
| `AI_MODEL`, `AI_TRANSCRIPTION_PROVIDER`, `AI_TRANSCRIPTION_MODEL` | API | Model choices. Defaults are in `.env.example`. |
| `AI_TIMEOUT_MS`, `AI_DAILY_LIMIT` | API | Per-call timeout and the per-student daily limit per feature |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed only | Used once to create the first super admin |

## First deploy

1. Provision the database (Supabase), the storage bucket, and a Resend domain.
2. Build the shared packages, then the apps: `npm ci && npm run build:packages && npm run build -w @ielts/api && npm run build -w @ielts/web`.
3. Apply migrations with the **session pooler** URL: `npm run db:migrate`.
4. Seed reference data and the first admin: `npm run db:seed` (safe to re-run: it does not overwrite your settings, courses or users, but it **does reset the built-in roles to their default permissions**, so re-run it only when you want that).
5. Start the API (`npm run start -w @ielts/api`) and web (`npm run start -w @ielts/web`).
6. Sign in as the super admin (with `TWO_FACTOR_ENABLED=true` you enrol an authenticator app on first sign-in).
7. In **Settings**, enter your real payment accounts (bank, JazzCash, Easypaisa). In **Band conversion**, confirm the tables with your academic team.

Run migrations **before** starting a new API version. Migrations only move forwards; take a database backup first, and test every release on a staging database.

## Background work

Every task (timed-attempt auto-submit, enrolment expiry, class reminders, engagement recompute, study-plan refresh, mock-exam advancement) is registered with one scheduler. Each task runs under a lease, so two overlapping runs never execute the same task twice, and every task is idempotent.

The scheduler is triggered in two ways, and either alone is enough:

1. **In-process.** Each API process ticks once a minute. Set `DISABLE_SWEEPER=true` on any instance that should not run tasks.
2. **External, every five minutes (recommended on serverless hosts).** `.github/workflows/cron.yml` calls `/api/internal/cron` with `Authorization: Bearer $CRON_SECRET`. It needs two repository secrets: `CRON_URL` (the full URL of the deployed web app's `/api/internal/cron`) and `CRON_SECRET`. GitHub may delay scheduled runs by a few minutes, which is harmless. cron-job.org works the same way if you prefer it.

On Vercel's Hobby plan the daily cron in `apps/web/vercel.json` is only a fallback. Use the external ping for timely reminders.

A late or repeated call does nothing harmful: reminders are de-duplicated and state changes are conditional.

## Direct uploads and playback (S3 CORS)

Speaking answers and class recordings are uploaded from the browser straight to the bucket with a presigned `PUT`, and recordings play from a signed `GET` in the browser. Both are cross-origin requests, so the bucket needs a CORS rule that allows the web origin (`APP_URL`):

```json
[
  {
    "AllowedOrigins": ["https://your-app.example.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Do not allow `*` as an origin. Without this rule uploads fail in the browser with a CORS error, and the API never sees them.

## Upgrading to the expansion release

Migrations from `20261006000000_platform_foundations` through `20261015000000_feedback` add the AI, jobs, insights, engagement, teacher, admin, finance, lifecycle and feedback tables. They are additive, and no existing payment, grade, attendance mark or published content changes state. Run `npm run db:migrate`, then `npm run drift -w @ielts/db` to confirm the schema and database agree. Run `npm run db:seed` once to add the new permissions to the built-in roles.

## Before you take real payments

- [ ] Payment accounts in Settings are correct and are accounts you monitor.
- [ ] `TWO_FACTOR_ENABLED=true` in production.
- [ ] Never run `npm run db:reset` against production (it refuses when `NODE_ENV=production`, but do not rely on that alone).
- [ ] Storage bucket is private; receipts open only through the admin queue's short-lived links.
- [ ] `S3_*` configured (receipts must survive a redeploy), with the CORS rule above.
- [ ] `CRON_SECRET` set on the host and as a GitHub secret, and `CRON_URL` set, so reminders and expiries run on time.
- [ ] Email works end to end (register a test student; check the verification email arrives).
- [ ] Every staff account has MFA enabled (Staff & roles shows the status).
- [ ] Supabase backups / point-in-time recovery enabled, and a restore has been tested at least once.
- [ ] Terms of service, privacy policy and refund policy published (the refund window is a setting).
- [ ] The default super admin password from the seed has been changed or the seed variables removed from the host.

## Operating notes

- **Logs:** the API logs to stdout. Payment, grading and role changes are additionally in the audit log (Admin → Audit log).
- **Deleting data:** financial rows, audit rows, grades and certificates cannot be deleted through the app or the database triggers; use status changes.
- **Row Level Security** is enabled on every table so Supabase's public REST endpoint exposes nothing. Do not add RLS policies that open tables to the `anon` role.
- **Content protection:** files are private with short-lived links, but nothing can fully prevent screen recording of lessons. Use the watermarking/DRM options of a video host if that matters to you.
- **Scaling:** first move the sweepers to a separate worker instance (`DISABLE_SWEEPER=true` on the web-facing API), add Redis for shared rate limiting, then add read replicas for reports.

## Deploying on Vercel (one project)

The NestJS backend runs inside the Next.js app: `apps/web/src/app/api/[...path]/route.ts` starts it on a private loopback port and forwards `/api/*` to it, so there is a single Vercel project.

1. Import the repo, set **Root Directory** to `apps/web` and the framework preset to **Next.js**. `apps/web/vercel.json` holds the install/build commands and the daily cron.
2. Environment variables: `DATABASE_URL`, `DIRECT_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL` (the site's own URL), `NODE_ENV=production`, `CRON_SECRET`, `TWO_FACTOR_ENABLED`, and the five `S3_*` variables (Supabase Storage S3 works). Local disk storage does not work on Vercel. Do **not** set `API_URL` (setting it makes the site use that external server instead).
3. Limits on Vercel: request bodies max about 4.5 MB (receipts are limited to 4 MB; long speaking recordings may fail); the periodic sweep (enrollment expiry, reminders, auto-submit of timed tests) runs once a day via cron on the Hobby plan.

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

Two timers run inside every API process: timed-attempt auto-submit (every minute) and enrollment expiry plus reminders (every five minutes). All state changes are conditional updates and reminders are de-duplicated, so running several API instances is safe — they simply share the work.

To run them on one instance only, set `DISABLE_SWEEPER=true` on the others.

## Before you take real payments

- [ ] Payment accounts in Settings are correct and are accounts you monitor.
- [ ] `TWO_FACTOR_ENABLED=true` in production.
- [ ] Never run `npm run db:reset` against production (it refuses when `NODE_ENV=production`, but do not rely on that alone).
- [ ] Storage bucket is private; receipts open only through the admin queue's short-lived links.
- [ ] `S3_*` configured (receipts must survive a redeploy).
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

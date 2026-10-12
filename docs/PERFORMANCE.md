# Performance review

Checked with `EXPLAIN` against the configured database. The database is small, so the planner often prefers a sequential scan even where an index exists. The point of this review is to confirm that the indexes the hot paths need are present and that the queries will use them as the tables grow. Re-run these checks once the tables hold real volumes.

## Findings

| Path | Query shape | Plan today | Index in place |
|---|---|---|---|
| Admin search, students | `ILIKE '%term%'` on first and last name | sequential scan on a small table | `student_profiles_name_trgm` (pg_trgm, GIN) |
| Admin search, users | `ILIKE` on email | trigram index available | `users_email_trgm` |
| Admin search, batches | `ILIKE` on batch name | trigram index available | `batches_name_trgm` |
| Feedback summary | rows created in a window, newest first | index scan backward on the date index | `feedback_responses_created_idx` |
| Mid-course check-in sweep | ACTIVE enrolments, progress and enrolment date | sequential scan on a small table | `enrollments` on `(status, enrolled_at)` |
| Support tickets by status | status and created date | index available | `support_tickets_status_created_at_idx` |

pg_trgm is installed, so the trigram indexes are used once the tables are large enough for the planner to prefer them.

## Snapshot paths make no AI calls

The student dashboard reads precomputed snapshots and never calls the AI. The insight snapshots are recomputed only when their inputs change (see `docs/ARCHITECTURE.md`).

## Open items

- Re-run `EXPLAIN ANALYZE` on search and the analytics queries against a production-sized copy. The current database is too small to show the trade-offs.
- The mid-course sweep reads at most 200 enrolments per run. If the ACTIVE set grows past that, the sweep keeps its order and finishes on later runs.

## Redesign Phase I — surgical round-trip fixes

No live database was available in this environment to re-measure wall-clock timings, so the numbers below are **round-trip counts read from the code**, before and after — not timed benchmarks. They're still real evidence: fewer sequential round trips to the database is a real latency reduction regardless of absolute timing, since each round trip pays full network/connection-pool latency in series when `await`ed one at a time.

| Path | Before | After |
|---|---|---|
| `CommandCenterService.overview()` (admin dashboard) | up to 11 independent reads awaited strictly in series (7 permission-gated metric queries, then batch health, risk distribution, the academic report's 2 queries, recent activity, alerts' 3 queries — 18 total `await`s, 0 `Promise.all`) | the up-to-11 independent branches run concurrently in one `Promise.all`; the only remaining sequencing is within genuinely dependent work (the academic report's own 2 queries are parallelized internally; alerts' 3 queries are parallelized internally) |
| `TeacherWorkspaceService.batchHealth()` | 3 independent reads (reviewer scope, batch lookup, cached snapshot) awaited one at a time before any authorization check ran | all 3 run in one `Promise.all`; the authorization checks run after, against the resolved values |
| `TeacherWorkspaceService.queue()` | reviewer scope and the grading-queue setting were awaited in series even though neither depends on the other | parallelized with `Promise.all` |
| `TeacherWorkspaceService.allBatchHealth()` (admin dashboard's batch-health list, up to 100 batches) | a confirmed N+1: `for (const b of batches) await this.batchHealth(...)`, one full `batchHealth` round trip (now 3 parallel queries, previously 3 sequential) per batch, fully serialized across all batches | runs in bounded batches of 10 concurrent `batchHealth()` calls via `Promise.all`, instead of one at a time — bounded rather than unbounded so it doesn't open 100 simultaneous connections against the pool |

Also added in this pass:
- `compression` (gzip) middleware in `apps/api/src/app.ts`, alongside the existing `helmet()` — the API previously sent every response uncompressed.
- Public data caching (`publicGet` honoring `_revalidate`, `/` on ISR instead of `force-dynamic`) was already done in Phase C; re-confirmed still in place, not re-touched here.

`insights.service.ts` (student dashboard) had the same pattern in several places: an independent lookup awaited before a `Promise.all` that didn't need it there. Parallelized: `weakness()`'s thresholds + fingerprint, `readiness()`'s weights + fingerprint, `readinessSignals()`'s profile lookup + its existing 7-query `Promise.all` (now 8), and `computeWeakness()`'s answer rows + writing evaluation + target band (3 independent reads, previously awaited one at a time). `targetPlan()` was left sequential by design — it genuinely needs the profile's `targetBand` before deciding whether to run `readinessSignals()` at all, so there's nothing to parallelize without changing behavior.

Verified: `npm run typecheck` (API `tsc --noEmit` + web), `npm run test:unit -w @ielts/api` (256/256), `npm run build -w @ielts/api`, `npm run build -w @ielts/web` all clean. The full `npm test -w @ielts/api` (integration suite) was attempted but requires a live Postgres instance not available in this environment — it was not run; Phase J's regression pass should re-attempt it against a real database before the final report.

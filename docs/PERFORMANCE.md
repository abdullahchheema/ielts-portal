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

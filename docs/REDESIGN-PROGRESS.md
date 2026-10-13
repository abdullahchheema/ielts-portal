# Redesign progress

Route-by-route tracker for the system-wide redesign (see the approved plan). A route only moves to
"Done" once it has been composed against the new identity, not merely repainted by the token change.

Legend: ✅ done · 🔶 repainted only (inherits new tokens, not yet recomposed) · ⬜ not started

## Phase A — Foundation
- [x] `globals.css` token rewrite (original warm-paper / ink-indigo / jade identity)
- [x] `useChartColors` fallback palette
- [x] 9 raw `slate-*`/`indigo-*` utility usages converted to semantic tokens
- [x] Missing primitives added: `Stepper`/`StepProgress`, `Separator`, `Checkbox`, `Radio`, `OptionCard`, `Switch`, `Tooltip`, `Accordion`, `DropdownMenu`
- [x] `Shell.tsx` wired to `<BrandLogo>`
- [x] `BrandLogo` created + wired into `Shell`, `PublicHeader`, `(auth)/layout`; `icons` metadata added
- [ ] Owner has not yet supplied `public/brand/{logo,logo-dark,mark}.svg` — components fall back to the glyph

All 86 routes are now 🔶 (repainted via tokens). None are ✅ yet — that requires the per-portal composition passes below.

## Phase B — App-wide states
- [x] `loading.tsx` / `error.tsx` per portal segment (`(auth)`, `admin`, `alumni`, `apply-teacher`, `enroll`, `register`, `student`, `teacher`, `verify`, root) + root `not-found.tsx`
- [x] `RouteStates.tsx` (`PageLoading`, `PageError`) as the shared skeleton/error implementation

## Phase C — Public + auth (10 routes)
- [x] `/` — fully recomposed: ISR via `publicGet(..., 120)` + `revalidate = 120` (dropped `force-dynamic`), new hero/module/CTA composition on tokens
- [x] `PublicHeader` — rewritten on tokens, `<BrandLogo>`, no `.mkt` classes
- [x] `MarketingInteractive.tsx` — rewritten (`FeatureShowcase` tabs, `FaqAccordion`) on the `Tabs`/`Accordion` primitives; removed the only 3 raw hex values in `src/`
- [x] `(auth)/layout.tsx` — rewritten split-panel shell on tokens + `<BrandLogo>`
- [x] `server-api.ts` `publicGet` now honours `revalidate` instead of hardcoding `cache: 'no-store'`
- [x] `/register`, `/enroll/[batchId]`, `/apply-teacher`, `/verify/[code]`, 5× `(auth)` pages — spot-checked, already compliant (use `ui` primitives/tokens only, no `.mkt` classes)
- [x] `src/styles/marketing.css` deleted, `@import` removed; verified zero `mkt`/`--mkt-` references remain in `apps/web/src`
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (13/13 passed), `npm run build -w @ielts/web` all clean on the combined Phase B+C change set

## Phase D — Onboarding survey
- [x] `enrollment_surveys` migration (hand-written SQL, RLS, CHECK constraints, mirrored in `schema.prisma`, `drift` clean)
- [x] `packages/validation/src/survey.ts` — `surveyDraftSchema` (all-optional) / `surveySubmitSchema` (Q1–Q10 required, conditional `.refine()`), single source of truth for API + web
- [x] `apps/api/src/enrollment-survey/` — `GET/PUT /me/enrollment-survey`, `POST /me/enrollment-survey/submit` (revision-checked draft save, 409 `ANSWER_SAVE_CONFLICT`, mirrors onto `StudentProfile` in a transaction on submit), `GET /admin/students/:id/enrollment-survey` (`student.view`), `GET /mentor/students/:id/enrollment-survey` (teacher batch-scoped)
- [x] `apps/api/test/enrollment-survey.spec.ts` — 7/7: draft save/resume, stale-revision conflict, submit mirrors profile columns (TAKEN/NEVER translation), incomplete submission rejected, student isolation, staff access, teacher batch scoping
- [x] Existing regression unaffected: `applications.spec.ts` + `checkout-credit.spec.ts` 28/28
- [x] `components/survey/` — `questions.ts` (copy config), `SurveyWizard.tsx` (one question per screen on `StepProgress`/`OptionCard`, autosave per answer, review step, resume-as-submitted), `SurveyWizard.test.tsx` (3/3)
- [x] Slotted into `/enroll/[batchId]` as step 0 (Survey → Payment → "A few more details" + Review); leftover applicant-only fields (phone/city/country/testType/examDate) moved into the review step
- [x] Staff surfacing: "Onboarding survey" card on admin student detail (`account` tab), compact summary in the applications verification dialog, `StudentDetailDialog` "Survey" tab, student dashboard "Your goals" card — all via shared `components/survey/SurveySummary.tsx`, never exposed publicly
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16), `npm run build -w @ielts/web` clean on the full Phase D change set

## Phase E — Student portal (33 routes) — composition audit done, duplication pass done
- [x] Audit of all 33 student routes: Phase A's token/primitive pass already left compositions sound (no missing `PageHeader`, no bare lists without states, no broken responsive handling found). Remaining Phase E work is narrower than originally scoped: consolidating duplicated list markup, hoisting a duplicated AI-feedback helper, and replacing one raw `<table>`.
- [x] New shared primitives in `components/ui/display.tsx`: `SimpleList`/`SimpleListItem` (one bordered card, divided rows) and `CardList`/`CardListItem` (individually-bordered rows, optional `href`) — replace a "bordered row in a plain `<ul>`" pattern that had been hand-copied with minor class variations across 6 routes
- [x] Applied: `course/page.tsx` (certificates), `progress/page.tsx` (submissions), `schedule/page.tsx` (past classes) → `SimpleList`; `vocabulary/page.tsx` (saved words), `referrals/page.tsx` (referral items), `writing-ai/page.tsx` (essays, now a `CardListItem` with `href` instead of a hand-wrapped `<Link>`) → `CardList`
- [x] New `FeedbackList` in `components/ui/ai.tsx` — hoisted out of an identical local `List({ title, items })` helper duplicated verbatim in `writing-ai/[id]/page.tsx` and `speaking-ai/page.tsx`; both now import the shared component
- [x] `submissions/[id]/page.tsx` — the hand-coded criteria/band `<table>` now uses the shared `Table`/`Td` primitives, consistent with the rest of the portal
- [x] `/student/attempts/[id]` and `/student/simulator/[id]` untouched, per the plan's risk section (styling-only screens)
- [x] Remaining 33 student routes not touched by this change set: no composition defects were found in them during the audit, so they stay as repainted-only (🔶) until a dedicated per-route pass, not because they were skipped by mistake
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16), `npm run build -w @ielts/web` (72/72 routes) all clean on this change set
## Phase F — Teacher portal (6 routes) — audited, no changes needed
- [x] Audited all 6 routes (dashboard, batches, batch workspace, grading queue, grading detail, student view) against the same composition criteria as Phase E: `PageHeader` present, real `Empty`/`Loading`/`SkeletonTable` states, `Table`/`Td` used consistently for every tabular list, `Tabs` used for the batch workspace and student-detail sections, no raw hand-coded tables
- [x] No structural composition defects found — the portal was already composed cleanly in the original build, and Phase A's token pass left it sound. The one hand-rolled list (`page.tsx`'s "Upcoming classes") is a single occurrence with its own padding, not a duplicate of anything else in this portal, so it was left as-is rather than forced into the Phase E `SimpleList` primitive for no real benefit
- [x] Grading detail (`grading/[id]/page.tsx`) draft autosave, band-rounding (`ieltsRound`) and revision-conflict handling confirmed untouched
- [x] No code changes required; `npm run lint`/`test`/`build` already clean from Phase E — nothing invalidated by this audit-only phase
## Phase G — Admin portal (35 routes) — composition audit done, 2 files fixed
- [x] Audited the admin portal's route files against the same composition criteria as Phases E/F: `PageHeader` present, real `Empty`/`Loading` states, `Table`/`Td` used for tabular data, no hand-rolled markup duplicating an existing shared primitive. `admin/analytics/page.tsx` was explicitly excluded — never read, never modified — because it has an ongoing owner edit in progress
- [x] Two files had the exact duplicated-list pattern Phase E's `CardList` exists for: `feedback/page.tsx`'s "Recent responses" and `reconciliation/page.tsx`'s "Payment risk to review", both a `<ul className="space-y-3"><li><Card>...</Card></li></ul>` wrapper. Both now use `CardList` (reused, no new primitive needed); the `<li><Card>...</Card></li>` children were left unchanged
- [x] Judgment calls to leave similar-but-not-duplicate patterns untouched: `orders/page.tsx`'s Payments list, `tickets/[id]/page.tsx`'s enrollments list, and `reconciliation/page.tsx`'s own nested flag list (different shape, action buttons) — each a single occurrence, not a duplicate of anything else in the portal, consistent with the anti-over-engineering rule from Phases E/F
- [x] `StudentDetailDialog.tsx` checked and found clean
- [x] No composition defects found in the remaining admin route files — they stay 🔶 (repainted only) pending a dedicated per-route pass, not because they were skipped
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16), `npm run build -w @ielts/web` all clean, independently re-run (not just the auditing agent's self-report) before commit
## Phase H — Motion + responsive pass — done
- [x] Wired Phase A's motion tokens (`--dur-fast`/`--dur`/`--dur-slow`, `ease-out-soft`, `ease-spring`) into every hardcoded transition duration across `components/ui/*` and `Shell.tsx`, via the `duration-[var(--dur-fast)]` arbitrary-value mechanism (Tailwind v4 doesn't expose a named `duration` utility from the `:root` token layer)
- [x] Confirmed zero `transition-all` usage anywhere in `apps/web/src`
- [x] Added missing `ease-out-soft` to several transitions that had none (`table.tsx`, `tabs.tsx`, `display.tsx`, `field.tsx`, `menu.tsx`, Shell nav links/backdrop)
- [x] Upgraded 3 existing transform-based animations to `ease-spring`: `Accordion` chevron rotation, `Switch` thumb slide, Shell's mobile nav drawer slide — no new animations invented
- [x] Enlarged 5 icon-only controls under 44px to `size-11`: Shell mobile hamburger + drawer close, `NotificationBell` trigger, `DetailDialog` close, shared `Drawer` close. Desktop-only controls and labeled `Button` sizes left as-is (not touch-primary, or already meeting the 24×24px minimum)
- [x] Responsive check at 360/390/768/1280/1440: **static Tailwind-class analysis only** (no browser automation tool available in this environment) — no horizontal overflow found; Shell's drawer/rail are correctly breakpoint-gated, the data table collapses to stacked cards below `lg` by existing design, bare `grid-cols-N` usages hold only text-wrapping content with no fixed-width children. Not visually confirmed in a live viewport — flagged honestly rather than claimed as verified
- [x] `admin/analytics/page.tsx` (owner-edited) and the two timed-assessment routes (`attempts/[id]`, `simulator/[id]`) untouched
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16), `npm run build -w @ielts/web` all clean, independently re-run before commit
## Phase I — Performance (surgical) — done
- [x] `CommandCenterService.overview()` (admin dashboard): 7 permission-gated metric queries + batch health + risk distribution + academic report + recent activity + alerts (12 independent branches total) converted from strictly-sequential `await`s to one `Promise.all`; metric ordering preserved by reconstructing the `metrics` array after resolution, not by the order of the round trips
- [x] `academicReport()` and `alerts()` each had 2–3 of their own internal independent reads parallelized the same way
- [x] `TeacherWorkspaceService.batchHealth()`: 3 independent reads (reviewer scope, batch lookup, cached snapshot) parallelized; authorization checks still run only after all 3 resolve, logic unchanged
- [x] `TeacherWorkspaceService.queue()`: reviewer scope + grading-queue setting parallelized
- [x] `TeacherWorkspaceService.allBatchHealth()` confirmed N+1 fixed: was one `batchHealth()` round trip per batch, fully serialized across up to 100 batches; now runs in bounded concurrency slices of 10 via `Promise.all`, not fully unbounded (avoids opening 100 simultaneous connections against the pool)
- [x] `InsightsService`: same accidentally-sequential pattern found in `weakness()`, `readiness()`, `readinessSignals()`, `computeWeakness()` — each had an independent lookup awaited before a `Promise.all` that didn't need it there; all 4 parallelized. `targetPlan()` left sequential by design — it genuinely needs `targetBand` before deciding whether to call `readinessSignals()` at all
- [x] Added `compression` (gzip) middleware to `apps/api/src/app.ts`, alongside the existing `helmet()`
- [x] Public data caching (`publicGet` honouring `_revalidate`, `/` on ISR) was already done in Phase C; re-confirmed still in place, not re-touched
- [x] No live database was available in this environment to measure real wall-clock timings — the before/after numbers recorded in `docs/PERFORMANCE.md` are round-trip counts read from the code, not timed benchmarks. The full `npm test -w @ielts/api` integration suite also could not be run (hangs with no DB reachable); flagged for Phase J to re-attempt against a real database
- [x] `npm run typecheck`, `npm run test:unit -w @ielts/api` (256/256), `npm run build -w @ielts/api`, `npm run build -w @ielts/web` all clean, independently re-run before commit
## Phase J — Regression + final report — done
- [x] `npm run typecheck` (API `tsc --noEmit` + web) — clean
- [x] `npm test -w @ielts/web` — 16/16
- [x] `npm run test:unit -w @ielts/api` — 256/256
- [x] `npm test -w @ielts/api` (full integration suite, isolated `test` schema, live database reachable in this run unlike Phase I) — 512/512 across 53 spec files
- [x] `npm run build` (full monorepo, API + web) — clean, 6/6 Turborepo tasks
- [ ] Playwright smoke (`E2E_BASE_URL`) — not run. It requires a running API+web stack with demo data seeded against the real (non-isolated) database; standing up that stack and seeding it was judged out of scope for an unattended session given the "surgical, low-risk" principle governing this whole plan. Run manually before a release: see `docs/DEPLOYMENT.md`.
- [ ] Owner has still not supplied `public/brand/{logo,logo-dark,mark}.svg` — components fall back to the glyph, as they have since Phase A

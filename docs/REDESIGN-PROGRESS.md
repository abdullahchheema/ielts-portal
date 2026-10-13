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
- [x] `/register`, `/enroll/[batchId]`, `/apply-teacher`, `/verify/[code]`, 5× `(auth)` pages — superseded by a later real per-route recomposition pass (see below); the original "spot-checked, already compliant" note undersold the actual gaps found
- [x] `src/styles/marketing.css` deleted, `@import` removed; verified zero `mkt`/`--mkt-` references remain in `apps/web/src`
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (13/13 passed), `npm run build -w @ielts/web` all clean on the combined Phase B+C change set
- [x] **Real recomposition of the 9 "spot-checked" routes**: `register` (batches grid → `Section`), `apply-teacher` (heading style fix, `Alert` success state), `verify/[code]` (emoji glyphs → lucide icons in toned badges, fixed a real severity bug where "revoked" and "not found" both used danger tone — revoked is now warning), `(auth)/login` + `(auth)/create-account` (`Separator label="or"` primitive replacing/missing from the hand-rolled divider), `(auth)/forgot-password` (missing `Alert` success state added); `(auth)/reset-password` and `(auth)/verify-email` read in full and left unchanged — no real gap, not a repeat spot-check
- [x] `enroll/[batchId]/page.tsx` shell/chrome only: local hand-rolled `Steps` component (duplicating `Stepper` feature-for-feature) replaced with the real `Stepper` primitive; Payment/details/review steps wrapped in `Section`; review `<dl>` replaced with `DefinitionList`. `SurveyWizard`, its autosave/revision logic, payment/receipt submission, and `applicantProfileSchema` validation confirmed untouched by reading the diff directly
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16, including `SurveyWizard.test.tsx`), `npm run build -w @ielts/web` (86/86 routes) all independently re-run after these edits — clean

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

## Phase E — Student portal (32 routes) — done, full per-route recomposition
- [x] Supersedes the earlier audit-only pass (which found most routes already sound and left them 🔶). This pass actually recomposed every route, not just the ones with duplicated list markup.
- [x] **Dashboard/profile/course group** (`page.tsx`, `profile`, `schedule`, `progress`, `insights`, `study-plan`, `course`, `batch`): `Radio`/`DefinitionList`/`CardList`/`Badge`/`Section` swapped in for raw inputs, hand-rolled `<dl>`/`<ul>` and status spans. Dashboard and insights pages reviewed and left unchanged — already well composed, no real gap
- [x] **Assessment/practice group** (`mock-tests`, `simulator` list, `diagnostic`, `leaderboard`, `recordings`, plus the two **live timed-exam screens**): `Field`/`Checkbox`/`Section`/`Switch`/`CardList`/`Badge` applied to the non-timed pages; `mock-tests` and `diagnostic` left unchanged (thin wrappers around shared components, nothing of their own to compose). `attempts/[id]`: one token-only color fix (`ring-green-300`→`ring-success/40`) confined to the post-submission `ResultView`, zero changes to the live countdown/autosave render path. `simulator/[id]`: zero changes — already fully token-based, and the one plausible upgrade (`Stepper` for the stage pills) was rejected because it would shift layout during a polled, timed flow
- [x] **Writing/speaking AI group** (`writing`, `writing-ai` list/detail/history, `speaking`, `speaking-ai`, `ai-practice`): `Tooltip`/`Accordion`/`Badge`/`SimpleList`/`Tabs` applied to static display sections only; `writing-ai/[id]` and `speaking-ai`'s live editor/recorder/autosave/submit paths explicitly untouched. `writing`/`speaking` left unchanged — one-line wrappers around the shared `ModulePage` component (editing it would hit 4 other out-of-scope routes)
- [x] **Skills/support/misc group** (`listening`, `reading`, `grammar`, `vocabulary`, `tutor`, `application`, `referrals`, `support` list/detail, `submissions/[id]`): `SimpleList`/`Accordion`/`FilterBar` added to `tutor`/`support`/`submissions`; `listening`/`reading` left unchanged (thin `ModulePage` wrappers); `grammar`/`vocabulary`/`referrals` reviewed and already well composed
- [x] All diffs independently re-read via `git diff`, not just trusted from agent self-reports — confirmed the two timed-exam screens' changes matched exactly what was reported
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16), `npm run build -w @ielts/web` (86/86 routes) all independently re-run after the edits — clean
## Phase F — Teacher portal (6 routes) — done, full per-route recomposition
- [x] Supersedes the earlier audit-only pass. Dashboard's "Upcoming classes" → `CardList`; `batches` empty state got an icon+title and a duplicate-import fix; batch workspace got `SimpleList` for the attendance roster, `Accordion` for correction history, sticky tables; grading queue got `Tabs` for the status segments and a real `Pagination` control; student detail got a `Section`-wrapped risk/band block and sticky tables
- [x] Grading detail (`grading/[id]/page.tsx`): `Accordion`/`SimpleList`/`Field` applied only to static instructions/history/tag-note markup; draft autosave, `ieltsRound`, revision-conflict handling, and the rubric score/notes bindings confirmed untouched by reading the diff directly
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16), `npm run build -w @ielts/web` (86/86 routes) all independently re-run after the edits — clean
## Phase G — Admin portal (35 routes) — done, 34/35 routes recomposed
- [x] Full per-route composition pass across all 34 in-scope admin routes (every file under `apps/web/src/app/admin/**` except `admin/analytics/page.tsx`, which was never read or modified — ongoing owner edit). This supersedes the earlier audit-only pass, which left most routes as 🔶; every route below moved to ✅
- [x] **Command centre / students / batches / enrollments** (`page.tsx`, `students/page.tsx`, `students/[id]/page.tsx`, `batches/page.tsx`, `batches/[id]/page.tsx`, `enrollments/page.tsx`): `SimpleList`/`DefinitionList` replacing raw lists/`<dl>`, `FilterBar`+`SearchInput`+`Pagination` on students, sticky table headers throughout, `Empty` states, `Badge`/`ProgressBar` for status/progress, `Separator`-grouped `CreateBatch` dialog
- [x] **Teachers / tickets / orders / reconciliation / applications** (`teachers/page.tsx`, `tickets/page.tsx`, `tickets/[id]/page.tsx`, `reconciliation/page.tsx`, `orders/page.tsx`, `refunds/page.tsx`, `applications/page.tsx`): exposed previously-unused but backend-supported filters/pagination (`tickets` assignedTo/skip/take, `reconciliation` status/level), `DropdownMenu` row actions, `Checkbox`/`Field`/`Badge` primitive swaps, sticky tables. `teacher-applications/page.tsx` confirmed to be a pure redirect with no renderable UI — left as-is
- [x] **Coupons / referrals / feedback / engagement / attendance-corrections / reports / cohorts / batch-health**: `Tabs` replacing several status `Select`s, exposed backend-supported `skip`/`take` pagination on referrals and `from`/`to` date range on cohorts (previously unwired), shared `StatCard` replacing a bespoke local `Stat` component on reports, `Badge` for status pills, sticky tables, `DropdownMenu` row action on attendance-corrections
- [x] **Settings / security / staff / audit / question-bank / bands / mock-exams / course / assessments / analytics/content**: `Switch`/`Checkbox`/`Radio` replacing raw inputs, `Section`-wrapped groupings, exposed backend-supported `entityType` filter on audit and `topic` search + pagination on question-bank, `Accordion` for audit JSON diffs and question-bank passages, `Tooltip` for truncated values, `DropdownMenu` for staff row actions
- [x] All 33 edited files (34 routes minus the no-op redirect) re-verified by reading the actual `git diff`, not just agent self-reports; confirmed `admin/analytics/page.tsx` was untouched (its one-line diff present is the owner's pre-existing uncommitted edit from before this session started)
- [x] `npm run lint -w @ielts/web` (tsc --noEmit) and `npm run build -w @ielts/web` (full 86-route production build) both run independently after the edits — clean
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

## Phase K — Visual identity overhaul: token foundation
- [x] Owner supplied the real logo (JPEG, navy `#333A4C`); `BrandLogo` repointed from the never-supplied `.svg` paths to `/brand/{logo,logo-dark}.jpeg` + a cropped `/brand/mark.png`, sized up (`h-8`→`h-11 sm:h-12`, `size-9`→`size-11`). Root metadata's stale `mark.svg` icon reference fixed to `mark.png`
- [x] `globals.css` full token rewrite: pure-white canvas (`--canvas`/`--surface` both `#FFFFFF`, warm beige neutrals re-neutralized cool), primary repointed to the logo's navy (`#243356`, 12.5:1 on white), new vivid amber CTA accent (`#F59E0B` fill / `#101322` text, 6.1:1), status colors re-tuned ≥5:1, `--color-indigo-*` ramp re-derived off the new navy, new `--radius-sm…3xl` ramp, shadow ramp re-tinted neutral + deepened, new `--text-lead` token and raised `--text-display/h1/h2/h3/overline` sizes
- [x] Typography unified on Plus Jakarta Sans everywhere (Inter dropped); `h1-h4` get a real `font-weight: 700` (previously family-only); `html { font-size: 112.5% }` (16px→18px) with public/Shell container widths stepped down one notch to compensate for Tailwind's breakpoints staying fixed at the browser's native 16px
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16) clean

## Phase L — Motion infrastructure
- [x] Installed `motion@14.1.0` (confirmed React 19 / Next 16 peer-compatible); `components/motion/{variants,primitives,hero-backdrop,provider}` — `Reveal`/`Stagger`/`StaggerItem`/`Lift`/`CountUp` wrap server-rendered children so marketing pages stay server components; `MotionConfig reducedMotion="user"` mounted in `app/layout.tsx`, confirmed independent of the existing CSS `prefers-reduced-motion` kill-switch (Motion doesn't drive the `animation`/`transition` CSS properties that switch touches)
- [x] `npm run lint -w @ielts/web` clean

## Phase M — Shared primitives + 18px rollout
- [x] `ui/button.tsx`: new `size="xs"` and `variant="cta"` (amber); ~49 `!py-1`/`!px-2 !py-1`/`!py-1.5` overrides across 22 files replaced with real `size` props — the override pattern itself is gone, not just hidden
- [x] `ui/field.tsx`, `ui/display.tsx` (`Card`/`Badge`/`StatCard`/`Section`/`SimpleList`/`CardList`), `ui/table.tsx`, `ui/layout.tsx` (`PageHeader` gained an `eyebrow` slot, dropped its hardcoded `sm:text-[1.7rem]`), `ui/feedback.tsx`, `ui/interactive.tsx`, `ui/dialog.tsx`, `ui/confirm.tsx`, `ui/menu.tsx`, `ui/toast.tsx` all moved to the new radius/shadow/padding scale
- [x] `Shell.tsx`: `WIDTH` stepped down (`6xl/7xl/4xl`→`5xl/6xl/3xl`), sidebar grid `16rem/4.5rem`→`15rem/4rem`, topbar `h-14`→`h-16`, nav icons `size-4.5`→`size-5`
- [x] `.data-table` CSS stacking breakpoint raised `1023.98px`→`1151.98px` so tables stack before the 18px scale clips them
- [x] `useChartColors` fallback palette and the one remaining hardcoded gradient (`(auth)/layout.tsx`) repointed off the old indigo/jade hex values
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16) clean

## Phase N — Shared hero + public chrome
- [x] `components/public/page-hero.tsx`: one `PageHero` (`size: 'full'|'standard'|'compact'`) used by every public page — eyebrow → headline → subtitle → CTA, with an animated `HeroBackdrop` (static gradient only on `compact`, so forms don't jitter)
- [x] `PublicHeader`: `h-16`→`h-20`, logo enlarged, **real mobile menu added** (previously nav links just vanished below `sm` with no replacement), vertical separator before the auth cluster
- [x] `PublicFooter`: logo enlarged, new **Legal** column + bottom-bar links to `/terms` and `/privacy`
- [x] `(auth)/layout.tsx`: palette-driven gradient fixed, panel enlarged (`rounded-2xl`→`rounded-3xl`), wrapped in `Reveal` for an entrance animation

## Phase O — Marketing pages recomposed on PageHero
- [x] `/`, `/pricing`, `/reviews`, `/free-tools`, `/about` — all five adopt `PageHero` + `Reveal`/`Stagger` scroll animations + the amber `cta` button variant, replacing six different ad-hoc container widths with one standard
- [x] Homepage: payment removed from the top-of-funnel story (`STEPS` cut from 5 to 3 — "Pay and upload proof" / "We verify your payment" dropped; hero stat row dropped "Course fee"); CTA copy made more action-first ("Start preparing today")
- [x] `BatchCard`, `MarketingInteractive`, `BandScoreCalculator` bumped to the new radius/shadow scale

## Phase P — Transactional + auth routes
- [x] `/register`, `/apply-teacher`, `/verify/[code]` adopted `PageHero size="compact"` + `PublicFooter` — previously had neither and used raw `text-2xl`/`text-3xl` headings
- [x] `/enroll/[batchId]`: chrome-only pass (footer added to all branches, heading/container sizing bumped) — the Stepper/payment/survey submission logic was not touched, consistent with this route's existing high-risk treatment in prior phases
- [x] `(auth)/create-account`: added a Terms/Privacy consent line (text + links only, no new required field/validation change)
- [x] `npm run lint -w @ielts/web`, `npm test -w @ielts/web` (16/16) clean

## Phase Q — Terms of Service + Privacy Policy
- [x] New `/terms` and `/privacy` routes sharing `components/public/legal-layout.tsx` (`PageHero` + a `.legal-prose` block in `globals.css`); content drafted from what the codebase actually does (payment methods, manual payment verification, onboarding survey, speaking recordings, certificate verification) with `[PLACEHOLDER: ...]` markers for legal entity name, address, support email, and governing jurisdiction — owner must fill these before the pages are legally load-bearing
- [x] Linked from `PublicFooter`'s new Legal column and the create-account consent line

## Phase K–Q verification
- [x] `npm run lint -w @ielts/web` (tsc --noEmit) clean
- [x] `npm test -w @ielts/web` — 16/16
- [x] `npm run build -w @ielts/web` — clean, 78/78 routes (includes new `/terms`, `/privacy`), zero errors
- [x] Live `next dev` smoke test: `/`, `/pricing`, `/terms`, `/privacy`, `/register` all returned 200 and rendered the new hero/CTA content, confirmed by grepping the actual response HTML (not just HTTP status)
- [x] `admin/analytics/page.tsx` (pre-existing uncommitted owner edit) and `test-results/` confirmed untouched and excluded from this change set
- [ ] Portal pages (student/teacher/admin, ~73 routes) were NOT individually recomposed in this pass — they inherit the new identity automatically through the Phase M primitive changes (67/74 already use the shared `PageHeader`, which now carries the bigger/bolder/eyebrow treatment), but a dedicated per-route sweep (as Phases E–G did for the previous redesign) was out of scope for this session and should follow as a later phase if a fully hand-tuned portal pass is wanted
- [ ] Visual/manual QA (contrast on real screens, mobile menu keyboard nav, reduced-motion toggle, cross-browser) not performed — flagged honestly rather than claimed

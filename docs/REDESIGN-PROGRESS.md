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
## Phase F — Teacher portal (6 routes) — not started
## Phase G — Admin portal (35 routes) — not started
## Phase H — Motion + responsive pass — not started
## Phase I — Performance (surgical) — not started
## Phase J — Regression + final report — not started

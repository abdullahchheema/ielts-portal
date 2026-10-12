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
- [ ] `loading.tsx` / `error.tsx` per portal segment + root `not-found.tsx`

## Phase C — Public + auth (10 routes)
- [ ] `/`, `/register`, `/enroll/[batchId]`, `/apply-teacher`, `/verify/[code]`, 5× `(auth)` — original composition, delete `marketing.css`

## Phase D — Onboarding survey
- [ ] Migration, API, validation, `SurveyWizard`, staff surfacing

## Phase E — Student portal (33 routes) — not started
## Phase F — Teacher portal (6 routes) — not started
## Phase G — Admin portal (35 routes) — not started
## Phase H — Motion + responsive pass — not started
## Phase I — Performance (surgical) — not started
## Phase J — Regression + final report — not started

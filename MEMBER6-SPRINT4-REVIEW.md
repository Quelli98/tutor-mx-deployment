# Sprint 4 Member 6 review

Reviewed against the 30 September 2026 Sprint 4 handbook, especially S4-M6-1, S4-M6-2 and S4-M6-3.

## Result

All three Member 6 cards are represented end-to-end in the updated code. The original Member 6 implementation had the main proposal feature in place, but this review found several correctness and completeness gaps in draft-state rule evaluation, impact metrics, proposal explanations and the strategy-comparison UI. Those gaps are fixed in this archive.

## S4-M6-1 — Whole-school explainable proposal engine

- Uses open `StaffingRequirement` rows and the existing allocation candidate/rule engine.
- Keeps mark, clash and selected-week capacity as the hard rules.
- Confirmed Student tutoring bookings remain part of the existing candidate clash source.
- Supports an optional existing Draft Scenario so organiser locks/current draft items are preserved.
- Correctly evaluates removed/changed live allocations against the Scenario draft instead of keeping stale live clash/capacity blockers.
- Prevents partial existing coverage from over-allocating a whole additional session.
- Provides Balanced, Strongest Match, Fair Workload and Budget Aware presets with fixed hard rules and different soft weights.
- Uses deterministic requirement ordering, candidate scoring and Tutor-ID tie-breaking.
- Generates/duplicates a normal Draft Scenario and never writes live Allocations directly.
- Proposal building happens before Scenario creation, preventing an empty draft if generation fails early.

## S4-M6-2 — Proposal cockpit: Why this Tutor? / Why not?

- Organiser-only proposal API and `/organiser/proposals` UI are wired into the backend, router, sidebar and destination palette.
- Chosen Tutor explanations now visibly include hard-rule status, soft score and soft factors.
- Alternatives distinguish hard-rule failure from lower soft score.
- Explanations are rechecked against the full current draft; stale chosen Tutors are flagged instead of being silently described as valid.
- Manual replacement is accepted only when the replacement passes the current Scenario hard rules and a reason is supplied.
- Generated proposal metadata records the selected preset and exact generated item IDs so pre-existing manual Scenario items are not mislabeled as engine choices.
- The generated Scenario link opens Scenario Planning at that Scenario, where the existing Compare with Live and Publish workflow continues.

## S4-M6-3 — Strategy comparison + proposal impact lab

- All four presets run against the same planning window, optional starting Draft/locks and hard rules from one serializable comparison snapshot; a Draft that changes mid-comparison is rejected as stale.
- Side-by-side UI now includes new assignments, total draft allocated hours, shortage, projected cost and Tutor workload.
- Metrics use proportional requirement coverage/carry-in handling aligned with Scenario comparison definitions.
- Each strategy has a `Review why` explanation view.
- Each strategy can be saved as a Draft Scenario and does not directly publish live.

## Important reviewed tests

Backend proposal tests now cover deterministic ties, no-solution/shortage, lock-heavy planning, selected-week boundary capacity, budget-aware ordering, draft-vs-live clash/capacity replacement, carry-in coverage, stale explanations, generated-item metadata, non-Draft base rejection, early generation failure, manual eligibility checks and validation limits. Existing scheduling integration coverage verifies confirmed `TutoringBooking` rows appear as standard Tutor allocation clashes.

Frontend proposal tests cover all four strategy rows, workload/cost display, explanation review, optional locked Draft input, scenario saving, hard/soft explanation display, eligible manual adjustment and generation failure handling.

## Verification performed in this review

- Changed TypeScript and JSX files were syntax-transpiled with zero diagnostics.
- `git diff --check` passed for the reviewed changed files.
- `node scripts/check-repository.mjs` passed its tracked-file secret and AI-attribution checks.

The full dependency-based gate could not be executed in this environment because `npm ci` timed out before dependencies finished installing. Therefore this archive does **not** claim that `npm run check` or coverage passed. On the integration machine run:

```bash
npm ci
npm ci --prefix frontend
npm run generate
npm run check
npm run coverage
```

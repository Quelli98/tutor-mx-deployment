# Sprint 4 final code — Members 1 to 6

This archive starts from the supplied completed Members 1–5 code and adds the Sprint 4 Member 6 scope from the 30 September handbook.

## Member 6 completed scope

### S4-M6-1 — Whole-school explainable proposal engine
- Added an organiser-only proposal service and API.
- Uses existing open `StaffingRequirement` data and the existing allocation candidate/rule engine.
- Hard rules remain mark, schedule clash and selected-week capacity.
- Confirmed Student `TutoringBooking` rows are already included by the existing candidate clash query and therefore block proposal assignments.
- Existing Draft Scenario items can be used as a base; existing/locked items are preserved and the engine fills remaining shortages rather than moving locks. Removed/changed live allocations are evaluated against the draft state rather than incorrectly remaining as stale clash/capacity blockers.
- Added deterministic presets: Balanced, Strongest Match, Fair Workload and Budget Aware.
- Generated output is saved as a normal DRAFT `Scenario`; it never writes directly to live `Allocation` rows.

### S4-M6-2 — Proposal cockpit and explanations
- Added `/organiser/proposals` and sidebar/command-palette navigation.
- Shows `Why this Tutor?` and `Why not?` explanations, including the chosen Tutor hard-rule result, soft score and visible soft factors.
- Distinguishes hard-rule failures from lower soft-objective ranking.
- Supports an eligible manual Tutor adjustment only when current hard rules still pass and an organiser enters a reason.
- Proposal drafts hand off directly to the generated draft in the existing Scenario Planning screen for Compare with Live and Publish.

### S4-M6-3 — Strategy comparison and impact lab
- Runs all four presets against the same planning window, optional starting Draft/locks and the same hard rules.
- Compares new assignments, total draft allocated hours, shortage hours, projected cost and Tutor workload side by side, with a Review why action for each strategy.
- Choosing a strategy saves that proposal as a normal draft Scenario; it does not publish live allocations.


## Review fixes included in this updated archive
- Prevents partial existing coverage from causing a proposal to over-allocate a whole extra session.
- Counts carry-in coverage and aligns proposal shortage/cost/workload calculations with the existing Scenario comparison definitions.
- Rechecks explanations and manual changes against the complete draft, so a previously chosen Tutor is flagged if later draft edits create a clash or capacity failure.
- Keeps the chosen preset and the exact engine-generated Scenario item IDs in proposal metadata, so pre-existing manual items are not mislabeled as generated recommendations.
- Does not create an empty Scenario when proposal building fails before generation completes.
- Runs all strategy presets from one serializable comparison snapshot and rejects a starting Draft that changes mid-comparison.
- Adds optional Draft/lock selection, workload impact, explanation review links and direct generated-Scenario handoff in the Organiser UI.

## Main files added/updated
- `src/services/proposal-service.ts`
- `src/app.ts`
- `src/server.ts`
- `src/proposal-routes.test.ts`
- `frontend/src/api/proposals.js`
- `frontend/src/api/proposals.test.js`
- `frontend/src/features/ProposalLab.jsx`
- `frontend/src/features/ProposalLab.test.jsx`
- `frontend/src/features/ScenarioPlanning.jsx`
- `src/services/proposal-service.test.ts`
- `frontend/src/routes/RoleRouter.jsx`
- `frontend/src/components/organiser/OrganiserShell.jsx`
- `frontend/src/components/shared/destinations.js`

## Final workflow
1. Sign in as Organiser.
2. Open **Proposal lab**.
3. Choose a future planning window and a strategy, or compare all strategies.
4. Generate/save a proposal.
5. Review Why this Tutor?/Why not? and shortages.
6. If needed, make a reasoned eligible adjustment.
7. Open **Scenario planning**.
8. Compare with Live.
9. Publish only after the existing Scenario hard-rule/version checks pass.

## Verification note
The project dependencies were not fully available in the execution environment used to prepare this archive. `npm ci` timed out before dependencies were installed, so the complete repository `npm run check` gate could not be honestly reported as passing here. The changed TypeScript/JSX files were syntax-transpiled successfully, `git diff --check` passed for the reviewed files, and `node scripts/check-repository.mjs` passed. The final integration machine should still run the handbook gate before release:

```bash
npm ci
npm ci --prefix frontend
npm run generate
npm run check
npm run coverage
```

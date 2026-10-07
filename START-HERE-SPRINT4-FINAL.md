# Sprint 4 final code — Members 1 to 6

This archive starts from the supplied completed Members 1–5 code and adds the Sprint 4 Member 6 scope from the 30 September handbook.

## Member 6 completed scope

### S4-M6-1 — Whole-school explainable proposal engine
- Added an organiser-only proposal service and API.
- Uses existing open `StaffingRequirement` data and the existing allocation candidate/rule engine.
- Hard rules remain mark, schedule clash and selected-week capacity.
- Confirmed Student `TutoringBooking` rows are already included by the existing candidate clash query and therefore block proposal assignments.
- Existing Scenario items can be used as a base; existing/locked items are preserved and the engine fills remaining shortages rather than moving locks.
- Added deterministic presets: Balanced, Strongest Match, Fair Workload and Budget Aware.
- Generated output is saved as a normal DRAFT `Scenario`; it never writes directly to live `Allocation` rows.

### S4-M6-2 — Proposal cockpit and explanations
- Added `/organiser/proposals` and sidebar/command-palette navigation.
- Shows `Why this Tutor?` and `Why not?` explanations.
- Distinguishes hard-rule failures from lower soft-objective ranking.
- Supports an eligible manual Tutor adjustment only when current hard rules still pass and an organiser enters a reason.
- Proposal drafts hand off to the existing Scenario Planning screen for Compare with Live and Publish.

### S4-M6-3 — Strategy comparison and impact lab
- Runs all four presets against the same planning window and the same hard rules.
- Compares assignments, covered tutor-hours, shortage hours, projected added spend and workload.
- Choosing a strategy saves that proposal as a normal draft Scenario; it does not publish live allocations.

## Main files added/updated
- `src/services/proposal-service.ts`
- `src/app.ts`
- `src/server.ts`
- `src/proposal-routes.test.ts`
- `frontend/src/api/proposals.js`
- `frontend/src/api/proposals.test.js`
- `frontend/src/features/ProposalLab.jsx`
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
The project dependencies were not fully available in the execution environment used to prepare this archive. `npm ci` could not complete because the package registry was unavailable/too slow, so the complete repository `npm run check` gate could not be honestly reported as passing here. The final integration machine should run the handbook gate before release:

```bash
npm ci
npm ci --prefix frontend
npm run generate
npm run check
npm run coverage
```

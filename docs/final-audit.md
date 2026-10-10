# Final source audit - 10 October 2026

## Scope and evidence boundary

Audited the supplied `tutor-mx-system-main(7).zip` against all 18 Sprint 4 cards in the 30 September handbook and the supplied COMS3011A AI Policy (20 July 2026). The archive contained no original Git history; the remote main SHA, merges, deployed version and historic commit trailers cannot be certified from this upload. No remote branch was pushed or merged, and no production database or deployment was changed.

All 18 cards have implemented source paths and automated coverage. Concrete defects found in the final audit were repaired below. This is source-level completion with local validation; the handbook's live browser, stakeholder, remote CI/deployment and provenance sign-off still needs external evidence.

## Repairs made

1. **Proposal generation was not atomic.** Scenario creation, each assignment and metadata were previously separate transactions. Generation now evaluates and saves within one serializable transaction, reusing the Scenario service on the same connection. A late failure leaves neither a partial draft nor successful-change audit events.
2. **Manual proposal adjustment and its audit reason could diverge.** Eligibility recheck, versioned change and audit now commit together. Before/after assignment snapshots now survive the audit allowlist instead of being discarded as unrecognised scenario fields.
3. **Strategy saving could differ from the displayed comparison.** Comparison results carry a deterministic token. Saving a compared result rebuilds inside the write snapshot and refuses changed data with `PROPOSAL_COMPARISON_STALE`. Editing the UI planning inputs discards the old comparison. Final live publication remains explicit and rechecks all hard rules.
4. **Unfilled requirements lost their rejection explanations.** Shortages now retain per-candidate hard-rule reasons and expose them in the comparison and proposal cockpit. Equal-score explanations describe the mark/ID tie-break correctly; current eligible alternatives no longer falsely claim a lower score after a manual choice or changed data.
5. **Proposal palette/favourite navigation was broken.** Added the frontend destination ID to the backend's organiser-only allowlist; Student/Tutor requests still fail closed.
6. **The release README and AI disclosures were stale.** Removed partial member-start instructions; corrected confirmed team tools, retained transparent model/provenance gaps, and added policy requirements for code, writing, in-line editing, review and assessments.
7. **The security command required a Git checkout.** It now also scans an extracted source ZIP, while excluding dependencies/build output and still rejecting environment files/secrets. It verifies attribution structure rather than forcing the unsupported historical literal `Codex[GPT-5]`.

8. **Excused-history totals disagreed between proposal and Scenario views.** The proposal now preserves excused identities in the draft and uses the same historical cost/workload totals as Scenario Compare, while excluding unchanged excused rows from active coverage, clashes and selected-week usage. A migrated-database regression checks both a new proposal and reuse of an existing draft.

## Handbook traceability

Paths below are relative to the repository. “Covered” means implemented and exercised by local tests, not a claim of live deployment approval.

| Card | Implemented path / behavior | Main automated evidence |
| --- | --- | --- |
| S4-M1-1 | Shared Profile-owned TimeSlot with legacy SQL mapping; own Student/Tutor schedule and import; reused timetable UI | `navigation-targets.test.ts`, `tutor-routes.test.ts`, timetable import and MyTimetable tests; migration preserves Tutor rows |
| S4-M1-2 | Session generation guard, protected cache clearing, fresh-profile role validation and permission-checked targets | `frontend/src/auth/sessionState.test.js`, `useCurrentUser.test.jsx`, auth/route/navigation tests |
| S4-M1-3 | Actionable notification links; role-safe recent/favourite destination metadata | `navigation-targets.test.ts`, `NotificationBell.test.jsx`, `CommandPalette.test.jsx`; proposal destination regression added |
| S4-M2-1 | Separate Scenario/ScenarioItem storage, locks, live diff, explicit atomic Publish, protected history | `src/services/scenario-service.test.ts`, `ScenarioPlanning.test.jsx` |
| S4-M2-2 | Expected-version writes, expiring presence, metadata/duplicate/archive/reopen | Scenario lifecycle, stale-session and presence tests; authenticated independent-browser evidence remains external |
| S4-M2-3 | Shared recurrence/exception/break/busy intervals; privacy-safe bounded availability and discovery | `mutual-availability.test.ts`, scenario-service tests, `MutualAvailability.test.jsx` |
| S4-M3-1 | Tutor request/replacement decision/Organiser decision, current rule recheck, immutable swap history | `scheduling.test.ts`, `scheduling-routes.test.ts`, `SwapWorkspace.test.jsx` |
| S4-M3-2 | Transactional booking, retry identity, schedule guards, both calendar projections and clash integration | Migrated database booking tests; availability, booking and timetable frontend tests |
| S4-M3-3 | Participant-only booking detail/history, future cancellation, version conflicts and notification deduplication | `scheduling.test.ts`, `BookingPanel.test.jsx` |
| S4-M4-1 | StudentSickNote with own-booking checks, queue/review, future Excused versus past Skipped | Sick-note service/database/route tests and `StudentSickNotes.test.jsx` |
| S4-M4-2 | Conflict recovery, single persisted outcomes, replay receipts and notification keys | Scheduling and overflow competing-operation tests; UI conflict tests; deployed multi-session races remain external |
| S4-M4-3 | Compact mode, written timetable/heatmap views, responsive CSS, dialog focus/status announcements | `Sprint4Accessibility.test.jsx`, responsive tests and `ConfirmationDialog.test.jsx`; rendered widths/contrast are not certified here |
| S4-M5-1 | Shared allowlisted audit snapshots, transactional scenario/allocation/swap/booking/sick-note events, Command Centre timeline | Scheduling/audit route tests and `AuditTimeline.test.jsx`; proposal rollback/actor evidence added |
| S4-M5-2 | Historical allocation preview, expected version, fresh rule recheck and restore as a new audited identity | Migrated restore tests and `AllocationRestore.test.jsx` |
| S4-M5-3 | Bounded filters/export, CSV safety, exact fields, role/ownership checks and retry/conflict behavior | `audit-routes.test.ts`, `scheduling.test.ts`, hardening tests; `endpoint-role-matrix.md` |
| S4-M6-1 | Deterministic four-preset engine using shared eligibility and current draft/locks; draft-only output | `proposal-service.test.ts`; actual migrated Scenario generation/rollback/metrics tests added |
| S4-M6-2 | Hard-rule/soft-factor explanations, shortage reasons, eligible reasoned adjustments and Scenario handoff | Proposal backend/frontend tests; atomic reason and snapshot regressions added |
| S4-M6-3 | Same-snapshot preset comparison, coverage/cost/workload metrics, stale comparison guard | Proposal tests including changed-data refusal, deterministic ties, no solution, locks, budget pressure and week boundaries |

The existing Sprint 1–3/authentication/Master Organiser, import, timesheet/payroll, overflow, reporting and holiday fallback suites remain in the full gate. Existing migration files were not rewritten; no new schema migration was needed for these repairs.

## Validation

Final command results and coverage figures are recorded below after completion. Logs in `docs/evidence/final-audit/` are from this audit only; older evidence directories are historical and do not establish current deployment status.

- Full `npm run check`: passed (Prisma generation, backend/frontend lint, typecheck, both suites, both production builds and security check). The captured complete run has 1,465 backend and 847 frontend tests.
- After the last excused-history correction: backend lint, typecheck, **1,466 backend tests in 52 files with coverage**, backend build and security check passed again. The unchanged frontend retains **847 passing tests in 77 files**. No earlier frontend work was repeated.
- Backend coverage: **92.00% statements / 86.59% branches / 96.15% functions / 92.69% lines**. All configured thresholds passed unchanged.
- Frontend coverage generated: **84.70% statements / 79.89% branches / 83.95% functions / 87.60% lines**. Figures are from the generated HTML and LCOV reports; no new frontend thresholds were imposed.
- Node 24.19.0; npm 11.9.0. Existing lockfiles were preserved; no new runtime dependency was added.
- Evidence: `check.txt`, `backend-final.txt`, both LCOV files and `validation-summary.json` in the final-audit evidence directory.

The frontend build's bundle-size warning is non-fatal; no warning threshold was suppressed. Browser installation failed because the supplied download was not a valid ZIP; see the browser-install evidence. No rendered screenshot/contrast or authenticated browser success is claimed.

PGlite tests apply the actual PostgreSQL migrations and exercise transactions and database guards. PGlite serializes its connection; these tests do not prove independent Neon-connection race behavior. Use the configured test-environment browser procedure for external confirmation.

## Files removed and installation

The obsolete Sprint 4 Markdown notes below are absent from this archive. The useful endpoint matrix and browser procedure were retained as `docs/endpoint-role-matrix.md` and `docs/browser-verification.md`.

Copy the source into your existing checkout without replacing `.git` or private environment files. Extracting over a Windows folder does not remove old files. From the repository root, run:

```powershell
.\scripts\cleanup-obsolete-notes.ps1
npm ci
npm ci --prefix frontend
npm run check
npm run coverage
git status
```

The cleanup script removes only the explicit obsolete Markdown paths; `-WhatIf` previews them. Review the resulting changes, fill verified AI attribution before committing, and use the normal approved-main deployment workflow. Apply existing pending migrations with `npm run db:migrate` using the intended direct database URL. Do not reset or reseed an existing production database.

- `MEMBER6-SPRINT4-REVIEW.md`
- `START-HERE-SPRINT4-FINAL.md`
- `START-HERE-SPRINT4-MEMBER1.md`
- `START-HERE-SPRINT4-MEMBERS1-AND2.md`
- `START-HERE-SPRINT4-MEMBERS1-TO3.md`
- `START-HERE-SPRINT4-MEMBERS1-TO4.md`
- `START-HERE-SPRINT4-MEMBERS1-TO5.md`
- `docs/sprint4-member1-changed-files.md`
- `docs/sprint4-member1-handoff.md`
- `docs/sprint4-member2-changed-files.md`
- `docs/sprint4-member2-handoff.md`
- `docs/sprint4-member3-changed-files.md`
- `docs/sprint4-member3-handoff.md`
- `docs/sprint4-member4-browser-checks.md`
- `docs/sprint4-member4-changed-files.md`
- `docs/sprint4-member4-handoff.md`
- `docs/sprint4-member5-changed-files.md`
- `docs/sprint4-member5-endpoint-role-matrix.md`
- `docs/sprint4-member5-handoff.md`

## Remaining external evidence

- Actual ChatGPT model(s), each member's Qoder model/Auto setting and in-line/review use, original Assisted-by trailers and assessment transcript evidence. See `AI_DECLARATION.md`; do not label the attribution fully compliant until these are verified.
- Final Gitea SHA/CI/Codecov, production Neon migration status, Render health/readiness and Cloudflare deployment alignment.
- Real Student/Tutor/Organiser/Master Organiser smoke checks, independent-browser races, responsive screenshots/keyboard/contrast review and stakeholder acceptance.

The preceding document was generated and reviewed with ChatGPT's Codex coding agent[exact underlying model not exposed in this session].

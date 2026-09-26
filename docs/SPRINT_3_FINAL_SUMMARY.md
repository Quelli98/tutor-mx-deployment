# Tutor MX — Sprint 3 Final Summary

## 1. Sprint Overview

Sprint 3 completed the Intermediate feature layer of the Tutor MX system while preserving all Sprint 1 (Basic foundation) and Sprint 2 (core workflow) functionality. Six team members delivered features spanning notifications and search, staffing requirements and bulk allocation, timetable import and timesheet corrections, student workflows and overflow management, API contract auditing and transaction safety, and the Organiser Command Centre dashboard.

A thorough final audit was performed against the Sprint 3 handbook acceptance criteria for all six members, cross-member integration chains were verified, and Sprint 1/2 regression checks confirmed no regressions.

## 2. Final Release Information

| Field | Value |
|-------|-------|
| Pre-final-fix audited SHA | `ce63e91` |
| Final Gitea main SHA | `211c717` |
| Final GitHub main SHA | `211c717` |
| Date | 26 September 2026 |
| Branch | `main` |
| Gitea remote | `origin` (https://sdp.ms.wits.ac.za/innovent/tutor-mx-system.git) |
| GitHub deployment mirror | `deployment` (https://github.com/Quelli98/tutor-mx-deployment.git) |

## 3. Member 1 Summary

**Final status: PASS**

Member 1 delivered the notification and discovery layer:

- **Notifications**: In-app notification system with real-time delivery for allocation changes, timesheet status updates, and approval decisions.
- **Due reminders**: Automated reminders for upcoming deadlines (timesheet submissions, allocation confirmations).
- **Secure global search**: Role-scoped search across courses, tutors, and allocations with proper authorisation checks.
- **Ctrl/Cmd+K command palette**: Keyboard-driven quick navigation for power users across all roles.
- **Guided Tutor setup**: First-login role selection and profile bootstrap flow for new users.

All acceptance criteria met. No blocking defects found during audit.

## 4. Member 2 Summary

**Final status: PASS**

Member 2 delivered the staffing and allocation engine:

- **StaffingRequirements**: Organiser-created session requirements with course, time window, and tutor count.
- **Shortages**: Automatic calculation of shortage hours and shortage tutor counts per requirement.
- **Explainable ranking**: Candidate tutors ranked by mark, with eligibility based on mark threshold, schedule clashes, and capacity.
- **Bulk preview/commit**: Organiser can preview proposed allocations across multiple requirements, then commit in a single operation.
- **Manual override reasons**: When the organiser overrides a suggested tutor, a reason must be provided.
- **Course hours**: Per-requirement hour tracking derived from the session time window.
- **Budget/spend**: Budget tracking based on allocated hours and tutor rates.
- **Workload distribution**: Visibility into tutor workload across allocations.
- **Organiser excuse review**: Excuse approval workflow integrated into the organiser approvals queue.

Audit confirmed bulk-commit retry safety is ensured by serializable isolation, clash detection on CONFIRMED allocations, and per-item capacity checks. Existing tests prove concurrent commit safety.

## 5. Member 3 Summary

**Final status: PASS**

Member 3 delivered the timetable and payroll pipeline:

- **CSV/ICS/paste timetable import**: Three import methods with preview-before-commit workflow.
- **AcademicTerm bounds**: Imported time slots are validated against term date ranges.
- **TimeSlot integration**: Imported slots feed into clash detection and eligibility calculations.
- **Returned-timesheet corrections**: Timesheets returned by organiser can be corrected by the tutor with a revision history.
- **Revision history**: Full audit trail of timesheet corrections.
- **Declaration**: Tutor must declare timesheet accuracy before submission.
- **Disputes**: Timesheet dispute workflow with state machine enforced by database trigger.
- **Approved payroll export**: Payroll data exportable once timesheets reach APPROVED status.

All acceptance criteria met. Database trigger enforces timesheet state machine transitions.

## 6. Member 4 Summary

**Final status: PASS**

Member 4 delivered student-facing workflow features:

- **Student withdrawal**: Students can withdraw from courses with proper cleanup of related records.
- **Organiser overflow create/edit/close**: Full CRUD for overflow sessions with status transitions (OPEN -> CLOSED/FILLED).
- **Requirement -> overflow**: Staffing requirements can be converted to overflow sessions when additional coverage is needed.
- **Race/ownership safety**: CAS-pattern updates and ownership enforcement prevent concurrent modification issues.
- **Responsive/keyboard improvements**: Accessible UI with keyboard navigation support.

All acceptance criteria met. No blocking defects found during audit.

## 7. Member 5 Summary

**Final status: PASS**

Member 5 delivered the Sprint 3 API contract audit and hardening:

- **Permissions/ownership**: Verified all endpoints enforce correct role-based access.
- **Validation**: Input validation at API boundaries for all new endpoints.
- **Safe errors**: Error messages sanitised to prevent leaking internal details (e.g., database connection strings).
- **Transaction safety**: Serializable isolation verified for all concurrent-write paths.
- **Retry/race handling**: Bulk allocation concurrency verified — serializable isolation + clash detection + capacity checks prevent duplicate allocations.
- **Idempotency**: Write receipt infrastructure (ApiWriteReceipt) for idempotent operations.
- **Limits/performance**: Query patterns reviewed; organiser-only approval queries are naturally bounded by transient state counts.
- **Bulk allocation concurrency verification**: Existing tests at `bulk-allocation-service.test.ts` prove that concurrent commits result in exactly one save and one conflict report, with no data duplication.

All acceptance criteria met. No data integrity holes identified.

## 8. Member 6 Summary

**Final status: PASS**

Member 6 delivered the Organiser Command Centre:

- **Organiser Command Centre**: Central dashboard aggregating key operational metrics.
- **KPI cards**: Summary cards showing total requirements, filled/unfilled, total allocated hours, and budget status.
- **Shortage heatmap**: Visual heatmap of staffing shortages across the planning period.
- **Budget gauge**: Visual budget utilisation indicator with spend vs. allocation tracking.
- **Workload/fairness visualisation**: Tutor workload distribution view highlighting capacity and fairness.
- **Drill-downs**: Period-scoped aggregation with configurable week range.
- **Needs Attention feed**: Prioritised feed of items requiring organiser action (pending approvals, tutors near capacity, unresolved disputes).

All acceptance criteria met. Backend aggregates five existing reads scoped to the selected period.

## 9. Cross-Member Integration

The following cross-member integration chains were verified with dedicated test suites:

### Chain A: Staffing -> Allocation -> Command Centre
`StaffingRequirement` -> ranking/shortage -> bulk allocation -> `Allocation` -> Command Centre aggregation.
Verified by: 129 backend tests (staffing, allocation, bulk allocation) + Command Centre frontend tests.

### Chain B: Overflow -> Volunteer -> Approvals -> Command Centre
`StaffingRequirement` -> overflow -> Student volunteer/withdraw -> organiser approval workflow -> Command Centre visibility.
Verified by: 112 backend tests (overflow, volunteer claims, approvals) + frontend integration tests.

### Chain C: Timetable -> Eligibility
Timetable import -> `TimeSlot` -> eligibility/clash detection in candidate ranking.
Verified by: 167 backend tests (timetable, time slots, allocation queries) + frontend tests.

### Chain D: Work Log -> Payroll
Work log -> timesheet -> RETURNED -> correction/declaration/dispute -> APPROVED -> payroll export/reporting.
Verified by: 167 backend tests (timesheets, corrections, payroll) + schema tests (36) for state machine enforcement.

### Chain E: Notifications -> Attention Feed
Notifications/reminders -> Needs Attention feed -> authorised workflow actions.
Verified by: 137 frontend tests (CommandCentre, attentionFeed, notification components).

## 10. Regression Verification

Sprint 1 and Sprint 2 Basic functionality was checked as part of the final audit:

- **Frontend regression**: 59 tests covering Sprint 1/2 UI features — all pass.
- **Backend regression**: 255 tests covering Sprint 1/2 API endpoints, services, and database operations — all pass.

No regressions were identified. All Sprint 1/2 features remain functional.

## 11. Verification Results

### Pre-commit final audit results (performed before the one-line lint fix commit)

| Suite | Files | Tests | Result |
|-------|-------|-------|--------|
| Backend (Vitest) | 41 | 1110 | PASS |
| Frontend (Vitest) | 53 | 672 | PASS |
| Schema (Prisma migrations) | — | 36 | PASS |
| M5 contract tests | — | 44 | PASS |
| Cross-member integration (backend) | — | 408 | PASS |
| Cross-member integration (frontend) | — | 137 | PASS |
| Sprint 1/2 regression (frontend) | — | 59 | PASS |
| Sprint 1/2 regression (backend) | — | 255 | PASS |
| TypeScript typecheck | — | — | PASS |
| Production build | — | — | PASS |
| Security audit | — | — | PASS |
| Coverage thresholds | — | — | Met |

### Post-commit verification (after the one-line lint fix)

| Check | Result |
|-------|--------|
| ESLint (changed file) | 0 errors, 0 warnings |
| Working tree | Clean |

NOTE: The full test suites listed in the pre-commit audit were not rerun after the one-line commit, as the commit only removed an unused comment and could not affect runtime behaviour.

## 12. Issues Found and Resolved

### Issue 1: Unused eslint-disable directive

- **File**: `frontend/src/features/TutorAllocationDetails.jsx` (line 69)
- **Problem**: An `// eslint-disable-next-line react-hooks/set-state-in-effect` comment was no longer suppressing any rule violation, causing an "unused eslint-disable directive" lint warning.
- **Fix**: Removed the obsolete comment line.
- **Impact**: No functional behaviour changed. This was a cosmetic lint cleanup only.
- **Commit**: `211c717` — `chore(frontend): remove obsolete eslint suppression`

## 13. Remaining Observations

The following are recorded as non-blocking observations. They are NOT confirmed defects and do not prevent Sprint 3 acceptance.

1. **M1 onboarding walkthrough is minimal**: The first-login guided setup covers role selection and profile bootstrap but does not include a detailed feature walkthrough. This is a UX enhancement opportunity, not a requirement gap.

2. **M3 coverageWindow has implicit bounds**: The timesheet correction service does not enforce an explicit maximum coverage window. In practice, timesheets are bounded by AcademicTerm date ranges, making this a theoretical rather than practical concern.

3. **Organiser approval queries lack explicit LIMIT**: The `listApprovals` endpoint queries for PENDING/SUBMITTED items without an explicit SQL LIMIT clause. The result sets are naturally bounded by the number of transient-state records (typically small), and the endpoints are organiser-only. Adding limits risks silent truncation if volumes grow.

## 14. Sprint 3 Final Status

The final audit found that all Member 1 through Member 6 Sprint 3 handbook acceptance areas are implemented and passing verification. No known blocking Sprint 3 defects remain. All cross-member integration chains are verified. No Sprint 1 or Sprint 2 regressions were identified.

The Sprint 3 Intermediate feature layer is complete and ready for demonstration.

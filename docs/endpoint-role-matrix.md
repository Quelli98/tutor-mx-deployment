# Endpoint role and ownership matrix

All paths below require a verified bearer token and a currently permitted stored profile. Missing/invalid authentication is 401; wrong role or explicit forbidden action is 403. Authentication does not accept an actor ID from the body. ORGANISER includes existing Master Organiser access through the application's existing role model.

## Student timetable and booking

| Method and path | Role | Ownership / boundary | Conflict or retry strategy |
| --- | --- | --- | --- |
| GET `/api/me/time-slots` | STUDENT, TUTOR | Own schedule; bounded query window | Read only |
| POST `/api/me/time-slots` | STUDENT, TUTOR | Owner derived from authenticated subject; validated dates, type and recurrence | Existing schedule transaction/guards |
| PATCH `/api/me/time-slots/:timeSlotId` | STUDENT, TUTOR | Own editable slot; another owner's slot is non-revealing 404 | Fresh row and schedule validation |
| DELETE `/api/me/time-slots/:timeSlotId` | STUDENT, TUTOR | Own editable slot; another owner's slot is non-revealing 404 | Existing schedule transaction |
| POST `/api/me/time-slots/import/preview` | STUDENT, TUTOR | Own schedule; bounded import rows and validated academic term | Preview only |
| POST `/api/me/time-slots/import/commit` | STUDENT, TUTOR | Own schedule; revalidated preview/import data | Existing import identity/revalidation guards |
| GET `/api/student/tutoring-options` | STUDENT | Eligible tutoring discovery; does not expose private busy-event text | Read only |
| POST `/api/student/mutual-availability` | STUDENT | Validated tutor/course/term, dates, duration and daily bounds; current eligibility | Fresh availability search |
| GET `/api/me/bookings` | STUDENT, TUTOR | Only bookings where caller is Student or Tutor participant | 20 per page, page ≤10,000; calendar window ≤28 days and ≤500 sessions |
| POST `/api/student/bookings` | STUDENT | Student derived from subject; allowed exact fields and fresh shared availability | Required 8–128 character retry key, payload hash, unique receipt identity, schedule claims and transaction |
| GET `/api/me/bookings/:id` | STUDENT, TUTOR | Only participant; other callers receive non-revealing 404 | Read only; Tutor response excludes private sick-note records |
| POST `/api/me/bookings/:id/cancel` | STUDENT, TUTOR | Only participant; current eligible future booking; pending sick note blocks cancellation | Expected booking version; competing/stale state is 409 |
| POST `/api/student/bookings/:id/sick-notes` | STUDENT | Own eligible booking, exact fields and bounded required reason | Booking version + optional retry key; booking lock; duplicate pending note prevented |
| GET `/api/organiser/student-sick-notes` | ORGANISER | Review queue, including private reasons for authorised reviewers | 20 per page; page ≤10,000 |
| POST `/api/organiser/student-sick-notes/:id/decision` | ORGANISER | Valid pending note/booking; review note required for rejection | Note + booking versions, optional retry key, booking-first lock; one decision |

Existing `/api/tutor/time-slots` and import aliases retain the same established schedule handler rules. Student clients use `/api/me/...`. Field allowlists, positive integer IDs, bounded text and ISO instant validation remain in the corresponding route/service parsers; this matrix does not introduce new payload fields to older schedule APIs.

## Scenario and swap

| Method and path | Role | Ownership / boundary | Conflict or retry strategy |
| --- | --- | --- | --- |
| GET `/api/organiser/scenarios` | ORGANISER | Allowed status filter | Read only |
| POST `/api/organiser/scenarios` | ORGANISER | Validated scenario name/window | Transaction; shared audit |
| GET `/api/organiser/scenarios/:scenarioId` | ORGANISER | Existing scenario | Read only |
| GET `/api/organiser/scenarios/:scenarioId/compare` | ORGANISER | Existing scenario versus current live plan | Read only |
| POST `/api/organiser/scenarios/:scenarioId/presence` | ORGANISER | Current actor identity; advisory presence | Heartbeat, not an audit mutation |
| POST `/api/organiser/scenarios/:scenarioId/actions` | ORGANISER | Valid action/item fields, immutable published state, current allocation rules | Expected scenario version, lock/publish rechecks and atomic audit |
| GET `/api/swaps` | TUTOR, ORGANISER | Tutor sees related swaps; Organiser sees review queue | Existing bounded pagination |
| GET `/api/swaps/:id` | TUTOR, ORGANISER | Tutor must be source/replacement participant; unrelated records hidden | Read only |
| GET `/api/tutor/allocations/:id/replacements` | TUTOR | Source Tutor owns the allocation; eligibility-filtered candidates | Current revision/eligibility |
| POST `/api/tutor/swaps` | TUTOR | Source Tutor owns eligible allocation | Revision and pending-swap safeguards; transactional audit |
| POST `/api/swaps/:id/actions` | TUTOR, ORGANISER | Action-specific participant/reviewer role; Tutor cannot approve as Organiser | Expected version and legal-state checks; approval rechecks eligibility and atomically replaces allocation |

## Audit and restore

| Method and path | Role | Ownership / boundary | Conflict or retry strategy |
| --- | --- | --- | --- |
| GET `/api/organiser/audit` | ORGANISER | Allowlisted filters; default 90 days, maximum 366; 50 rows/page, page ≤10,000 | Read only, re-redacted snapshots |
| GET `/api/organiser/audit/export` | ORGANISER | Same filters/redaction; ≤1,000 rows and ≤5 MB; safe CSV cells | Read only; 422 when filters are too broad |
| GET `/api/organiser/audit/:id` | ORGANISER | Positive ID; absent event is 404 | Read only |
| GET `/api/organiser/allocations/:id/history` | ORGANISER | Existing allocation; latest 100 matching audit events | Read only |
| POST `/api/organiser/allocations/:id/restore-preview` | ORGANISER | Exact eventId/side; event must describe selected allocation | Fresh rule assessment and expected version returned |
| POST `/api/organiser/allocations/:id/restore` | ORGANISER | Exact eventId/side/expectedVersion/reason; current and historical eligibility | Source lock + version; fresh mark/clash/capacity checks; replacement identity and audit commit together |

Audit/history access is not available to Students or Tutors. Restore never accepts a caller-supplied snapshot as historical truth.

## Error and evidence mapping

| Status | Meaning / focused checks |
| --- | --- |
| 400 | Invalid fields, IDs, dates, bounds or retry keys. Service tests exercise real validation; route tests exercise safe status mapping. |
| 401 | No valid bearer identity. `audit-routes.test.ts` covers all six new routes and 26 existing Sprint 4 routes. |
| 403 | Wrong/stale role or forbidden action. Fresh-profile downgrade, all six audit/restore routes and the existing-route matrix are covered. |
| 404 | Missing/unowned resource without exposing another user's data. Existing tutor/Student and scheduling suites cover ownership; new history/audit tests cover missing or mismatched targets. |
| 409 | Stale versions, changed retry payload, unavailable booking, duplicate/terminal decision, invalid restore rule or competing mutation. No extra persisted outcome is expected. |
| 422 | Oversized bounded calendar/export result; narrow the request. |
| 503 | Required service unavailable; new routes fail closed. |
| 500 | Unexpected error is sanitized; raw SQL/private exception detail is not sent. |

`src/audit-routes.test.ts` checks authentication, role matrix and safe route contracts. `src/services/scheduling.test.ts` uses migrated PGlite storage for real ownership, state transitions, retry/competing-request outcomes, audit redaction and rollback. `src/tutor-routes.test.ts`, `src/scheduling-routes.test.ts`, `src/planning-routes.test.ts`, `src/services/timetable-import-service.test.ts` and `src/services/student-workflows.test.ts` provide focused existing-contract coverage. UI tests cover applied filters/export, before/after detail, blocked preview, explicit reason/confirmation, selection changes and stale recovery.

These are local focused checks, not live Auth0 validation or proof of independent Neon connection races. See the handoff for results and remaining integration checks.

The preceding document was reviewed and edited with ChatGPT's Codex coding agent[exact underlying model not exposed in this session]; inherited attribution requires verification in AI_DECLARATION.md.

## Proposal intelligence

All proposal routes require ORGANISER and a fresh stored profile. Student/Tutor access is forbidden.

| Method and path | Purpose / boundary |
| --- | --- |
| POST `/api/organiser/proposals/preview` | Read-only deterministic proposal for a future window up to 28 days |
| POST `/api/organiser/proposals/compare` | Four strategies in one serializable snapshot; each result includes a comparisonToken |
| POST `/api/organiser/proposals/generate` | Atomically creates/duplicates a draft, adds proposed items and metadata/audit; never publishes live |
| GET `/api/organiser/proposals/:id/explanations` | Current hard rules and soft factors for generated assignments |
| POST `/api/organiser/proposals/:id/adjust` | Expected scenario version, eligible replacement, unlocked item and required reason; change/audit commit together |

Preview/generate accept name, startsAt, endsAt, preset and optional baseScenarioId. Compare omits preset. Saving a compared strategy also sends its comparisonToken; changed input data returns 409 PROPOSAL_COMPARISON_STALE before any draft is persisted. Plain generation has no comparison prerequisite. Every proposal remains subject to a fresh Compare with Live and explicit Publish in Scenario planning.

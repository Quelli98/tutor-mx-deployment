# Sprint 4 Member 5 handoff

Date: 5 October 2026. Branch: `s4/m5/completion`. Base: delivered Members 1–4 source. Scope: handbook S4-M5-1, S4-M5-2 and S4-M5-3; integration/release remains with the Integration Lead.

## Acceptance mapping

| Card | Delivered | Focused evidence |
| --- | --- | --- |
| S4-M5-1 | AuditEvent schema, shared allowlisted snapshots/redaction, mutation instrumentation, Command centre timeline and detail | `scheduling.test.ts`, `scenario-service.test.ts`, `organiser-service.test.ts`, `audit-routes.test.ts`, `AuditTimeline.test.jsx` |
| S4-M5-2 | Allocation history, preview and versioned restore API/UI; immutable history and replacement allocation | Restore success, stale state, marks, clashes, capacity, protected history, permission and injected-rollback checks in `scheduling.test.ts`; preview/confirmation/conflict UI tests |
| S4-M5-3 | Audit filters and CSV, endpoint role/ownership matrix, sick-note retry receipts, retained booking retry/version safeguards | Focused route/service tests, retry-key API tests, existing timetable/booking/sick-note competing-request tests |

## Storage and transaction rules

Apply migration `20261011000000_s4_audit_restore` before using this code. It adds AuditEvent, MutationReceipt, Allocation.version and Allocation.minimumMark. Allocation updates increment the version through a database trigger. Audit UPDATE/DELETE are blocked by the immutable-history trigger.

Audit writes use the same transaction as their domain changes and notifications. The event becomes visible only when the whole transaction commits. A failure rolls back the mutation and audit together. This avoids a committed change followed by a failed separate audit insert.

Instrumentation covers scenario creation/duplication/deletion/edit/lock/publish and publish allocation changes; ordinary allocation create/update/cancel; swap transitions and replacement allocations; booking creation/cancellation/attendance status; Student sick-note submission/decision; timesheet approval/return; and allocation restore. Presence heartbeats are excluded. Existing historical domain events are retained, but are not backfilled into fabricated audit snapshots.

Snapshots use explicit target-specific allowlists. Raw request bodies, tokens and Student sick-note reasons/review notes are not copied to AuditEvent. Operational allocation, swap, timesheet and restore reasons remain where appropriate, with bounded redaction. Actor identity comes from the authenticated subject and fresh stored profile. Actor ID is historical; displayed actor name is the current profile name. Readers reapply redaction as well.

## Audit API and UI

All six new endpoints require ORGANISER, checked at the route and service layers. See the role matrix for request paths.

List/export accept `from`, `to`, `actorId`, `action`, `targetType`, `targetId`, `page`. Times are ISO instants; the interval includes `from` and excludes `to`. The UI accepts South African local date/time. Default range is 90 days, maximum 366 days. List pages contain 50 events, ordered by time then ID descending; page is bounded to 1–10,000. Target types are allocation, scenario, swap, booking, sick-note and timesheet. Action is an uppercase action identifier, not arbitrary query text.

Export applies the same filters and redaction, across matching pages. It returns `{data: {filename, csv, count}}`; the frontend downloads a CSV Blob. At most 1,000 events and 5,000,000 UTF-8 bytes are allowed. Cells are quoted, embedded quotes escaped, and formula-leading values protected. Oversize export returns 422 with instructions to narrow filters. Timeline request sequencing prevents a slow earlier result replacing a newer selection.

## Restore contract

History returns the latest 100 allocation audit events. Preview body: `{eventId, side}` where side is `before` or `after`. Restore body: `{eventId, side, expectedVersion, reason}`. Reason is required and bounded to 1,000 characters. The UI cannot confirm without a successful preview, and changing the historical selection clears that preview.

Only a valid PROPOSED/CONFIRMED audited snapshot of the selected allocation is eligible. Current and historical sessions must be future sessions. Existing work logs, excuses, overflow work, swap history or a previous restore of that source protect the old allocation from restoration. Restore locks the source, checks its version, reloads the history and reruns current eligibility, busy/class/booking clashes and capacity rules. The mark threshold is at least 50 and at least both the historical and current persisted thresholds.

The old allocation is cancelled and a new allocation is created with the selected values. Old events are never edited. The source event records the replacement ID; the replacement event records the source allocation, selected audit event and selected side. Tutor notifications and both audit events commit in that transaction. Follow the new allocation for future corrections: an already restored source cannot be cloned repeatedly. A stale or invalid restore returns 409 and requires another preview.

Legacy minimum-mark limitation: old allocations default to 50 because the earlier schema did not persist custom choices. No claim is made to reconstruct those choices. New ordinary, scenario, swap and restore allocation writes now persist the threshold.

## Student mutation hardening

Existing booking creation retains a required retry key, normalized payload hash, participant schedule claims and transactional availability checks. Cancellation retains expected-version protection. Existing schedule/import contracts and ownership rules are preserved and included in the focused route matrix.

Sick-note submission and decision now accept optional `requestKey` (8–128 letters, digits, underscore or hyphen). The frontend retains the same key while retrying a failed response. Receipts are scoped to actor, operation and resource, and store a payload hash rather than private content. A committed same-key/same-payload retry returns the existing result without extra audit events or notifications. A changed payload conflicts. Older clients remain supported through booking/note version checks. Booking-first lock order is shared by submission, cancellation and decision. Receipts roll back with failed mutations.

## Verification

| Evidence | Result |
| --- | --- |
| `focused-backend-tests.txt` | Nine files, 385 passing tests; includes audit, planning, scheduling, tutor and Student contracts |
| `final-service-tests.txt` | Final affected three service files, 162 passing tests, after threshold/provenance changes |
| `frontend-results.json` and `frontend-tests.txt` | Five files, 53 passing tests, zero failures |
| `generate.txt`, `typecheck.txt`, `lint.txt`, `build.txt` | Passed; build retains the existing large-bundle advisory |
| `security.txt` | Tracked-file secret and attribution scan passed |

Service tests use PGlite with project migrations. Competing requests assert one legal persisted outcome and no duplicate decisions/audit effects, but this is not evidence of two independent PostgreSQL/Neon connections racing. Rollback tests inject a failure after mutation work and verify restoration of domain/audit/notification state. Route tests use controlled authentication fixtures; they are not live Auth0 tests.

Historical initial failure logs are labelled `initial-*`; corrected code passed the later runs above. Previous members' evidence remains historical, not a claim that their entire suites were rerun for Member 5. No full release gate or new global coverage result is claimed.

## Integration follow-through

Merge into the team's up-to-date Members 1–4 base, review the changed-file manifest, apply migrations in a development database and run the team's configured CI. In a real browser, verify timeline filtering/export, preview comparison, keyboard confirmation and stale recovery in both normal and compact layouts. Use independent sessions/database connections for live competing booking, sick-note decision and restore checks. Verify real Auth0 profiles and private-note separation. Chromium was unavailable in the previous environment and its download failed; no new browser screenshots are claimed.

This workspace has no configured remote. No branch push, main merge, live database migration or deployment was performed. The Integration Lead owns final review, release checks and merge before Member 6 continues.

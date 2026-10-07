# Sprint 4 Member 3 handoff

Prepared 4 October 2026. Added to the delivered Members 1–2 source using Member 3's allocation in the updated 30 September handbook, page 37. The previous implementations and evidence remain included. This source is intended for `s4/m3/completion`, with integration review before merging to main.

## Acceptance mapping

| Handbook card | Implementation | Verification |
| --- | --- | --- |
| S4-M3-1: propose a future replacement | TutorSwap storage, one-active-request index, owned-allocation options/proposal API, Tutor swaps screen | Own-session permission checks, duplicate active request, stale preview and unchanged live allocations tested |
| S4-M3-1: replacement decision | Only requester/replacement/Organiser can read a swap; only the addressed replacement can accept/decline | Outsider list/detail and decision-denial tests; frontend role/state controls |
| S4-M3-1: final Organiser approval | Accepted request required; source revision, future/history restrictions and normal mark/clash/selected-week capacity rules rechecked in a serializable transaction | Changed mark, capacity, BUSY schedule, booking and allocation tests; competing approve/cancel; stale organiser decision |
| S4-M3-1: preview/history/notifications | Stored before/after session and weekly workload preview; immutable REQUESTED/ACCEPTED/DECLINED/APPROVED/REJECTED/CANCELLED events; targeted notifications | Preview safe-field test, complete approval/cancellation/rejection histories, notification counts and immutable-event trigger tests |
| S4-M3-2: real Student booking | TutoringBooking remains separate from Allocation and payroll; Book this time confirmation calls protected server service | Confirmation boundary, safe payload, own identity, idempotent retry and no Allocation changes tested |
| S4-M3-2: availability and races | Member 2 matching service re-used inside write transaction; both participant schedules locked; database overlap guards; confirmed bookings added to normal allocation candidate checks | Two competing Students, same Student/different Tutor, direct conflicting SQL insert/confirmation, recurrence/term/break/mark changes, exact duration/boundary tests |
| S4-M3-2: both calendars/privacy | Week-bounded owned booking projection merged into shared MyTimetable/WeeklySchedule; no second calendar engine | Student and Tutor calendar component tests, next-week fetch, outsider/Organiser booking denial, safe result fields |
| S4-M3-3: details/cancel/history | Paginated own list, fresh detail/history, explicit future cancellation confirmation, version check and automatic conflict refresh | Start-boundary cancellation, outsider/stale/repeat-click tests; cancellation frees interval without deleting booking/history |
| S4-M3-3: notifications | One confirm/cancel notification per participant and outcome; existing inbox and fresh navigation resolver | Event-key de-duplication, ownership resolution and same-screen detail-target refresh tested |

## API catalogue

All routes use the existing bearer-token middleware and authoritative profile role check. Services also re-read the authenticated profile's current role. Callers cannot choose an acting Student/Tutor/Organiser ID. Success uses `{data: ...}`; errors use the existing `{error:{code,message}}` format.

| Method | Endpoint | Access / input |
| --- | --- | --- |
| GET | `/api/me/bookings?page=1` | Student/Tutor's own appointments, 20 per page, upcoming first; `{items,page,hasMore}` |
| GET | `/api/me/bookings?startsAt=...&endsAt=...` | Own active calendar entries overlapping a window of at most 28 days, maximum 500 |
| GET | `/api/me/bookings/:id` | Participant only; `{booking,history,canCancel}` |
| POST | `/api/student/bookings` | Student; `{tutorId,courseId,termId,startsAt,endsAt,requestKey}` |
| POST | `/api/me/bookings/:id/cancel` | Participant; `{version,note?}` |
| GET | `/api/swaps?page=1` | Tutor's own requests/invitations, or Organiser's decision list; 20 per page, active first |
| GET | `/api/swaps/:id` | Involved Tutor or Organiser; `{swap,history}` |
| GET | `/api/tutor/allocations/:id/replacements` | Allocation's Tutor; safe eligible choices, source revision and hour/calendar preview |
| POST | `/api/tutor/swaps` | Tutor; `{allocationId,replacementId,allocationRevision,reason}` |
| POST | `/api/swaps/:id/actions` | `{action,version,note?}`; action is accept, decline, approve, reject or cancel, subject to state and ownership |

IDs are positive integers. Timestamps need an explicit time-zone offset. Decision/cancellation notes are up to 1,000 characters; a proposal reason is required. Extra mutation fields are rejected.

Important conflicts include `SCHEDULING_STALE`, `BOOKING_UNAVAILABLE`, `BOOKING_STARTED`, `SWAP_SOURCE_CHANGED`, `SWAP_INELIGIBLE`, `SWAP_ACTION_UNAVAILABLE` and transaction/constraint `PLANNING_CONFLICT`. They return 409. Clients refresh server truth and ask for an intentional retry, never silently overwrite a decision.

## Defined rules and data model

### Tutor swaps

- Source must be the signed-in Tutor's future CONFIRMED Allocation, without WorkLog, Excuse or OverflowWork history. One active REQUESTED/ACCEPTED request is allowed per allocation.
- Replacement choices use existing allocation ranking with the normal 50% eligibility threshold, BUSY recurrence/exceptions, confirmed allocations, bookings and selected-week capacity. Only eligible choices are returned to Tutors; other Tutors' marks, private BUSY labels and detailed conflicts are not returned.
- The source allocation hash includes identity, Tutor/course, time, hours, status, updatedAt and history protection. A changed source requires a fresh proposal/decision; acceptance never authorizes approval of a later changed allocation.
- REQUESTED can become ACCEPTED/DECLINED by the replacement; REQUESTED/ACCEPTED can become CANCELLED by the requester or REJECTED by an Organiser. Only ACCEPTED can become APPROVED by an Organiser.
- Creation and acceptance do not modify live allocations. Approval cancels the old identity and creates/confirms a new replacement allocation with reviewer audit, all in one transaction. It never rewrites the Tutor on historical payroll/attendance records.
- Preview hours and calendar times are saved with the proposal. They are labelled as a creation-time preview; acceptance and approval recheck current rules. The original and replacement Tutors retain request history.
- SwapEvent is append-only with a unique swap/version key and a trigger rejecting updates/deletes. Request notifications go to the replacement; acceptance notifies both Tutors and Organisers; outcomes notify the two affected Tutors.

### Student bookings

- TutoringBooking stores Student, Tutor, course, academic term, startsAt, endsAt, status, occurrenceStatus, version, retry identity and timestamps. It does not consume the existing payroll allocated-hour limit or create an Allocation/WorkLog/Timesheet.
- Booking creation reuses Member 2's server-side matching for the exact selected interval inside the write transaction. Duration is 15–180 whole minutes, starts use 15-minute boundaries, and a published term must cover the session without a teaching break. Both parties' recurring schedules, moved/cancelled exceptions, existing bookings and relevant confirmed commitments are considered. Starts must be future and within the existing 180-day horizon.
- The search screen's daily-hour choices filter suggestions. The exact-interval booking check permits any daily hour that passes the actual term, duration and busy-time rules; it does not treat the default 08:00–18:00 search preference as an institutional rule.
- Half-open overlap rules permit touching boundaries. Another Student cannot claim the same Tutor/time, nor can one Student book overlapping Tutors. Cancellation immediately removes the interval from subsequent availability and active calendar projections.
- Only the Student/Tutor on the row can list/read/cancel it. Organiser is not a blanket permission to read private appointments in this member's API. The returned booking fields contain necessary participant names, course/time/status and history, never private timetable labels, authentication data, email, course budget or retry hashes.
- Either participant may cancel a CONFIRMED, SCHEDULED booking strictly before startsAt with the current version. At or after start, cancellation is rejected. Cancelled bookings are not deleted/reactivated. A stale/repeated cancellation conflicts and the UI refreshes.
- A create retry uses the existing client retry-key helper and a unique Student/requestKey row. Same key and same normalized payload returns the original booking; a changed payload with the same key conflicts. A transaction failure cannot leave a receipt, event or notification behind.
- BookingEvent is append-only with one event per booking/version. Exactly one confirmation/cancellation notification is inserted per affected participant, using a unique eventKey.

### Concurrency and integration

`PlanningStore` uses Prisma SERIALIZABLE transactions. Creation claims both Profile schedule revisions before its availability check. Database triggers serialize scheduling changes via those revision writes, reject overlapping active bookings, reject Allocation confirmation over an active booking, preserve booking identity and prevent deleting/reactivating booking history. Revisions are an internal concurrency counter, not a new user field. Failed serialization/constraints become safe conflicts, with retry after refresh.

Normal allocation ranking now includes confirmed, non-excused TutoringBooking intervals with a generic “Tutoring booking” label. No Student name or booking-private note is exposed through that clash projection. Scenario publication therefore reuses the same clash rule. The existing Member 2 availability adapter now reads the real booking table; its temporary-table test fixture was updated accordingly.

MyTimetable requests the selected calendar week and combines bookings with its existing allocation/manual/imported entries. It reloads when the displayed week changes, after cancellation and on window focus. A request sequence prevents an older week response replacing a newer one. The detail list is paginated independently of the calendar. Notification IDs are freshly resolved by the existing navigation endpoint and passed through router query state so a new target opens even on the same screen.

### Member 4 extension

`occurrenceStatus` is SCHEDULED by default and permits EXCUSED/SKIPPED for the next member. No StudentSickNote workflow is implemented here. Member 4 should link its request to the participant-owned TutoringBooking, preserve existing history, increment the booking version with the approved outcome, and exclude EXCUSED from active busy/calendar projections. Those projections already exclude EXCUSED and keep SKIPPED visible. Scheduling-only appointments remain separate from Tutor payroll allocations.

## Verification and evidence

- Full backend suite: **49 files / 1,343 tests passed**.
- Backend coverage: **91.04% statements, 86.04% branches, 95.44% functions, 92.02% lines**; configured 90/85/83/90 thresholds passed.
- Full frontend suite: **71 files / 814 tests passed**.
- After the same-screen notification-target improvement, the affected frontend suites were rerun in South African time: **6 files / 64 tests passed**, including one additional test. The delivered frontend now contains 815 tests; the full-run count above predates only this final test addition and targeted UI fix.
- Backend/Frontend lint, TypeScript typecheck and both production builds passed. Vite retains the existing large-bundle advisory.
- Migration-backed service checks cover competing requests, ownership, stale actions, cancellation timing, immutable history, database overlap guards, unchanged payroll allocations and notification counts. HTTP tests cover all nine new routes.
- The repository's tracked-file secret/attribution check is saved in `security.txt`.
- Raw evidence: `docs/evidence/s4-m3/`.

Database tests run against PGlite with the actual migrations and services. Its connection serializes concurrent transaction callbacks, so the competing-request tests establish legal outcomes and service rechecks; they do not claim a two-connection Neon load test. The database guards and serializable production adapter are present, but configured multi-connection/browser evidence remains a release check.

## Release checks in the configured app

1. Use two Tutor accounts and an Organiser. Propose a swap, verify no live change, accept with the replacement, then approve. Verify the old/new allocations, both Tutor calendars, immutable history and notifications. Repeat with decline, reject and cancel.
2. After acceptance, change the replacement's capacity/timetable or the source allocation in a second session. Approval must fail without partial changes. Race approve against requester cancellation and repeat a stale Organiser approval.
3. Use two Student browsers for the same Tutor/time. Confirm simultaneously; only one may succeed. Repeat for one Student attempting overlapping bookings with different Tutors. Inspect persisted rows and notification counts.
4. Open both participants' calendars and booking history. Cancel before start, confirm both calendars refresh and the interval can be booked again. At/after start, cancellation must fail. Repeat a stale cancellation and a dropped-response create retry.
5. Open booking/swap notifications while already on the destination screen. Verify the correct details open. Check other participants cannot fetch those IDs and returned payloads contain no private timetable labels.
6. Capture desktop/mobile screenshots and keyboard confirmation/focus behavior. Run final Gitea CI, apply migrations, deploy backend then frontend, and verify Auth0 and health/readiness.

No live database, real Auth0 browser session, remote repository push/merge or production deployment was used for this source delivery. The next member should begin only after integration review/merge of Member 3.

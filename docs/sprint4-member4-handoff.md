# Sprint 4 Member 4 handoff

Prepared 5 October 2026, continuing Members 1–3 without rebuilding their workflows. Scope comes from the updated 30 September handbook, page 38. Integration target: `s4/m4/completion`; Integration Lead review precedes any main merge.

## Acceptance mapping

| Card | Implementation | Evidence / status |
| --- | --- | --- |
| S4-M4-1 owned eligible Student sick note | StudentSickNote table, authenticated submit API, booking-row ownership and state checks, required reason, one pending request per booking | Migration-backed service tests pass |
| S4-M4-1 Organiser decisions | Student queue within existing Approvals, review notes, approve/reject dialog, pagination, pending totals | API role tests and UI tests pass; Tutor Excuse workflow preserved |
| S4-M4-1 absence semantics | Approval instant before start → EXCUSED; at/after start → SKIPPED; rejection → SCHEDULED | Boundary, history, calendar and released-time rebooking tests pass |
| S4-M4-1 privacy and notifications | Private reason/review note only in Student-owned detail and Organiser queue; generic participant events; transaction notifications | Ownership, privacy and notification-count tests pass |
| S4-M4-2 competing actions | Same booking lock order, version checks, SERIALIZABLE adapter, pending cancellation guard, immutable reviewed notes | Report/cancel in both orders and two Organiser decisions pass using PGlite; real two-connection/browser execution pending |
| S4-M4-2 stale UI/focus | Shared ConflictNotice; stable dialog return-focus target; stale actions disappear after refresh; failed refresh cannot claim success | Booking, swap and sick-note UI regression tests pass |
| S4-M4-2 overflow/browser races | Existing overflow behavior retained; configured browser audit includes approve-versus-withdraw alongside booking and sick-note races | Browser runner supplied and syntax checked; not executed because Chromium download failed |
| S4-M4-3 alternatives/compact mode | Timetable list derives from the same scheduleForWeek blocks; shell-level compact mode; existing heatmap list, budget labels, scenario and proposal tables retained | Keyboard/list/content tests pass; rendered phone/tablet/desktop audit pending |
| S4-M4-3 responsive/contrast | Wrapping controls and long text, constrained dialogs/inputs, preserved local table scrolling; Student/Tutor primary buttons use Organiser navy | Source and contrast checks recorded; no browser screenshot or whole-app accessibility certification claimed |

## State and privacy rules

Student submission requires their own CONFIRMED/SCHEDULED booking and the current bookingVersion. There is no arbitrary retrospective cutoff: a still-scheduled past booking can be reported and an approval records SKIPPED. A pending request blocks cancellation; an Organiser must first decide it. Rejection permits a new report or, while future, normal participant cancellation. Approval is terminal for the booking's attendance. These rules are shown in the Student form.

Every submission/review increments the booking version and appends a generic BookingEvent. Private illness reasons and review notes are never copied into that participant-shared event history. StudentSickNote retains the original reason, decision, reviewer/time and review note; triggers reject deletion or rewriting reviewed records. Requests have one active PENDING row per booking, enforced by a partial unique index. The booking guard prevents cancelling/changing attendance around an unresolved note and prevents rewriting a completed attendance outcome.

Submission notifies Organisers. Decision notifies the Student; only approval sends the Tutor a generic attendance-change notification. Notification writes are in the same transaction as the state change and use the existing unique event-key convention. No unrelated notification display behavior was rewritten without a reproduced defect. The existing permission-checked navigation resolves Student outcomes to booking details and Organiser requests to Approvals.

Student approval timing deliberately uses the actual start instant, as required for the new booking workflow. The existing Tutor Excuse day-based rules are unchanged. Shared note validation, event/notification helpers, attendance labels/styles, approval card patterns and ConfirmationDialog are reused.

## API additions

| Method | Endpoint | Role / input |
| --- | --- | --- |
| POST | `/api/student/bookings/:id/sick-notes` | STUDENT; `{ bookingVersion, reason }` |
| GET | `/api/organiser/student-sick-notes?page=1` | ORGANISER; pages of 20, pending first, then reviewed history |
| POST | `/api/organiser/student-sick-notes/:id/decision` | ORGANISER; `{ version, bookingVersion, decision: "APPROVED" or "REJECTED", reviewNote }` |

All routes use bearer authentication and the existing fresh-profile role check. Services independently check the current database role. Unknown input fields are rejected; notes have a 1,000-character limit and rejection requires a nonblank review note. Missing/unowned bookings return a safe 404; stale actions return 409. No Student ID supplied by a client is trusted.

`GET /api/me/bookings/:id` now includes `sickNotePending`, `canSubmitSickNote`, adjusted `canCancel`, and (Student owner only) `sickNotes`. Tutor responses omit the private note collection. List/calendar contracts remain compatible. Master Organisers retain the existing Organiser permission mapping.

## Concurrency and UI recovery

Submit/cancel/review lock the booking first. Reviews then lock the request and recheck both versions. Two decisions or report-versus-cancel yield one legal committed transition. PostgreSQL serialization/constraint errors continue through the existing safe conflict mapper. Notifications/events roll back with the mutation.

Reproduced recovery defects: BookingPanel and SwapWorkspace previously swallowed failed detail refreshes, then claimed the latest state had loaded. They now propagate that failure, remove stale details/actions, and accurately report the failed refresh. The shared conflict notice announces and focuses the message. ConfirmationDialog can return focus to a stable heading when a successful action removes its trigger. Booking, booking-search, swap and Student sick-note dialogs use that fallback.

PGlite tests apply every real migration and run actual services. Its transaction callbacks serialize on one connection; those results establish state rules and duplicate protection, not simultaneous two-connection Neon behavior. The production adapter is SERIALIZABLE, but real-browser/multi-connection evidence must still be collected.

## Accessibility and visual alternatives

The shared WeeklySchedule list uses exactly the same projected blocks as the calendar, including recurrence, exceptions, time clipping and attendance labels. Its checkbox is keyboard reachable and the inactive calendar is hidden from the accessibility tree. Compact mode changes spacing only; it does not remove data, controls or status text. Buttons retain a minimum 44px height. The mode applies across Student/Tutor/Organiser shells, including dense Approvals and planning views.

Existing Command Centre heatmap written tables, budget metric labels, scenario comparison/budget/difference tables and swap before/after tables remain available. No Member 5 audit feature was fabricated. Long notes/names wrap, review textareas remain within cards, dialogs scroll vertically, and wide calendars/tables use their existing local scroll regions. Student/Tutor primary button text now uses the same high-contrast navy background as Organiser actions.

## Verification

- Full backend: 49 files, **1,361 tests passed**.
- Backend coverage: **91.21% statements / 86.21% branches / 95.43% functions / 92.07% lines**, above the configured 90/85/83/90 thresholds.
- Full frontend before the last swap recovery regression: 73 files, **827 tests passed**. Final affected booking-search/swap tests were rerun afterward; the delivered frontend contains **828 tests**.
- Prisma generation, TypeScript, backend/frontend lint and production builds passed. Vite retains its existing large-bundle advisory.
- Tracked-file secret/attribution check passed. Earlier member evidence is preserved.
- Raw evidence: `docs/evidence/s4-m4/`. Historical failed intermediate runs are retained under their explicit initial filenames; final evidence names identify the passing result.

Unverified gates: real Chromium screenshots, two-browser races, real Auth0/Neon flows, remote CI, live migration and deployment. Chromium was absent and installation returned an invalid/truncated archive; the failure log is included. `docs/sprint4-member4-browser-checks.md` provides a runnable audit and manual review steps. Source implementation is delivered; these environment-dependent acceptance checks are not represented as completed.

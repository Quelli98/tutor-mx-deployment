# Sprint 4 Member 2 handoff

Prepared 4 October 2026 as an addition to the completed Member 1 archive, using the updated 30 September handbook, Member 2 allocation on page 36. This is a source delivery for `s4/m2/completion`; it does not establish the current remote main SHA or merge the branch.

## Acceptance mapping

| Card | Delivered behavior | Evidence |
| --- | --- | --- |
| S4-M2-1 draft planning | Separate Scenario/ScenarioItem tables; drafts copy confirmed assignments, editable with existing ranked-tutor lookup | Migration-backed service tests assert that draft edits leave Allocation rows unchanged |
| S4-M2-1 locks | Versioned explicit lock/unlock; locked items cannot be edited or removed | Backend enforcement and disabled frontend edit/remove controls tested |
| S4-M2-1 Compare with Live | Added/removed/changed assignments; allocated hours, per-tutor workload, shortages and course cost/budget projections | Database fixtures check changed tutors/hours, missing prices and carry-in coverage |
| S4-M2-1 Publish | Explicit UI confirmation, reviewed live-revision check, current hard-rule checks, serializable transaction, notification insertion | Stale-live, ineligible mark, busy clash, capacity change, intra-draft clash, existing booking, protected history and complete rollback tests |
| S4-M2-2 collaboration | Every draft mutation needs version; stale writes return 409; updated-by/time; refresh preserves unsaved form inputs | Two independent organiser subjects read the same version; the second write fails, refresh/review/retry succeeds; UI conflict recovery tested |
| S4-M2-2 presence/library | 25-second heartbeat, 90-second TTL; informational presence; rename, notes, duplicate, archive/reopen, delete | Expiry, wrong-role, lifecycle and no-live-change tests |
| S4-M2-3 discovery/privacy | Student-only safe tutor/course choices; own identity from authenticated subject; no busy labels, marks, email or private reasons returned | Discovery field allowlist, injected studentId rejection, wrong-role and private-label integration tests |
| S4-M2-3 matching | Own/tutor BUSY TimeSlots, confirmed allocations, accepted overflow work and existing bookings; weekly/fortnightly, term dates, breaks, moved/cancelled exceptions | Interval boundaries, exact-duration fits, recurrence, no-common-time, bounded results and booking overlap tests |
| Shared appearance/navigation | Existing role shells, cards, buttons, dialogs and responsive form/table styles; protected routes and shortcuts | Full existing frontend suite plus new component/API tests |

## API contracts

All endpoints require bearer authentication and current profile-role resolution. The services additionally re-read the profile's current role. Errors use the existing `{error: {code, message}}` envelope; successful results use `{data: ...}`.

| Method | Endpoint | Input / result |
| --- | --- | --- |
| GET | `/api/organiser/scenarios?status=DRAFT` | DRAFT / ARCHIVED / PUBLISHED, newest 100; updated-by and item counts |
| POST | `/api/organiser/scenarios` | `{name, notes?, startsAt, endsAt}` → `{scenario, items}` |
| GET | `/api/organiser/scenarios/:id` | Consistent scenario/version/items snapshot |
| GET | `/api/organiser/scenarios/:id/compare` | version, liveRevision, liveChanged, live/draft items, diff, liveMetrics/draftMetrics |
| POST | `/api/organiser/scenarios/:id/actions` | `{action, version, ...actionFields}` → updated detail or `{deleted:true}` |
| POST | `/api/organiser/scenarios/:id/presence` | `{}` → current organiser activity, filtered by TTL and current role |
| GET | `/api/student/tutoring-options` | `{choices:[{tutorId,tutorName,courseId,courseCode,courseName}],truncated}` |
| POST | `/api/student/mutual-availability` | `{tutorId,courseId,termId,startsAt,endsAt,durationMinutes,dailyStartHour?,dailyEndHour?}` → `{slots:[{startsAt,endsAt}],truncated,timeZone,durationMinutes,policy}` |

Scenario actions: `metadata` (name, notes), `duplicate` (name), `archive`, `reopen`, `delete`, `save-item` (item), `remove-item` (itemId), `lock` (itemId, locked), `publish` (liveRevision). Unexpected fields are rejected. `save-item` accepts optional item.id, tutorId, courseId, startsAt, endsAt, allocatedHours, minimumMark. Never submit an Allocation update for an ordinary draft edit.

`SCENARIO_STALE`, `LIVE_PLAN_STALE`, `ITEM_LOCKED`, `SCENARIO_READ_ONLY`, `ALLOCATION_HISTORY_PROTECTED`, `SCENARIO_RULE_FAILED` and transactional `PLANNING_CONFLICT` use 409. The UI preserves unsaved inputs on a conflict, refreshes the latest version explicitly and requires another comparison before publication.

Presence does not change the scenario version or authorize edits. It stores only scenario/profile/last-seen; expired rows are cleared by subsequent heartbeats. Published scenarios are immutable and may be duplicated. Archiving is reversible. Deleting an unpublished draft removes only its draft items/presence.

## Scope and calculation rules

- A scenario covers confirmed assignments **starting** within its selected future window, up to 28 days and 200 assignments. Assignments starting outside that window are not replaced. At most 100 active drafts are permitted.
- Draft session windows match the existing eight-hour maximum. Allocated hours must be positive and fit the interval. Drafts may temporarily contain ineligible tutors/clashes so alternatives can be reviewed; Publish rechecks the complete resulting live plan using the existing allocation candidate rules.
- Locked assignments retain their draft values until explicitly unlocked. Locks never bypass publication validation.
- Changed/removed live assignments are cancelled, not deleted; new identities are confirmed with organiser review audit. Past sessions and sessions with work-log, excuse or overflow references cannot be replaced or removed. Unchanged past sessions are retained.
- Shortages use open requirements fully inside the window, prorating overlapping allocated hours. Confirmed carry-in sessions starting before the window contribute coverage but cannot be edited here. Approved EXCUSED sessions contribute no shortage coverage; SKIPPED follows the existing staffing rules.
- Cost is a window projection, not payroll spend or a whole-year budget forecast. Workload counts planned allocated hours. Budget remaining is course budget minus this projected window cost. Missing rates/budgets are unknown, not zero. The existing candidate rules enforce capacity; budget projections remain advisory, as in the supplied project.
- Comparison includes updated live allocation identities and attendance protection in its hash. Publish must carry the exact revision reviewed by the organiser. If live changed since draft creation, a new comparison makes those differences visible before an intentional publication.
- New reads/writes use Prisma's UTC interpretation of database timestamps; UI inputs explicitly use Africa/Johannesburg. The final targeted tests also run under a non-UTC process timezone.
- Availability searches are at most 14 days, within 180 days, strictly future starts, 15–180 minute durations and 15-minute start increments. Daily hours default to 08:00–18:00, are user-selectable and include weekends. Results stop at 80 with `truncated:true`; discovery stops at 500 choices. Current published term dates/breaks bound the returned slots.
- Availability compares half-open busy intervals: a session can start exactly when a busy period ends. Nonrecurring, weekly and fortnightly entries share the existing timetable conventions. A moved exception can enter the window from another week.
- The query returns only available start/end times. It never returns either party's private busy labels, illness reasons, full timetable, email, marks or authentication identifiers. Suggested slots are not reservations.

## Member 3 integration

`readBookingBusy(client, profileIds, window)` checks for `TutoringBooking` and reads it if present. The expected minimum columns are studentId, tutorId, startsAt, endsAt. The adapter excludes status CANCELLED/EXCUSED and occurrenceStatus EXCUSED, and treats other rows conservatively as occupied. This is covered with a temporary booking table in integration tests; no Member 3 schema or booking mutation is introduced here.

Member 3 must recheck schedules, tutor/course eligibility, duration, both parties' bookings and the chosen academic term inside its booking-creation transaction. A displayed availability result can change before booking. Reuse the shared owner timetable, `readBusyIntervals` and recurrence helpers; retain Member 3's locking/idempotency guarantees when adding booking writes. Student sickness remains Member 4's scope.

## Verification

- Full backend suite: **47 files / 1,289 tests passed** with the configured coverage gate.
- Coverage: **90.82% statements, 85.97% branches, 95.37% functions, 91.87% lines** (required 90/85/83/90).
- Full frontend suite: **69 files / 802 tests passed**.
- Final targeted planning run adds one attendance/privacy regression and reruns all new service/HTTP tests under `TZ=Africa/Johannesburg`; see `final-planning-tests.txt` for its result. The final source contains 1,290 backend tests in total; the coverage figures above precede only that test addition.
- TypeScript typecheck, backend/frontend ESLint and both production builds passed. Vite retains the existing bundle-size advisory.
- The repository's secret/attribution check is recorded in `security.txt`.
- Raw logs: `docs/evidence/s4-m2/`. No credentials, dependencies, generated Prisma client or build output are included in the source archive.

The two-organiser conflict test uses independent authenticated subjects and the UI uses a simulated 409. It is not a claim that two real Auth0 browser sessions were exercised.

## Configured-environment release checks

After integrating and applying migrations, verify these against your development deployment and capture the handbook's browser evidence:

1. In two independent organiser browser sessions, open one draft; confirm both names appear, save in A, attempt the stale edit in B, then refresh/review/retry in B. Close A and confirm its activity disappears after 90 seconds.
2. Lock an assignment, verify edit/remove are blocked, and unlock deliberately. Exercise duplicate, notes, archive/reopen and draft deletion; confirm live allocations remain unchanged.
3. Compare a changed/add/remove draft and check shortage/workload/budget deltas. Change live staffing in the other session: publishing the old comparison must fail. Compare again, then publish after explicit confirmation. Introduce a new clash to verify all-or-nothing failure.
4. As a Student, create busy classes/unavailable periods, choose a tutor with busy/confirmed sessions, and search exact-boundary, recurrence/exception/break and no-common-time cases. Inspect network results to confirm no private busy labels.
5. Check keyboard focus/confirmation Escape, narrow-screen table scrolling, sidebar routes, sign-out/expired-session behavior and role switching. Verify Tutor timetable behavior still works.
6. Run Gitea CI, migrate the intended production database, deploy backend then frontend, and check production Auth0, health/readiness and role routes.

No real Auth0 browser, production database or hosted application was used for local verification. No remote commit/push/merge/deploy has been performed.

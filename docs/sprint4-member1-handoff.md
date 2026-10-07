# Sprint 4 Member 1 handoff

Prepared 3 October 2026 from the locally available `tutor-mx-system-main (5)(2).zip` source snapshot and the updated 30 September handbook (Member 1, page 35). The archive does not establish a verified current remote main SHA. Compare newer repository changes before applying.

## Acceptance mapping

| Card | Implementation | Verification |
| --- | --- | --- |
| S4-M1-1: shared ownership | Prisma `TimeSlot.ownerId` and `owner` relation use the existing physical `tutorId` column; versioned owner-role trigger now accepts STUDENT/TUTOR | PGlite migration test snapshots pre-existing Tutor rows and verifies identical rows after applying the new migration |
| S4-M1-1: own schedule | `/api/me/time-slots` CRUD and import routes derive ownership from the authenticated subject; original Tutor routes remain Tutor-only | HTTP role/payload tests, Student CSV/ICS integration tests and server ownership tests |
| S4-M1-1: matching Tutor experience | `/student/timetable`; shared RoleWorkspaceShell, MyTimetable, ScheduleEntryPanel, AvailabilityForm, TimetableImport and WeeklySchedule | Student manual/fortnightly/calendar-refresh and draft-preservation tests; existing calendar/import/Tutor tests |
| S4-M1-1: privacy | Own reads/writes/deletes use the authenticated profile; organiser's legacy Tutor schedule read additionally filters owner role to TUTOR | Injected owner IDs rejected; foreign update/delete rejected; Tutor-only read filter verified |
| S4-M1-2: session | 401/revoked refresh locks the local workspace; ordinary 403 rechecks current permissions; cleanup is limited to application-owned protected state; responses crossing a session change are discarded | Session state, current-user late-response/changed-role, failed deletion/logout, existing password reset and account tests |
| S4-M1-2: stale links | Navigation resolver reloads target existence, recipient/ownership and role; historical target routes use TargetGate; fresh Student course search excludes closed opportunities | Missing/deleted/reassigned/changed-role targets, wrong notification recipient and fresh-search integration tests |
| S4-M1-3: actions/shortcuts | Inbox View/Fix/Review actions resolve before navigation; palette recent/favourite metadata stores only approved destination IDs scoped by account/role | Permission denial, stale asynchronous results, role filtering, deduplication, favourites, keyboard focus/trap and Escape tests |

## Shared API for subsequent members

All routes require a bearer token and current profile-role resolution. Student and Tutor may use the own-schedule routes; callers cannot supply an owner ID.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/me/time-slots` | Read own schedule |
| POST | `/api/me/time-slots` | Add one own schedule entry |
| PATCH | `/api/me/time-slots/:timeSlotId` | Edit an owned entry |
| DELETE | `/api/me/time-slots/:timeSlotId` | Delete an owned entry |
| POST | `/api/me/time-slots/import/preview` | Existing CSV/ICS preview, term and duplicate checks |
| POST | `/api/me/time-slots/import/commit` | Existing validated import transaction |
| POST | `/api/navigation/resolve` | Resolve exactly one destinationId, notificationId, or targetType + targetId after fresh authorization |

The old `/api/tutor/time-slots` routes and import subroutes remain Tutor-only aliases. Response shapes and recurrence encoding are unchanged: a one-off entry may use null recurrence internally. Existing SQL allocation queries keep using `TimeSlot.tutorId`; new Prisma code uses `ownerId`. There is no second Student timetable table.

## Verification performed

- Backend full suite with coverage: 44 files, 1,219 tests passed.
- Backend coverage: statements 90.28%, branches 85.33%, functions 95.00%, lines 91.34%; configured CI thresholds passed.
- Frontend full suite: 66 files, 785 tests passed.
- Final backend ownership/migration regression run: 33 tests passed (includes 3 additional ownership checks).
- Final frontend session/account regression run: 17 tests passed (includes 4 additional failure/permission checks).
- TypeScript typecheck, backend/frontend ESLint and both production builds passed.
- Existing tracked-file secret/AI-attribution check passed.
- Raw output is in `docs/evidence/s4-m1/`.

The full suites ran before the final narrow ownership/session test additions; their affected suites were rerun afterward. Server-only changes are excluded from the project's existing coverage calculation. Vite reports its existing large-bundle advisory; the build succeeds.

## Integration/release checks still requiring your environment

No remote repository or deployed services were changed. No real Auth0 credentials, Neon production database or browser screenshots were used for these local checks. Run your normal Gitea CI and check Student and Tutor screens on desktop/mobile in the configured app, then capture the final evidence. Verify production login/reset/sign-out and the API health/readiness endpoints after deployment.

Later members should reuse the shared owner model and schedule APIs for mutual availability, bookings and sickness, as assigned in the handbook. Do not rebuild the import/calendar engine. This handoff does not claim those later cards are complete.

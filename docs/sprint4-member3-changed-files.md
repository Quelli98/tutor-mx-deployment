# Sprint 4 Member 3 changed files

Compared with the delivered Members 1–2 ZIP. No files from that delivery were removed. Earlier handoffs and evidence describe their respective deliveries and remain included.

## Modified

- `README.md`
- `frontend/src/App.css`
- `frontend/src/components/organiser/OrganiserShell.jsx`
- `frontend/src/components/shared/RoleWorkspaceShell.jsx`
- `frontend/src/components/shared/WeeklySchedule.jsx`
- `frontend/src/components/shared/destinations.js`
- `frontend/src/features/MutualAvailability.jsx`
- `frontend/src/features/MutualAvailability.test.jsx`
- `frontend/src/features/MyTimetable.jsx`
- `frontend/src/features/SickTimetable.test.jsx`
- `frontend/src/features/StudentTimetable.test.jsx`
- `frontend/src/routes/RoleRouter.jsx`
- `prisma/schema.prisma`
- `src/app.ts`
- `src/server.ts`
- `src/services/allocation-queries.ts`
- `src/services/navigation-targets.ts`
- `src/services/notifications.ts`
- `src/services/scenario-service.test.ts`

## Added

- `START-HERE-SPRINT4-MEMBERS1-TO3.md`
- `docs/sprint4-member3-handoff.md`
- `frontend/src/api/scheduling.js`
- `frontend/src/features/BookingPanel.jsx`
- `frontend/src/features/BookingPanel.test.jsx`
- `frontend/src/features/SwapWorkspace.jsx`
- `frontend/src/features/SwapWorkspace.test.jsx`
- `prisma/migrations/20261009000000_s4_swaps_bookings/migration.sql`
- `src/scheduling-routes.test.ts`
- `src/services/booking-service.ts`
- `src/services/scheduling-common.ts`
- `src/services/scheduling.test.ts`
- `src/services/swap-service.ts`
- `docs/sprint4-member3-changed-files.md` (this inventory)
- `docs/evidence/s4-m3/` (verification logs)

The existing Member 2 booking-adapter test now uses the real Member 3 table. Existing timetable tests stub the new booking API while retaining their original recurrence/import/attendance assertions. The new tests cover booking behavior independently.

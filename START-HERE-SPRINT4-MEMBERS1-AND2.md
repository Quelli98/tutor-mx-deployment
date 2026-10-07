# Sprint 4 Members 1 and 2 — updated source

This is the complete project with the previously completed Member 1 work preserved and Member 2 added. Start with this guide; the Member 1 guides describe the earlier delivery.

## What Member 2 adds

- **Organiser → Scenario planning:** create drafts from live assignments, add/edit/remove assignments, rank tutors using the existing rules, explicitly lock/unlock assignments, and compare assignment, shortage, workload and budget projections.
- **Publish:** review Compare with Live, confirm publication, and recheck current eligibility, schedule clashes, bookings and capacity in one transaction. A failure leaves the live plan unchanged. Existing attendance/payroll history is protected.
- **Collaborative scenario library:** names, notes, duplicate, archive/reopen, delete, version conflicts, updated-by details and short-lived organiser activity. A stale edit gets a refresh-and-review workflow rather than overwriting someone else's work.
- **Student → Find a tutoring time:** eligible tutor/course choices and private, read-only shared availability using both schedules, recurrence, exceptions, terms, breaks, confirmed allocations and existing bookings. The screen follows the existing role workspace and Tutor styling.

Member 1's Student timetable, shared imports/calendar, session handling and safe navigation remain included. The booking creation/cancellation workflow belongs to Member 3; this delivery supplies its availability foundation and reads the booking table when that table exists.

## Apply the update

1. Keep your existing `.env` and `frontend/.env`; only example environment files are included. Keep a backup or commit of your current code.
2. Integrate the folder into your existing repository on the Member 2 branch after Member 1 is accepted. This archive is based on the supplied source snapshot, not a verified newer remote main. If your team has made newer changes, use `docs/sprint4-member2-changed-files.md` to merge these additions into that checkout.

```powershell
git switch main
git pull --ff-only
git switch -c s4/m2/completion
```

Copy the source into that working branch, preserving your `.git` folder and environment files. Then run from the project root:

```powershell
npm ci
npm ci --prefix frontend
npm run generate
npm run db:migrate
npm run check
npm run dev
```

`DATABASE_URL` must point to your intended development database before migrating. Apply migrations normally; do not reset or reseed an existing database.

- Member 1 migration: `20261007000000_shared_profile_schedule`.
- Member 2 migration: `20261008000000_s4_scenario_planning` (Scenario, ScenarioItem, ScenarioPresence).

If Member 1 is already installed, Prisma will only apply migrations that have not run yet. No additional environment variables or packages are required by Member 2.

## Try the new screens

**Organiser:** open Scenario planning, create a future window (up to 28 days), edit an assignment and lock it. Compare with Live, review the changes, then confirm Publish. Open the same draft as another organiser to try the stale-version refresh flow.

**Student:** add your classes/unavailable periods in My timetable, then open Find a tutoring time. Choose a published term, eligible tutor/course, search window and session length. All date/time fields use South African time. The suggested times are not reservations.

See `docs/sprint4-member2-handoff.md` for the acceptance mapping, endpoint contracts, tested limits, Member 3 integration notes and configured-environment release checks. Automated test output is under `docs/evidence/s4-m2/`.

No remote push, main merge, live database migration or production deployment was performed while preparing this update. Deploy in migration → backend → frontend order and run the configured Auth0/browser checks in the handoff.

# Sprint 4 Member 1 - updated code

The complete source is in this folder. Start here before copying it into your working repository.

## What is included

- Student **My timetable**, using the existing Tutor workspace shell, weekly calendar and shared manual/import forms.
- Add, edit and delete Class or Unavailable entries; Once, Weekly and Fortnightly repetition; CSV/ICS preview, duplicate handling and academic-term rules.
- One generic Profile-owned TimeSlot model and a preserving migration. Existing Tutor aliases and allocation clash logic remain supported.
- Session expiry, changed-role and failed sign-out handling; protected state cleanup and rejection of late responses.
- Fresh permission checks for notification actions, search results and recent/favourite destinations, including Student My timetable.
- Regression tests and Member 1 handoff/evidence notes.

This package implements S4-M1-1, S4-M1-2 and S4-M1-3. Student tutoring bookings, mutual availability matching and Student sick-session workflows belong to later members in the handbook; this package supplies their shared timetable foundation.

## Apply to your existing checkout

1. Keep your existing `.env` and `frontend/.env` files. This ZIP contains only example environment files.
2. Start from your approved, clean current `main`. In PowerShell, run:

```powershell
git switch main
git pull --ff-only
git switch -c s4/m1/completion
```

3. Copy this folder's contents into your repository folder. Do not copy over your `.git` folder, credentials or local environment files. If your main has changed since the source archive, compare `docs/sprint4-member1-changed-files.md` and integrate those changes rather than overwriting newer work.
4. From the repository root, install and generate:

```powershell
npm ci
npm ci --prefix frontend
npm run generate
```

5. Point `DATABASE_URL` at the intended development database, then apply the versioned migrations:

```powershell
npm run db:migrate
```

The new migration is `20261007000000_shared_profile_schedule`. It allows Student and Tutor owners while retaining existing rows and the legacy SQL column name. Do not reset or reseed an existing database to apply this change.

6. Check and run:

```powershell
npm run check
npm run dev
```

7. Sign in as a Student and choose **My timetable** in the sidebar. Add a Class, switch between manual/import tabs, and use the calendar's week controls. Ctrl+K (Cmd+K on Mac) opens search and shortcuts.
8. Review `docs/sprint4-member1-handoff.md` and the changed-file list, then commit/push the Member 1 branch to your repository for the Integration Lead to review. The Integration Lead merges it before Member 2 starts.

## Deployment order

Apply the migration to the intended production database, deploy the backend, then deploy the frontend. No live database migration, production deployment, remote push or merge was performed while preparing this ZIP. Production Auth0 sign-in, Render health/readiness and Cloudflare smoke checks remain release checks for your configured environment.

# Tutor MX — CI and timetable fixes

Source: the latest available uploaded `tutor-mx-system-main (1)(1).zip`.
This is a complete corrected source project, not a patch-only archive. It is
based on that uploaded snapshot; the remote `main` branch was not fetched or modified.

## Fixed

- Corrected the NodeNext ESM import in `academic-terms.test.ts` to `./academic-terms.js`.
- Removed the weekly calendar render loop caused by a fresh default Date triggering state updates on every render. Equivalent Date props preserve navigation; changing the requested week still jumps correctly.
- Limited frontend coverage to two isolated workers and set bounded hook timeouts. Both CI workflows allow 30 minutes for the frontend job with a 25-minute coverage step. No tests were skipped and no coverage thresholds were reduced.
- Updated obsolete calendar-empty-message and keyboard-order assertions to reflect the existing timetable tabs and category selector. Retained keyboard testing for both entry methods.
- Refreshed the manual schedule after imports without remounting forms, clearing unsaved drafts, losing calendar navigation, or erasing the import success message.
- Accepted and validated the category and series metadata that the frontend actually sends. Ownership fields are still rejected, and updates still enforce tutor ownership in the database write predicate.
- Preserved class categories, series IDs and fortnightly recurrence through backend reads/writes and manual editing. Described fortnightly entries as occurring every other weekday in schedule details.
- Added a new migration allowing FORTNIGHTLY in the database recurrence constraint. Previously applied migration files were not modified. Added database regression cases for occurrence weeks, off weeks and recurrence end dates.
- Preserved publication status and teaching breaks when term updates omit those fields. Explicit false/empty-list updates still unpublish or clear them. Added validation, persistence, overlap, duplicate-year/term, deletion and publication regression coverage.

## Verification

| Check | Result |
|---|---|
| Dependency installation from existing lockfiles | Passed, backend and frontend |
| Prisma client generation | Passed |
| Backend and frontend lint | Passed |
| TypeScript typecheck | Passed |
| Backend tests with coverage | 1,171 passed across 42 files |
| Frontend tests with coverage | 749 passed across 61 files |
| Backend build | Passed |
| Frontend production build | Passed |
| Repository secret/attribution check | Passed using a temporary local Git index |
| Clean migration, seed and database regression tests | Passed within the backend suite using PGlite |

| Coverage | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Backend | 92.12% | 86.45% | 95.13% | 92.82% |
| Frontend | 84.00% | 80.81% | 86.16% | 86.33% |

Backend coverage gates remain 90% statements, 85% branches, 83% functions and
90% lines. Frontend coverage settings retain their existing threshold policy.
The final backend run took about 35 seconds here. The final frontend coverage run took 49.18s;
shared Gitea runner timings will differ.

## Apply and verify in the real repository

Copy the complete project contents, including `.gitea` and `.github`, into your
working repository. Preserve your repository's `.git` directory and local environment files.
Compare against newer remote changes before replacing files if main has advanced.

```sh
npm ci
npm ci --prefix frontend
npm run check
npm run coverage
```

The new migration must be applied to each deployed database before the updated
backend is used:

```sh
npm run db:migrate
```

This archive excludes dependencies, generated Prisma code, build outputs,
coverage artifacts, credentials and the temporary Git index. Existing lockfiles
and frontend design assets are unchanged.

## Verification boundaries

No remote push, merge, deployment or Codecov upload was performed. Gitea must
rerun backend quality/coverage, frontend quality/coverage and its native PostgreSQL
migration/API smoke job. Native PostgreSQL could not be installed in this execution
environment because package-manager privilege operations were unavailable; the
PGlite migration/database suite passed. The frontend build emits its existing
large-bundle advisory; the build exits successfully.

## Changed source files

- `.gitea/workflows/ci.yml`
- `.github/workflows/ci.yml`
- `frontend/src/components/shared/WeeklySchedule.jsx`
- `frontend/src/components/shared/WeeklySchedule.test.jsx`
- `frontend/src/features/AvailabilityForm.jsx`
- `frontend/src/features/AvailabilityForm.test.jsx`
- `frontend/src/features/TimeSlotDetails.jsx`
- `frontend/src/features/TutorDetails.integration.test.jsx`
- `frontend/src/features/TutorForms.jsx`
- `frontend/src/features/TutorForms.test.jsx`
- `frontend/vite.config.js`
- `prisma/migrations/20261004000000_support_fortnightly_schedule/migration.sql`
- `src/app.ts`
- `src/database-schema.test.ts`
- `src/server.test.ts`
- `src/server.ts`
- `src/services/academic-terms.test.ts`
- `src/services/academic-terms.ts`
- `src/tutor-routes.test.ts`

Historical document: its original AI use/non-use and model evidence have not been verified in the final audit. Confirm a document-specific declaration before submitting it for marking; see the root AI_DECLARATION.md.

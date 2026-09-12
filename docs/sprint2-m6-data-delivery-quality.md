# S2-M6-3 — Data Delivery Quality Report

**Branch:** `s2/m6/data-delivery-quality`
**Author:** Member 6, Sprint 2
**Date:** 2026-09-11
**Integration recheck:** 2026-09-12 against Gitea `main` after Member 5 API-quality integration

---

## Summary

Full audit of hot-path database queries, index coverage, CI pipeline and coverage
configuration. **No query performance issues or missing indexes were found.** The
Sprint 1 codebase already uses well-structured single-statement SQL for all allocation,
dashboard and open-work paths, with composite indexes that cover every filter and join.

---

## Query Performance Audit

### Allocation Candidate Query (`candidateQuerySql`)

- **Pattern:** Single SQL with two CTEs — `tutor_hours` (aggregates weekly allocation
  hours per tutor) and `candidate_data` (joins marks, computes clash via EXISTS
  subqueries on TimeSlot and Allocation).
- **N+1 check:** No loops. One round-trip for all tutors.
- **Index coverage:**
  - `Allocation @@index([tutorId, status, startsAt, endsAt])` — covers the hour
    aggregation and clash detection.
  - `TimeSlot @@index([tutorId, type, startsAt, endsAt])` — covers BUSY-slot clash
    EXISTS subquery.
  - `TutorMark @@index([courseId, mark])` — covers the course-filtered mark join.

### Tutor Hour Summary (`tutorHourSummarySql`)

- **Pattern:** Single SQL per tutor — Profile JOIN TutorHourLimit LEFT JOIN Allocation
  with GROUP BY.
- **N+1 check:** Not applicable (called once per dashboard load).
- **Index coverage:** `Allocation @@index([tutorId, status, startsAt, endsAt])`.

### Open Work Listing (`openWorkQuerySql`)

- **Pattern:** Single SQL — OverflowWork JOIN Course, filtered by status and time.
- **N+1 check:** No loops. One round-trip for all open items.
- **Index coverage:** `OverflowWork @@index([status, startsAt, closesAt])` — status
  filter + time range covered.

### Dashboard (`getTutorDashboard` in server.ts)

- **Pattern:** Two queries total:
  1. Prisma `profile.findUnique` with `include` for allocations and nested course
     select (one SQL with JOINs).
  2. Raw SQL `tutorHourSummarySql` (one SQL).
- **N+1 check:** No per-item loops.

### Student Open Work (`listOpenWork` in student-workflows.ts)

- **Pattern:** Three queries total:
  1. `profile.findUnique` — find student ID.
  2. Raw SQL `openWorkQuerySql` — all open work.
  3. `volunteerClaim.findMany` with `{ in: [...] }` — batched existing claims.
- **N+1 check:** Batched. No per-item queries.

### Timesheet / Excuse Workflows

- **Pattern:** 2–3 queries per operation inside `$transaction(Serializable)`.
- **N+1 check:** All use `findFirst`/`findUnique` with `select` projections.
  No per-item loops.

---

## Changes Made

**None.** All hot-path queries, indexes and the Codecov configuration were already
correct and production-quality. This branch serves as a verification-only audit.

---

## Clean Rehearsal Evidence (integrated candidate, 2026-09-12)

| Step                                 | Result                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `npm run generate`                   | Prisma Client 7.9.1 generated                                                                         |
| `npm run lint` (backend + frontend)  | Clean — no warnings or errors                                                                         |
| `npm run typecheck`                  | Clean — no errors                                                                                     |
| `npm run test:backend`               | **389 / 389 passed** (20 test files)                                                                  |
| `npm run test:frontend`              | **147 / 147 passed** (26 test files)                                                                  |
| `npm run coverage:backend`           | 93.50% stmts / 89.72% branches / 95.78% funcs / 94.99% lines — **all above thresholds** (90/85/83/90) |
| `npm run coverage:frontend`          | 86.44% stmts / 82.83% branches / 91.44% funcs / 88.60% lines                                          |
| `npm run build` (backend + frontend) | Compiled successfully                                                                                 |
| `npm run security:check`             | Passed — no tracked secrets, AI attributions present                                                  |

---

## Codecov Configuration

**Status: Correct, no fix needed.**

- `codecov.yml` defines `backend` flag (paths: `src/`) and `frontend` flag
  (paths: `frontend/src/`).
- GitHub CI (`.github/workflows/ci.yml`): both jobs upload with correct flags using
  OIDC (`use_oidc: true`).
- Gitea CI (`.gitea/workflows/ci.yml`): both jobs upload with correct flags using
  `CODECOV_TOKEN` secret.
- Backend coverage thresholds (vitest.config.ts): 90% stmts, 85% branches,
  83% funcs, 90% lines — all met.

---

## Known Limitations

1. **Gitea Actions runner availability:** The lecturer-managed Gitea runner may be
   unavailable. This is an external blocker and does not reflect on code quality.
   Local `npm run check` evidence above is sufficient per the Sprint Handbook.

2. **Live PostgreSQL rehearsal:** The `postgres-integration` CI job (clean migrate →
   seed → db:verify → smoke) requires a live PostgreSQL service container. This
   cannot be replicated locally without a running database. The `database-schema.test.ts`
   (PGlite in-memory) validates all 4 migrations + seed data in 12 tests —
   2 of which recreate the full schema on a second clean database to verify
   idempotency.

3. **Frontend chunk size:** Vite reports a 510 kB JS bundle. Consider code-splitting
   with dynamic `import()` for production. Not a blocking issue for Sprint 2.

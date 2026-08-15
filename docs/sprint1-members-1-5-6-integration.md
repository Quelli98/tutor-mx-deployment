# Sprint 1 Members 1, 5 and 6 main integration

This handoff is limited to Sprint 1 and the requirements on handbook PDF pages 1-29. It integrates the supplied Member 5 snapshot with the supplied main snapshot and uses the team's later single-main workflow.

## Completion matrix

| Member | Sprint 1 issues | Integrated result |
| --- | --- | --- |
| Member 1 | S1-M1-1 to S1-M1-3 | Auth0 Universal Login entry/sign-out, non-enumerating reset request, hosted new-password path, two-step deletion stub, role routing, shared bearer helper and frontend/backend 401/403 contract tests |
| Member 5 | S1-M5-1 to S1-M5-3 | Separately runnable Express backend, health/readiness, safe logging/error handling, Auth0/role middleware, profile/course/tutor API, Prisma-only persistence, stable allocation rules and boundary/unknown tests |
| Member 6 | S1-M6-1 to S1-M6-3 | Neon/Prisma migrations and constraints, repeatable non-personal seed, allocation queries, Gitea/GitHub CI plus Codecov, PostgreSQL smoke, and backend-only public-holiday adapter with timeout/validated fallback |

## Final local verification

- Backend: 11 test files, 106 tests passed.
- Backend coverage: 95.78% statements, 94.10% branches, 88.46% functions and 95.76% lines.
- Frontend: 8 test files, 31 tests passed.
- Frontend coverage: 85.62% statements, 77.51% branches, 87.17% functions and 89.26% lines.
- Backend/frontend lint, strict backend type-check, both production builds, Prisma generation and tracked-file security/AI-attribution checks pass.
- The migration/constraint suite passes against the in-memory PostgreSQL-compatible test database. CI also runs clean PostgreSQL 17 migrations, seed verification and API health/readiness smoke.

## Put this snapshot into the Gitea clone

Run these commands from the existing `tutor-mx-system-gitea-clone` folder after copying this archive's `tutor-mx-system` contents over the working tree. Do not copy or replace the clone's `.git` directory.

```bash
git checkout main
git pull origin main
npm ci
npm ci --prefix frontend
npm run generate
npm run check
npm run coverage
git status
git add .
git commit -m "feat(sprint-1): integrate members 1 5 and 6" -m "Assisted-by: Codex[GPT-5]"
git push origin main
```

If protected `main` blocks direct pushes, create an integration branch from the freshly pulled `main`, push it, and open the PR directly into `main` (not `develop`). The owner/Integration Lead should merge only after the three required CI jobs and Codecov checks are green.

External account actions remain: configure Auth0/Neon values without committing secrets, install/configure Codecov, add repository secrets, enable protected-main checks, and record the external-service decision. Source code cannot perform those administrator actions.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

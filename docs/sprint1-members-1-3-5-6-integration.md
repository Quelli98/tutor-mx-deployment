# Sprint 1 Members 1, 3, 5 and 6 integration

## Integration result

This main-ready source combines the supplied main branch with Member 3's Tutor Dashboard work while preserving the completed Member 1 authentication, Member 5 backend and Member 6 database/CI work. The Member 3 simulated API layer was replaced with authenticated Express and Prisma behavior so the four members' work runs as one React + Vite, Auth0, Express, Prisma and PostgreSQL application.

The acceptance criteria were checked against physical pages 1–29 of the supplied Sprint 1 PDF. Detailed implementation notes remain in the four member handoff documents.

## Acceptance mapping

| Member | Sprint 1 work completed in this integration | Evidence |
| --- | --- | --- |
| 1 | Auth0 sign-up/sign-in/sign-out shell; password-reset and account-deletion flows; fail-closed role routing; shared bearer-token contract; authentication and permission tests | `frontend/src/App.jsx`, `frontend/src/auth/`, `frontend/src/routes/`, `src/auth/`, `docs/member-1-handoff.md` |
| 3 | Own-tutor dashboard with assignments and weekly hours; loading/empty/error/retry states; availability/busy recurrence; allocation-linked draft work logs; future-session excuses; labels, field errors, keyboard and phone-width behavior; valid/invalid/contract tests | `frontend/src/features/Tutor*.jsx`, form components, `frontend/src/api/tutor*.js`, `frontend/src/api/tutorApi.test.js`, `docs/member-3-handoff.md` |
| 5 | Separate handwritten Express API; health/readiness; Auth0 middleware; protected profile/course/tutor routes; safe errors and CORS; three allocation rules and boundary tests; authenticated own-tutor dashboard/form routes and persistence transactions | `src/app.ts`, `src/server.ts`, `src/tutor-routes.test.ts`, `src/services/`, `docs/member-5-handoff.md` |
| 6 | Versioned PostgreSQL/Prisma schema and migrations; constraints and safe seed data; weekly-hour summaries; recurrence constraint; clean PostgreSQL verification; GitHub Actions/Codecov/protection instructions; server-only holiday API spike and fallbacks | `prisma/`, `src/database-schema.test.ts`, `.github/workflows/ci.yml`, `src/integrations/`, `docs/member-6-handoff.md` |

## Security and ownership checks

- Tutor browser requests never include or select a tutor ID. The API resolves `Profile.auth0Id` from the verified Auth0 access-token subject.
- Every Tutor workflow route requires the `TUTOR` role and applies allocation ownership before returning or writing data.
- Cross-tutor allocation requests receive non-revealing `404` responses; conflicts use stable `409` responses; unexpected failures use the shared safe envelope.
- Work-log creation and draft-timesheet reuse occur in one Prisma transaction.
- Frontend contract validation rejects malformed or identity-bearing dashboard responses.
- No `.env`, database credential, Auth0 token, private key or other secret is part of the deliverable.

## Final verification

The integrated source passed on 16 August 2026:

- Prisma Client generation;
- backend and frontend ESLint;
- strict backend TypeScript checking;
- backend production build;
- frontend production build;
- tracked-file secret/environment and AI-attribution checks;
- 12 backend test files and all 117 tests; and
- 15 frontend test files and all 52 tests.

Coverage results:

| Suite | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Backend | 94.04% | 91.00% | 87.30% | 94.02% |
| Frontend | 89.34% | 83.85% | 93.61% | 92.26% |

Run the same release checks from a clean checkout:

```bash
npm ci
npm ci --prefix frontend
npm run generate
npm run lint
npm run typecheck
npm test
npm run coverage
npm run build
npm run security:check
```

## Team-owned external steps

Source code cannot complete hosted configuration. The team still must configure the reviewed Auth0 application/API and role claim, set backend/frontend environment values locally, apply the migrations to Neon, configure `CODECOV_TOKEN`, protect `main`, require the documented CI checks and confirm the pushed pipeline is green. Never commit the real environment files.

Commit integrated AI-assisted changes with:

```text
Assisted-by: Codex[GPT-5]
```

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

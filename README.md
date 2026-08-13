# Tutor Mx System

Tutor Mx is a tutoring-management system built around a handwritten Node.js and Express API, Prisma migrations, and Neon PostgreSQL. Browser code must call the Express API; it must never connect directly to Neon or receive external-service credentials.

This branch contains the implementable Sprint 2 Member 6 work: the Basic workflow database, safe demo data, allocation queries, a production-ready external API adapter contract, PostgreSQL verification, deployment smoke tooling, and Gitea Actions quality gates.

## Requirements

- Node.js 24
- npm 11 or later
- PostgreSQL 17 for real database verification (Neon is used by deployed environments)

## Local setup

1. Copy `.env.example` to `.env` and replace the local `DATABASE_URL` placeholder.
2. Install dependencies with `npm ci`.
3. Generate the Prisma client with `npm run generate`.
4. Apply migrations with `npm run db:migrate`.
5. Load non-personal demo records with `npm run db:seed`.
6. Start the API with `npm run dev`.

For a disposable development database, `npm run db:reset` rebuilds the schema and then runs the explicit Prisma 7 seed command. Do not run a reset against shared or production data.

## Automated checks

| Command | Purpose |
| --- | --- |
| `npm test` | Unit tests plus in-memory PostgreSQL migration, constraint, seed and query tests |
| `npm run coverage` | Backend tests with HTML and LCOV coverage |
| `npm run db:verify` | Real PostgreSQL checks for migrations, seed cases, constraints and allocation queries |
| `npm run lint` | TypeScript lint checks |
| `npm run typecheck` | Strict TypeScript checks |
| `npm run build` | Production TypeScript build |
| `npm run security:check` | Reject tracked environment files/common secrets and verify AI attribution |
| `npm run check` | Complete local quality rehearsal except the real database check |
| `SMOKE_BASE_URL=https://... npm run smoke` | Verify deployed `/health` and `/ready` responses |

## Basic database workflow

The Prisma schema and ordered SQL migrations provide profiles/roles, courses, marks, time slots, weekly limits, allocations, work logs, timesheets, excuses, overflow work, and volunteer claims.

PostgreSQL enforces:

- primary, foreign, compound ownership and uniqueness relationships;
- tutor/student/organiser role relationships;
- mark, time-period and hour ranges;
- one claim per student/work item and at most one accepted claim per work item;
- allocation, timesheet, excuse, overflow and volunteer status transitions;
- draft/returned timesheet editing and weekly work-log limits;
- query indexes for dashboards, allocation candidates and open-work boards.

`prisma/seed.sql` uses only reserved `*.example` addresses and `demo|...` identifiers. It includes eligible, low-mark, clash, hour-limit, open-work and closed-work cases and is safe to rerun.

## Member 6 query handoff

`src/services/allocation-queries.ts` exports parameterised queries for:

- allocation candidates with marks, clashes, used/remaining hours and stable reason codes;
- a tutor's weekly used/remaining hours;
- the student-safe open-work projection.

Member 5 can call these functions with the exported `queryClient` from `src/database.ts`. Member 5 remains responsible for authentication, role/ownership middleware, transactions and HTTP routes.

## External API adapter handoff

`src/integrations/external-api.ts` is server-only. It provides timeout cancellation, JSON decoding into an explicitly safe shape, source timestamps, and controlled fallback reasons for invalid payloads, rate limits, upstream unavailability, other HTTP failures and network errors. It deliberately has no cache, because no approved freshness rule was supplied.

A domain-specific service and Express endpoint have not been invented: the required Sprint 1 service approval and Member 5 route are absent from this repository. After approval, create a decoder that selects only agreed public fields, instantiate `createJsonExternalApiAdapter` in backend code, and expose its result through the authenticated handwritten API.

## CI, coverage and deployment

`.gitea/workflows/ci.yml` runs backend quality/coverage plus a clean PostgreSQL 17 migration, seed, constraint/query verification and local API smoke. Backend LCOV uploads under the `backend` Codecov flag. `codecov.yml` reserves a separate `frontend` flag; the frontend owner must upload that report when the frontend project is added.

`.gitea/workflows/deployment-smoke.yml` is a manual deployed-health job. A repository administrator must configure `CODECOV_TOKEN` and `DEPLOYMENT_URL`, enable the Gitea Actions runner, and mark the two CI jobs as required checks on `develop` and `main`. No secret belongs in the repository.

See `docs/member-6-handoff.md` for completed evidence and dependency-owned follow-ups.

## AI declaration

This repository makes use of AI code generation using the following tools: Codex[GPT-5].

This repository does not use AI in-line editing tools.

This repository makes use of AI code-review using the following tools: Codex[GPT-5].

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

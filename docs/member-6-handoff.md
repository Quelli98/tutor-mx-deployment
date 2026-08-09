# Sprint 2 Member 6 handoff

Branch: `s2/m6/member6-complete`

PR base: `develop`

Assigned reviewer: Member 4

## S2-M6-1 - Basic Neon PostgreSQL schema and constraints

Implemented:

- Basic workflow Prisma models and ordered PostgreSQL migration;
- database checks, compound ownership keys, role triggers and state-transition triggers;
- dashboard, queue, candidate and open-work indexes;
- rerunnable non-personal seed data with all three roles and pass/fail cases;
- in-memory PostgreSQL and real-PostgreSQL migration/constraint verification;
- tracked-file secret checks and `.env.example`.

Member 5 should use the schema through backend transactions. Members 2-4 can use the stable `demo|...` identities and `DEMO101` cases without receiving production data.

## S2-M6-2 - Production external API adapter

Implemented:

- backend-only JSON adapter factory;
- abortable timeouts and explicit safe decoding;
- source timestamps and fallback statuses;
- rate-limit, unavailable, HTTP, invalid JSON/payload and network mapping;
- mock coverage for success and every implemented failure path.

Dependency-owned follow-up:

- The coordinator/client must approve the domain service, purpose, privacy/limit decision and freshness rule.
- Member 5 must expose the adapter through an authenticated Express route.
- Member 4 must render the agreed safe success/fallback shape.

No service, endpoint or cache was invented because those dependencies are absent.

## S2-M6-3 - Queries, smoke and Codecov reliability

Implemented:

- parameterised candidate, weekly-hour and open-work queries with tests;
- clean PostgreSQL migration/seed/verification CI job;
- local API `/health` and `/ready` smoke in CI;
- manual deployed-health smoke workflow;
- backend Codecov upload and separate frontend/backend flag configuration;
- path-independent scripts and one-command local quality rehearsal.

Repository/admin follow-up:

- Set `CODECOV_TOKEN` and confirm the Gitea runner can execute the Codecov action.
- Add `DEPLOYMENT_URL` only after Member 5 publishes the HTTPS backend.
- Upload the frontend LCOV report under the `frontend` flag when a frontend exists.
- Require `Backend quality and coverage` and `Clean PostgreSQL migration and API smoke` on protected `develop`/`main`.
- Open the PR to `develop`, link the real issue numbers, and request Member 4 review; only the Integration Lead may merge.

## Suggested verification sequence

```sh
npm ci
npm run generate
npm run check
npm run db:migrate
npm run db:seed
npm run db:verify
```

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

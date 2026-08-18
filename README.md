# Tutor Mx System

Tutor Mx is one integrated React + Vite, Auth0, handwritten Express, Prisma and Neon PostgreSQL project. Browser code calls only the Express API; it never connects to Neon, Prisma or an Auth0 Management API.

## Sprint 1 live demo and team repository

- **Public Sprint 1 demo:** https://tutor-mx.pages.dev
- **Official team source repository:** Gitea `innovent/tutor-mx-system`
- **Deployment mirror:** the GitHub copy can be used to trigger the hosted Cloudflare Pages / Render deployment, but team development starts from the latest Gitea `main`.
- **Current integrated Sprint 1 code:** Members 1, 3, 4, 5 and 6 are integrated. Member 2 is still pending integration.

The hosted demo follows the repository architecture: the browser loads the React/Vite frontend, Auth0 handles sign-in, React sends an Auth0 bearer token to the handwritten Express API, Express enforces role/ownership checks, and Prisma accesses Neon PostgreSQL. Team members can use the public URL for Sprint 1 demonstrations without receiving production database or Auth0 secrets.

For team work, always pull the latest Gitea `main`, work on your own branch, run the relevant checks, push that branch to Gitea, and tell the Integration Lead when it is ready. The Integration Lead merges approved work into `main`. The GitHub deployment mirror should then be refreshed from the approved Gitea `main` so the public demo stays aligned with the official team repository.


## Project structure

| Path | Purpose |
| --- | --- |
| `frontend/` | React interface, Auth0 Universal Login, role routing, account lifecycle, Tutor dashboard/forms, Student overflow/volunteer flow, shared accessible navigation/status components and bearer-token request helper |
| `src/` | Express API, Auth0 access-token verification, protected profile/course/tutor-workflow routes, allocation rules and backend services |
| `prisma/` | Versioned PostgreSQL schema, migrations and non-personal demo data |
| `.github/workflows/` | Required GitHub Actions CI, Codecov, PostgreSQL integration and deployment smoke checks |
| `.gitea/workflows/` | Compatible workflow copies retained from the supplied main-branch archive |

## Requirements and installation

- Node.js 24
- npm 11 or later
- PostgreSQL 17 for local database verification; deployed environments use Neon

From a clean checkout:

```bash
npm ci
npm ci --prefix frontend
npm run generate
```

Copy the two example environment files without committing the copies:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

Set the real `DATABASE_URL` only in the backend `.env`. Set matching Auth0 domain, client ID and API audience values in the backend and frontend files. Self-service onboarding and account deletion use server-only Auth0 Management API client credentials when configured; these credentials must never be placed in frontend files or committed.

Apply and seed the database, then start both applications:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

The frontend defaults to `http://localhost:5173`; the API defaults to `http://localhost:3000`.

## Auth0 setup and role contract

Create an Auth0 Single Page Application and configure these development URLs:

- Allowed callback URL: `http://localhost:5173`
- Allowed logout URL: `http://localhost:5173`
- Allowed web origin: `http://localhost:5173`

Create an Auth0 API whose identifier exactly matches `AUTH0_AUDIENCE` and `VITE_AUTH0_AUDIENCE`, using RS256 access tokens. Configure the database connection named by `AUTH0_DB_CONNECTION` and enable it for the SPA.

The access token must contain the custom claim named by `AUTH0_ROLES_CLAIM` (default `https://tutormx.example/roles`). Its value is an array containing one of `ORGANISER`, `TUTOR` or `STUDENT`. The frontend now supports first-login role selection. After Auth0 proves the identity, the handwritten Express onboarding endpoint uses a server-only Auth0 Management API client to assign exactly one pre-created Tutor Mx role and then creates the matching Neon `Profile`. `ORGANISER` self-sign-up is protected by `ALLOW_SELF_SERVICE_ORGANISER`; keep it `false` outside environments where public organiser creation is intended. A token that already carries a role must still match the Neon profile.

### HTTP authentication contract

Every protected browser request uses:

```http
Authorization: Bearer <access-token>
```

| Route | Access | Success | Relevant errors |
| --- | --- | --- | --- |
| `POST /api/auth/password-reset` | Public, validated email | `202 { data: { message } }` with a non-enumerating message | `400 VALIDATION_ERROR`, `503 PASSWORD_RESET_UNAVAILABLE` |
| `POST /api/auth/onboarding` | Valid Auth0 identity + selected role | Assigns Auth0 role and creates matching Neon Profile | `400`, `401`, `403`, `409`, safe `500` |
| `GET /api/me` | Valid token linked to a Tutor Mx profile | `200 { data: { profile } }` | `401`, `403`, `404` in `{ error: { code, message } }` |
| `GET /api/profile/current` | Valid token and supported matching role | Alias of the current-profile contract | `401`, `403`, `404` |
| `GET /api/courses` | Any supported authenticated role | `200 { data: { courses } }` | `401`, `403`, safe `500` |
| `POST /api/courses` | Organiser | `201 { data: { course } }` | `400`, `401`, `403`, `409` |
| `PATCH /api/courses/:courseId` | Organiser | `200 { data: { course } }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE /api/courses/:courseId` | Organiser | `204` | `400`, `401`, `403`, `404`, `409` |
| `GET /api/tutors` | Organiser | `200 { data: { tutors } }` | `401`, `403`, safe `500` |
| `POST /api/tutors` | Organiser | `201 { data: { tutor } }` | `400`, `401`, `403`, `409` |
| `PATCH /api/tutors/:tutorId` | Organiser | `200 { data: { tutor } }` | `400`, `401`, `403`, `404`, `409` |
| `GET /api/tutor/dashboard` | Tutor; identity comes from token | `200 { data: { dashboard } }` | `401`, `403`, `404`, safe `500` |
| `POST /api/tutor/time-slots` | Tutor; identity comes from token | `201 { data: { timeSlot } }` | `400`, `401`, `403`, `404`, `409` |
| `POST /api/tutor/work-logs` | Tutor; identity comes from token | `201 { data: { workLog } }` | `400`, `401`, `403`, `404`, `409` |
| `POST /api/tutor/excuses` | Tutor; identity comes from token | `201 { data: { excuse } }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE /api/auth/delete-account` | Valid token and supported role | `204` after the server deletes the Auth0 identity and matching Tutor Mx profile data | `401`, `403`, safe `500` |

The API verifies the RS256 signature against Auth0 JWKS, issuer, audience, subject, expiry and not-before values. The frontend token cache is explicitly in memory. Password entry, sign-up, sign-in and the actual new-password form stay on Auth0 Universal Login.

Tutor workflow URLs never accept a browser-supplied tutor identifier. The backend resolves `Profile.auth0Id` from the verified token subject, checks the database role and applies allocation ownership before returning or changing records. The dashboard and forms therefore cannot be redirected to another tutor by changing a URL or request body.

A newly self-onboarded Tutor may legitimately have no `TutorHourLimit` and no allocations until an Organiser configures them. That state now returns a usable dashboard instead of a `409`: `weeklyLimit` and `remainingHours` are `null`, `usedHours` is still safe to display, and the frontend shows **Weekly hour limit not set yet** plus the normal no-work state.

Sprint 1 Student overflow remains behind the protected `STUDENT` route and uses the agreed mocked work/claim boundary from Member 4. It does not access Prisma/Neon from the browser. The production Student endpoint is a later backend-connection step; the current integration deliberately preserves the Sprint 1 mock contract rather than inventing an unfinished server API.

## Automated checks

| Command | Purpose |
| --- | --- |
| `npm test` | Backend and frontend unit/component/integration tests |
| `npm run coverage` | Backend and frontend text, HTML and LCOV reports |
| `npm run lint` | Backend TypeScript and frontend React lint checks |
| `npm run typecheck` | Strict backend TypeScript check |
| `npm run build` | Production backend and frontend builds |
| `npm run db:verify` | Real PostgreSQL migration, seed, constraint and allocation-query checks |
| `npm run spike:holidays -- 2026` | Server-side South African public-holiday API spike with validated fallback |
| `npm run security:check` | Tracked secret/environment-file and AI-attribution check |
| `npm run check` | Full local quality rehearsal except real-database verification |
| `SMOKE_BASE_URL=https://... npm run smoke` | Deployed `/health` and `/ready` smoke test |

The CI workflow uploads `coverage/lcov.info` with the `backend` Codecov flag and `frontend/coverage/lcov.info` with the `frontend` flag. Repository administrators must configure `CODECOV_TOKEN`, protect `main`, and require all checks. Member branches and integration PRs target `main`; this repository does not require a `develop` branch.

See `docs/sprint1-members-1-3-4-5-6-integration.md`, `docs/member-1-handoff.md`, `docs/member-3-handoff.md`, `docs/member-4-handoff.md`, `docs/member-5-handoff.md`, `docs/member-6-handoff.md` and `docs/github-required-checks.md` for completed evidence and repository-admin follow-ups.

## AI declaration

This repository makes use of AI code generation using the following tools: Codex[GPT-5], ChatGPT[GPT-5.6 Sol], Qoder[Auto tier; underlying model automatically routed].

This repository makes use of AI in-line editing using the following tools: Qoder[Auto tier; underlying model automatically routed].

This repository makes use of AI code review using the following tools: Codex[GPT-5], ChatGPT[GPT-5.6 Sol], Qoder[Auto tier; underlying model automatically routed].

The supplied Qoder screenshot records Qoder application version 1.23.0 and VS Code version 1.106.3. Those software versions do not identify the Qoder AI model/tier. Qoder's official model selector can use a specific model or a routed tier, so the actual setting/transcript must be checked rather than inferred from the About dialog.

Commits containing AI-generated code must include the actual assisting tool/model trailer(s), for example:

```text
Assisted-by: ChatGPT[GPT-5.6 Sol]
```

Preserve any existing truthful `Assisted-by` trailers for work generated with Codex or Qoder.

If the original Member 1 commit also contains Qoder-generated code, its actual `Qoder[model]` must appear in that commit trailer. Do not invent the model name. Preserve the required unedited assessment transcript or permitted substitute.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5], ChatGPT[GPT-5.6 Sol].

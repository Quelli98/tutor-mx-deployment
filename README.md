# Tutor Mx System

Tutor Mx is one integrated React + Vite, Auth0, handwritten Express, Prisma and Neon PostgreSQL project. Browser code calls only the Express API; it never connects to Neon, Prisma or an Auth0 Management API.

## Project structure

| Path | Purpose |
| --- | --- |
| `frontend/` | React interface, Auth0 Universal Login, role routing, account lifecycle, tutor dashboard/forms and shared bearer-token request helper |
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

Set the real `DATABASE_URL` only in the backend `.env`. Set matching Auth0 domain, client ID and API audience values in the backend and frontend files. No Auth0 Management API token is used by this implementation.

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

The access token must contain the custom claim named by `AUTH0_ROLES_CLAIM` (default `https://tutormx.example/roles`). Its value is an array containing one of `ORGANISER`, `TUTOR` or `STUDENT`. A Post Login Action can derive this from reviewed Auth0 app metadata; never accept a self-selected role during public sign-up. The matching PostgreSQL `Profile.auth0Id` and `Profile.role` remain the application record, and `/api/me` rejects a stale token/database role mismatch.

### HTTP authentication contract

Every protected browser request uses:

```http
Authorization: Bearer <access-token>
```

| Route | Access | Success | Relevant errors |
| --- | --- | --- | --- |
| `POST /api/auth/password-reset` | Public, validated email | `202 { data: { message } }` with a non-enumerating message | `400 VALIDATION_ERROR`, `503 PASSWORD_RESET_UNAVAILABLE` |
| `GET /api/me` | Valid token and supported matching role | `200 { data: { profile } }` | `401`, `403`, `404` in `{ error: { code, message } }` |
| `GET /api/profile/current` | Valid token and supported matching role | Alias of the current-profile contract | `401`, `403`, `404` |
| `GET /api/courses` | Any supported authenticated role | `200 { data: { courses } }` | `401`, `403`, safe `500` |
| `POST /api/courses` | Organiser | `201 { data: { course } }` | `400`, `401`, `403`, `409` |
| `PATCH /api/courses/:courseId` | Organiser | `200 { data: { course } }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE /api/courses/:courseId` | Organiser | `204` | `400`, `401`, `403`, `404`, `409` |
| `GET /api/tutors` | Organiser | `200 { data: { tutors } }` | `401`, `403`, safe `500` |
| `POST /api/tutors` | Organiser | `201 { data: { tutor } }` | `400`, `401`, `403`, `409` |
| `PATCH /api/tutors/:tutorId` | Organiser | `200 { data: { tutor } }` | `400`, `401`, `403`, `404`, `409` |
| `GET /api/tutor/dashboard` | Tutor; identity comes from token | `200 { data: { dashboard } }` | `401`, `403`, `404`, `409`, safe `500` |
| `POST /api/tutor/time-slots` | Tutor; identity comes from token | `201 { data: { timeSlot } }` | `400`, `401`, `403`, `404`, `409` |
| `POST /api/tutor/work-logs` | Tutor; identity comes from token | `201 { data: { workLog } }` | `400`, `401`, `403`, `404`, `409` |
| `POST /api/tutor/excuses` | Tutor; identity comes from token | `201 { data: { excuse } }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE /api/auth/delete-account` | Valid token and supported role | `202` documented Sprint 1 stub | `401`, `403` |

The API verifies the RS256 signature against Auth0 JWKS, issuer, audience, subject, expiry and not-before values. The frontend token cache is explicitly in memory. Password entry, sign-up, sign-in and the actual new-password form stay on Auth0 Universal Login.

Tutor workflow URLs never accept a browser-supplied tutor identifier. The backend resolves `Profile.auth0Id` from the verified token subject, checks the database role and applies allocation ownership before returning or changing records. The dashboard and forms therefore cannot be redirected to another tutor by changing a URL or request body.

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

See `docs/sprint1-members-1-3-5-6-integration.md`, `docs/member-1-handoff.md`, `docs/member-3-handoff.md`, `docs/member-5-handoff.md`, `docs/member-6-handoff.md` and `docs/github-required-checks.md` for completed evidence and repository-admin follow-ups.

## AI declaration

This repository makes use of AI code generation using the following tools: Codex[GPT-5], Qoder[Auto tier; underlying model automatically routed].

This repository makes use of AI in-line editing using the following tools: Qoder[Auto tier; underlying model automatically routed].

This repository makes use of AI code review using the following tools: Codex[GPT-5], Qoder[Auto tier; underlying model automatically routed].

The supplied Qoder screenshot records Qoder application version 1.23.0 and VS Code version 1.106.3. Those software versions do not identify the Qoder AI model/tier. Qoder's official model selector can use a specific model or a routed tier, so the actual setting/transcript must be checked rather than inferred from the About dialog.

Commits containing the integrated AI-generated code must include this trailer:

```text
Assisted-by: Codex[GPT-5]
```

If the original Member 1 commit also contains Qoder-generated code, its actual `Qoder[model]` must appear in that commit trailer. Do not invent the model name. Preserve the required unedited assessment transcript or permitted substitute.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

# Tutor Mx System

Tutor Mx is one integrated React + Vite, Auth0, handwritten Express, Prisma and Neon PostgreSQL project. Browser code calls only the Express API; it never connects to Neon, Prisma or an Auth0 Management API.

## Demo and team repository

- **Production application (frontend):** https://tutor-mx.pages.dev
- **Production API (backend base URL):** https://tutor-mx-api.onrender.com
- **API health check:** https://tutor-mx-api.onrender.com/health
- **API readiness check (database connectivity):** https://tutor-mx-api.onrender.com/ready

The API base URL has no homepage and may return `NOT_FOUND`. Open the frontend to use the application; use `/health` and `/ready` to check API availability. Keep `VITE_API_BASE_URL` pointed at the API base URL.

- **Official team source repository:** Gitea `innovent/tutor-mx-system`
- **Deployment mirror:** the GitHub copy can be used to trigger the hosted Cloudflare Pages / Render deployment, but team development starts from the latest Gitea `main`.
- **Integrated scope:** Sprint 1–3 foundations and all 18 Sprint 4 Member 1–6 feature cards. See [final audit](docs/final-audit.md) for fixes, validation evidence and remaining external checks.

**Historical verification (2026-09-20, not repeated by this audit):** Frontend HTTP 200 ✓ | Backend /health 200 ✓ | Protected API unauthenticated 401 ✓

The hosted demo follows the repository architecture: the browser loads the React/Vite frontend, Auth0 handles sign-in, React sends an Auth0 bearer token to the handwritten Express API, Express enforces role/ownership checks, and Prisma accesses Neon PostgreSQL. Team members can use the public URL for Sprint 1 demonstrations without receiving production database or Auth0 secrets.

For team work, always pull the latest Gitea `main`, work on your own branch, run the relevant checks, push that branch to Gitea, and tell the Integration Lead when it is ready. The Integration Lead merges approved work into `main`. The GitHub deployment mirror should then be refreshed from the approved Gitea `main` so the public demo stays aligned with the official team repository.


## Project structure

| Path | Purpose |
| --- | --- |
| `frontend/` | React interface, Auth0 Universal Login, role routing, Organiser allocation/course/tutor tools, Tutor dashboard/forms, Student overflow/volunteer flow, shared accessible navigation/status components and bearer-token request helper |
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

The access token must contain the custom claim named by `AUTH0_ROLES_CLAIM` (default `https://tutormx.example/roles`). Its value is an array containing the user's Auth0 roles. Tutor Mx uses `ORGANISER`, `TUTOR` and `STUDENT` as application roles, with `MASTER_ORGANIZER` as an additional Auth0 privilege for approving organiser registrations. **Organisers are lecturers, not Students.** A lecturer who chooses **Register as organiser** creates a pending `OrganiserApplication` linked to the Auth0 identity and lecturer email, but receives no Tutor MX `Profile` and no `ORGANISER` role yet. A Master Organiser approves the registration, after which the backend assigns `ORGANISER` in Auth0 and creates the Neon `Profile` as `ORGANISER`. Pending or rejected organiser applicants cannot enter any Student workspace.

### HTTP authentication contract

Every protected browser request uses:

```http
Authorization: Bearer <access-token>
```

| Route | Access | Success | Relevant errors |
| --- | --- | --- | --- |
| `POST /api/auth/password-reset` | Public, validated email | `202 { data: { message } }` with a non-enumerating message | `400 VALIDATION_ERROR`, `503 PASSWORD_RESET_UNAVAILABLE` |
| `POST /api/auth/onboarding` | Valid Auth0 identity + Student/Tutor selection | Creates the matching Student or Tutor account | `400`, `401`, `403`, `409`, safe `500` |
| `POST /api/auth/organiser-registration` | Valid Auth0 identity | Registers the lecturer's email as a pending organiser application; creates no Student profile or organiser role | `401`, `403`, `409`, safe `500` |
| `POST /api/auth/organiser-application-status` | Public, validated email | Returns `PENDING`, `APPROVED`, `REJECTED`, or `NOT_FOUND` for the organiser registration email | `400`, `503`, safe `500` |
| `GET /api/auth/organiser-application/me` | Authenticated Auth0 identity | Reads the signed-in identity's organiser application even before a Tutor MX profile exists | `401`, `503`, safe `500` |
| `GET /api/me` | Valid token linked to an approved Tutor Mx profile | `200 { data: { profile } }` | `401`, `403`, `404` in `{ error: { code, message } }` |
| `GET /api/profile/current` | Valid token and supported matching role | Alias of the current-profile contract | `401`, `403`, `404` |
| `GET /api/master-organiser/organiser-applications` | Organiser + Auth0 `MASTER_ORGANIZER` | Lists organiser applications | `401`, `403` |
| `POST /api/master-organiser/organiser-applications/:id/approve` | Organiser + Auth0 `MASTER_ORGANIZER` | Grants `ORGANISER` in Auth0, creates/updates the Neon Organiser profile, and records approval | `400`, `401`, `403`, `404`, `409` |
| `POST /api/master-organiser/organiser-applications/:id/reject` | Organiser + Auth0 `MASTER_ORGANIZER` | Rejects the lecturer registration; no Student or Organiser profile is created | `400`, `401`, `403`, `404`, `409` |
| `GET /api/public-holidays?year=YYYY` | Any supported authenticated role | `200 { data: { source, holidays, retrievedAt, reason? } }`; fallback remains a successful non-blocking response | `400`, `401`, `403`, safe `500` |
| `GET /api/courses` | Any supported authenticated role | `200 { data: { courses } }` | `401`, `403`, safe `500` |
| `POST /api/courses` | Organiser | `201 { data: { course } }` | `400`, `401`, `403`, `409` |
| `PATCH /api/courses/:courseId` | Organiser | `200 { data: { course } }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE /api/courses/:courseId` | Organiser | `204` | `400`, `401`, `403`, `404`, `409` |
| `GET /api/tutors` | Organiser | `200 { data: { tutors } }` | `401`, `403`, safe `500` |
| `POST /api/tutors` | Organiser (legacy integration route; not used by the self-service Tutor management UI) | `201 { data: { tutor } }` | `400`, `401`, `403`, `409` |
| `PATCH /api/tutors/:tutorId` | Organiser | `200 { data: { tutor } }` | `400`, `401`, `403`, `404`, `409` |
| `GET /api/tutors/:tutorId/marks` | Organiser | `200 { data: { marks } }` | `400`, `401`, `403`, safe `500` |
| `PUT /api/tutors/:tutorId/marks` | Organiser | `200 { data: { mark } }` | `400`, `401`, `403`, `404`, safe `500` |
| `DELETE /api/tutors/:tutorId/marks/:courseId` | Organiser | `204`; existing allocations remain intact | `400`, `401`, `403`, `404` |
| `GET /api/tutors/:tutorId/time-slots` | Organiser | `200 { data: { timeSlots } }` | `400`, `401`, `403`, safe `500` |
| `POST /api/tutors/:tutorId/time-slots` | Organiser | `201 { data: { timeSlot } }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE /api/tutors/:tutorId/time-slots/:timeSlotId` | Organiser | `204` for a Tutor-owned busy slot | `400`, `401`, `403`, `404` |
| `GET /api/allocations/candidates` | Organiser | `200 { data: { candidates } }` with mark/clash/hour rule results | `400`, `401`, `403`, safe `500` |
| `GET /api/allocations` | Organiser | `200 { data: { allocations } }` with active allocation details | `401`, `403`, safe `500` |
| `POST /api/allocations` | Organiser | `201 { data: { allocation } }` after server-side rule checks | `400`, `401`, `403`, `404`, `409` |
| `PATCH /api/allocations/:allocationId` | Organiser | `200 { data: { allocation } }` after server-side rule checks | `400`, `401`, `403`, `404`, `409` |
| `DELETE /api/allocations/:allocationId` | Organiser | `204` and releases the allocation's committed hours | `400`, `401`, `403`, `404`, `409` |
| `GET /api/organiser/approvals` | Organiser | `200 { data: { timesheets, volunteerClaims } }` for pending queues | `401`, `403`, safe `500` |
| `PATCH /api/timesheets/:timesheetId/decision` | Organiser | Approves or returns a submitted timesheet | `400`, `401`, `403`, `404`, `409` |
| `PATCH /api/volunteer-claims/:claimId/decision` | Organiser | Approves or rejects a pending claim | `400`, `401`, `403`, `404`, `409` |
| `GET /api/tutor/dashboard` | Tutor; identity comes from token | `200 { data: { dashboard } }` | `401`, `403`, `404`, safe `500` |
| `POST /api/tutor/time-slots` | Tutor; identity comes from token | `201 { data: { timeSlot } }` | `400`, `401`, `403`, `404`, `409` |
| `POST /api/tutor/work-logs` | Tutor; identity comes from token | `201 { data: { workLog } }` | `400`, `401`, `403`, `404`, `409` |
| `POST /api/tutor/excuses` | Tutor; identity comes from token | `201 { data: { excuse } }` | `400`, `401`, `403`, `404`, `409` |
| `GET /api/student/open-work` | Student; identity comes from token | `200 { data: { workItems } }` containing only eligible open work not already requested by that Student | `401`, `403`, `404`, safe `500` |
| `GET /api/student/volunteer-requests` | Student; identity comes from token | `200 { data: { volunteerRequests } }` containing only that Student's persisted outcomes | `401`, `403`, `404`, safe `500` |
| `POST /api/student/volunteer-requests` | Student; identity comes from token | `201 { data: { volunteerRequest } }` | `400`, `401`, `403`, `404`, `409` |
| `GET /api/student/volunteer-requests/:requestId` | Student owner only | `200 { data: { volunteerRequest } }` | `400`, `401`, `403`, non-revealing `404` |
| `PATCH /api/student/volunteer-requests/:requestId/withdraw` | Student owner only | `200 { data: { volunteerRequest } }` | `400`, `401`, `403`, non-revealing `404`, `409` |
| `DELETE /api/auth/delete-account` | Valid token and supported role | `204` after the server deletes the Auth0 identity and matching Tutor Mx profile data | `401`, `403`, safe `500` |

The API verifies the RS256 signature against Auth0 JWKS, issuer, audience, subject, expiry and not-before values. The frontend token cache is explicitly in memory. Password entry, sign-up, sign-in and the actual new-password form stay on Auth0 Universal Login.

Tutor workflow URLs never accept a browser-supplied tutor identifier. The backend resolves `Profile.auth0Id` from the verified token subject, checks the database role and applies allocation ownership before returning or changing records. The dashboard and forms therefore cannot be redirected to another tutor by changing a URL or request body.

A newly self-onboarded Tutor may legitimately have no `TutorHourLimit` and no allocations until an Organiser configures them. That state now returns a usable dashboard instead of a `409`: `weeklyLimit` and `remainingHours` are `null`, `usedHours` is still safe to display, and the frontend shows **Weekly hour limit not set yet** plus the normal no-work state.

The protected Organiser workspace now provides complete Sprint 2 course, tutor, allocation and approval workflows. Organisers can add/edit/remove courses, search registered tutor accounts, maintain tutor profile and weekly-hour data, record or remove course marks and busy times, and view mark, timetable-clash and remaining-hour results together before selecting a tutor. Tutor accounts themselves are created by the self-service Auth0 onboarding flow, so organisers never need to copy Auth0 User IDs. The live allocation board creates, edits and removes persisted allocations; every write is rechecked on the server and the board refreshes committed hours and assignments after success. The approvals workspace shows submitted timesheets and pending overflow claims, persists decisions and handles stale decisions safely. Failed checks remain visible and every result includes written Pass/Fail wording so colour is never the only signal.

Sprint 2 replaces the Student overflow mock with the protected handwritten API. The page loads real eligible open work, submits only the selected `overflowWorkId`, and reloads the signed-in Student's persisted pending/approved/rejected/withdrawn outcomes. Student ownership always comes from the verified token; browser-supplied Student IDs are ignored. Public holidays are supporting information loaded through the protected backend adapter, and its safe fallback never blocks the core overflow/volunteer flow. The browser never imports Prisma, connects to Neon or calls the external holiday provider directly.

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

See `docs/member-2-handoff.md`, `docs/sprint2-endpoint-role-matrix.md`, `docs/sprint2-m4-student-overflow.md`, the other `docs/member-*-handoff.md` files and `docs/github-required-checks.md` for completed evidence and repository-admin follow-ups.

## Final release workflow

The integrated features include shared Student/Tutor timetables, mutual availability, bookings and sick-note approvals, scenarios/locks/presence, Tutor swaps, audit/restore, and explainable proposal strategies. The [endpoint matrix](docs/endpoint-role-matrix.md) records role and ownership boundaries.

Run `npm run check` and `npm run coverage` after copying changes into your checkout. Run `npm run db:migrate` against the intended database using its direct connection before releasing; do not reset production or reseed existing production data. See [browser verification](docs/browser-verification.md) for authenticated multi-session checks. Deployment, remote CI, Codecov and production migration status are external checks, not implied by this source archive.

The obsolete `START-HERE-SPRINT4-*.md` files and per-member Sprint 4 handoffs have been removed. When copying this ZIP over an existing Windows checkout, remove the obsolete files listed in [final audit](docs/final-audit.md); extracting over a folder does not delete old files.

## AI declaration

This repository makes use of AI code generation using ChatGPT[model not yet verified] (Raquel) and Qoder[model/Auto setting not yet verified] (other team members), as confirmed by the Integration Lead on 10 October 2026. The final code audit and fixes were assisted by ChatGPT's Codex coding agent[exact underlying model not exposed in this session].

This repository makes use of AI code review using ChatGPT[model not yet verified], including this final Codex-assisted review. Qoder-assisted review must be attributed by its users wherever performed.

AI in-line editing: earlier documentation declared Qoder use, but the latest team statement confirms the tool only. Each member must confirm in-line editing use or non-use and the actual model/Auto setting before submission. Do not turn missing evidence into a non-use declaration.

The [AI declaration and course-policy checklist](AI_DECLARATION.md) is authoritative for this release. Unverified model labels are transparent evidence gaps, not a claim of full attribution compliance. Earlier handoffs retain historical statements; their named tools/models must be checked against original sessions before reuse.

AI-generated code commits require `Assisted-by: <actual-tool>[<actual-model>]` for every assisting tool. Enter verified settings before the final commit; do not copy model names from policy examples. No original Git history was present in the upload, so this audit cannot verify or repair earlier commit trailers.

The preceding document was reviewed and edited with ChatGPT's Codex coding agent[exact underlying model not exposed in this session]. Prior attribution claims require verification as described in AI_DECLARATION.md.

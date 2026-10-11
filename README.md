# Tutor Mx System

Tutor Mx is one integrated React + Vite, Auth0, handwritten Express, Prisma and Neon PostgreSQL project. Browser code calls only the Express API; it never connects to Neon, Prisma or an Auth0 Management API.

## Demo and team repository

- **Production application:** https://tutor-mx.pages.dev
- **Backend API:** Hosted on Render. This is an API service, not a user-facing website.
- **Backend health check:** https://tutor-mx-api.onrender.com/health
- **Database readiness check:** https://tutor-mx-api.onrender.com/ready

The Tutor MX application is accessed through the production frontend linked above. The Render backend provides API services and is not intended to be opened as a website. Visiting the API base URL directly may return `NOT_FOUND`; this does not mean the application is unavailable. Use `/health` and `/ready` to verify service availability. Keep `VITE_API_BASE_URL` pointed at the backend API base URL (`https://tutor-mx-api.onrender.com`), without `/health` or `/ready`.

- **Official team source repository:** Gitea `innovent/tutor-mx-system`.
- **Deployment mirror:** The GitHub copy can be used to trigger the hosted Cloudflare Pages / Render deployment, but team development starts from the latest Gitea `main`.
- **Integrated scope:** Sprint 1–3 foundations and all 18 Sprint 4 Member 1–6 feature cards. See [final audit](docs/final-audit.md) for fixes, validation evidence and remaining external checks.

**Historical verification (2026-09-20, not repeated by this audit):** Frontend HTTP 200 ✓ | Backend `/health` 200 ✓ | Protected API unauthenticated 401 ✓

The hosted demo follows the repository architecture: the browser loads the React/Vite frontend, Auth0 handles sign-in, React sends an Auth0 bearer token to the handwritten Express API, Express enforces role/ownership checks, and Prisma accesses Neon PostgreSQL. Team members can use the public URL for Sprint 1 demonstrations without receiving production database or Auth0 secrets.

For team work, always pull the latest Gitea `main`, work on your own branch, run the relevant checks, push that branch to Gitea, and tell the Integration Lead when it is ready. The Integration Lead merges approved work into `main`. The GitHub deployment mirror should then be refreshed from the approved Gitea `main` so the public demo stays aligned with the official team repository.

## Project structure

| Path | Purpose |
|---|---|
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

    npm ci
    npm ci --prefix frontend
    npm run generate

Copy the two example environment files without committing the copies:

    cp .env.example .env
    cp frontend/.env.example frontend/.env.local

Set the real `DATABASE_URL` only in the backend `.env`. Set matching Auth0 domain, client ID and API audience values in the backend and frontend files. Self-service onboarding and account deletion use server-only Auth0 Management API client credentials when configured; these credentials must never be placed in frontend files or committed.

Apply and seed the database, then start both applications:

    npm run db:migrate
    npm run db:seed
    npm run dev

The frontend defaults to `http://localhost:5173`; the API defaults to `http://localhost:3000`.

## Auth0 setup and role contract

Create an Auth0 Single Page Application and configure these development URLs:

- **Allowed callback URL:** `http://localhost:5173`
- **Allowed logout URL:** `http://localhost:5173`
- **Allowed web origin:** `http://localhost:5173`

Create an Auth0 API whose identifier exactly matches `AUTH0_AUDIENCE` and `VITE_AUTH0_AUDIENCE`, using RS256 access tokens. Configure the database connection named by `AUTH0_DB_CONNECTION` and enable it for the SPA.

The access token must contain the custom claim named by `AUTH0_ROLES_CLAIM` (default `https://tutormx.example/roles`). Its value is an array containing the user's Auth0 roles.

Tutor Mx uses `ORGANISER`, `TUTOR` and `STUDENT` as application roles, with `MASTER_ORGANIZER` as an additional Auth0 privilege for approving organiser registrations.

Organisers are lecturers, not Students. A lecturer who chooses Register as organiser creates a pending `OrganiserApplication` linked to the Auth0 identity and lecturer email, but receives no Tutor MX `Profile` and no `ORGANISER` role yet.

A Master Organiser approves the registration, after which the backend assigns `ORGANISER` in Auth0 and creates the Neon `Profile` as `ORGANISER`. Pending or rejected organiser applicants cannot enter any Student workspace.

## HTTP authentication contract

Every protected browser request uses:

    Authorization: Bearer <access-token>

| Route | Access | Success | Relevant errors |
|---|---|---|---|
| `POST /api/auth/password-reset` | Public, validated email | 202 `{ data: { message } }` with a non-enumerating message | 400 `VALIDATION_ERROR`, 503 `PASSWORD_RESET_UNAVAILABLE` |
| `POST /api/auth/onboarding` | Valid Auth0 identity + Student/Tutor selection | Creates the matching Student or Tutor account | 400, 401, 403, 409, safe 500 |
| `POST /api/auth/organiser-registration` | Valid Auth0 identity | Registers the lecturer's email as a pending organiser application; creates no Student profile or organiser role | 401, 403, 409, safe 500 |
| `POST /api/auth/organiser-application-status` | Public, validated email | Returns `PENDING`, `APPROVED`, `REJECTED`, or `NOT_FOUND` for the organiser registration email | 400, 503, safe 500 |
| `GET /api/auth/organiser-application/me` | Authenticated Auth0 identity | Reads the signed-in identity's organiser application even before a Tutor MX profile exists | 401, 503, safe 500 |
| `GET /api/me` | Valid token linked to an approved Tutor Mx profile | 200 `{ data: { profile } }` | 401, 403, 404 in `{ error: { code, message } }` |
| `GET /api/profile/current` | Valid token and supported matching role | Alias of the current-profile contract | 401, 403, 404 |
| `GET /api/master-organiser/organiser-applications` | Organiser + Auth0 `MASTER_ORGANIZER` | Lists organiser applications | 401, 403 |
| `POST /api/master-organiser/organiser-applications/:id/approve` | Organiser + Auth0 `MASTER_ORGANIZER` | Grants `ORGANISER` in Auth0, creates/updates the Neon Organiser profile, and records approval | 400, 401, 403, 404, 409 |
| `POST /api/master-organiser/organiser-applications/:id/reject` | Organiser + Auth0 `MASTER_ORGANIZER` | Rejects the lecturer registration; no Student or Organiser profile is created | 400, 401, 403, 404, 409 |
| `GET /api/public-holidays?year=YYYY` | Any supported authenticated role | 200 `{ data: { source, holidays, retrievedAt, reason? } }`; fallback remains a successful non-blocking response | 400, 401, 403, safe 500 |
| `GET /api/courses` | Any supported authenticated role | 200 `{ data: { courses } }` | 401, 403, safe 500 |
| `POST /api/courses` | Organiser | 201 `{ data: { course } }` | 400, 401, 403, 409 |
| `PATCH /api/courses/:courseId` | Organiser | 200 `{ data: { course } }` | 400, 401, 403, 404, 409 |
| `DELETE /api/courses/:courseId` | Organiser | 204 | 400, 401, 403, 404, 409 |
| `GET /api/tutors` | Organiser | 200 `{ data: { tutors } }` | 401, 403, safe 500 |
| `POST /api/tutors` | Organiser (legacy integration route; not used by the self-service Tutor management UI) | 201 `{ data: { tutor } }` | 400, 401, 403, 409 |
| `PATCH /api/tutors/:tutorId` | Organiser | 200 `{ data: { tutor } }` | 400, 401, 403, 404, 409 |
| `GET /api/tutors/:tutorId/marks` | Organiser | 200 `{ data: { marks } }` | 400, 401, 403, safe 500 |
| `PUT /api/tutors/:tutorId/marks` | Organiser | 200 `{ data: { mark } }` | 400, 401, 403, 404, safe 500 |
| `DELETE /api/tutors/:tutorId/marks/:courseId` | Organiser | 204; existing allocations remain intact | 400, 401, 403, 404 |
| `GET /api/tutors/:tutorId/time-slots` | Organiser | 200 `{ data: { timeSlots } }` | 400, 401, 403, safe 500 |
| `POST /api/tutors/:tutorId/time-slots` | Organiser | 201 `{ data: { timeSlot } }` | 400, 401, 403, 404, 409 |
| `DELETE /api/tutors/:tutorId/time-slots/:timeSlotId` | Organiser | 204 for a Tutor-owned busy slot | 400, 401, 403, 404 |
| `GET /api/allocations/candidates` | Organiser | 200 `{ data: { candidates } }` with mark/clash/hour rule results | 400, 401, 403, safe 500 |
| `GET /api/allocations` | Organiser | 200 `{ data: { allocations } }` with active allocation details | 401, 403, safe 500 |
| `POST /api/allocations` | Organiser | 201 `{ data: { allocation } }` after server-side rule checks | 400, 401, 403, 404, 409 |
| `PATCH /api/allocations/:allocationId` | Organiser | 200 `{ data: { allocation } }` after server-side rule checks | 400, 401, 403, 404, 409 |
| `DELETE /api/allocations/:allocationId` | Organiser | 204 and releases the allocation's committed hours | 400, 401, 403, 404, 409 |
| `GET /api/organiser/approvals` | Organiser | 200 `{ data: { timesheets, volunteerClaims } }` for pending queues | 401, 403, safe 500 |
| `PATCH /api/timesheets/:timesheetId/decision` | Organiser | Approves or returns a submitted timesheet | 400, 401, 403, 404, 409 |
| `PATCH /api/volunteer-claims/:claimId/decision` | Organiser | Approves or rejects a pending claim | 400, 401, 403, 404, 409 |
| `GET /api/tutor/dashboard` | Tutor; identity comes from token | 200 `{ data: { dashboard } }` | 401, 403, 404, safe 500 |
| `POST /api/tutor/time-slots` | Tutor; identity comes from token | 201 `{ data: { timeSlot } }` | 400, 401, 403, 404, 409 |
| `POST /api/tutor/work-logs` | Tutor; identity comes from token | 201 `{ data: { workLog } }` | 400, 401, 403, 404, 409 |
| `POST /api/tutor/excuses` | Tutor; identity comes from token | 201 `{ data: { excuse } }` | 400, 401, 403, 404, 409 |
| `GET /api/student/open-work` | Student; identity comes from token | 200 `{ data: { workItems } }` containing only eligible open work not already requested by that Student | 401, 403, 404, safe 500 |
| `GET /api/student/volunteer-requests` | Student; identity comes from token | 200 `{ data: { volunteerRequests } }` containing only that Student's persisted outcomes | 401, 403, 404, safe 500 |
| `POST /api/student/volunteer-requests` | Student; identity comes from token | 201 `{ data: { volunteerRequest } }` | 400, 401, 403, 404, 409 |
| `GET /api/student/volunteer-requests/:requestId` | Student owner only | 200 `{ data: { volunteerRequest } }` | 400, 401, 403, non-revealing 404 |
| `PATCH /api/student/volunteer-requests/:requestId/withdraw` | Student owner only | 200 `{ data: { volunteerRequest } }` | 400, 401, 403, non-revealing 404, 409 |
| `DELETE /api/auth/delete-account` | Valid token and supported role | 204 after the server deletes the Auth0 identity and matching Tutor Mx profile data | 401, 403, safe 500 |

The API verifies the RS256 signature against Auth0 JWKS, issuer, audience, subject, expiry and not-before values. The frontend token cache is explicitly in memory. Password entry, sign-up, sign-in and the actual new-password form stay on Auth0 Universal Login.

Tutor workflow URLs never accept a browser-supplied tutor identifier. The backend resolves `Profile.auth0Id` from the verified token subject, checks the database role and applies allocation ownership before returning or changing records. The dashboard and forms therefore cannot be redirected to another tutor by changing a URL or request body.

A newly self-onboarded Tutor may legitimately have no `TutorHourLimit` and no allocations until an Organiser configures them. That state returns a usable dashboard instead of a 409: `weeklyLimit` and `remainingHours` are null, `usedHours` is still safe to display, and the frontend shows Weekly hour limit not set yet plus the normal no-work state.

The protected Organiser workspace provides complete Sprint 2 course, tutor, allocation and approval workflows. Organisers can add/edit/remove courses, search registered tutor accounts, maintain tutor profile and weekly-hour data, record or remove course marks and busy times, and view mark, timetable-clash and remaining-hour results together before selecting a tutor. Tutor accounts themselves are created by the self-service Auth0 onboarding flow, so organisers never need to copy Auth0 User IDs. The live allocation board creates, edits and removes persisted allocations; every write is rechecked on the server and the board refreshes committed hours and assignments after success. The approvals workspace shows submitted timesheets and pending overflow claims, persists decisions and handles stale decisions safely. Failed checks remain visible and every result includes written Pass/Fail wording so colour is never the only signal.

Sprint 2 replaces the Student overflow mock with the protected handwritten API. The page loads real eligible open work, submits only the selected `overflowWorkId`, and reloads the signed-in Student's persisted pending/approved/rejected/withdrawn outcomes. Student ownership always comes from the verified token; browser-supplied Student IDs are ignored. Public holidays are supporting information loaded through the protected backend adapter, and its safe fallback never blocks the core overflow/volunteer flow. The browser never imports Prisma, connects to Neon or calls the external holiday provider directly.

## Automated checks

| Command | Purpose |
|---|---|
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

The CI workflow uploads `coverage/lcov.info` with the backend Codecov flag and `frontend/coverage/lcov.info` with the frontend flag. Repository administrators must configure `CODECOV_TOKEN`, protect `main`, and require all checks. Member branches and integration PRs target `main`; this repository does not require a `develop` branch.

See `docs/member-2-handoff.md`, `docs/sprint2-endpoint-role-matrix.md`, `docs/sprint2-m4-student-overflow.md`, the other `docs/member-*-handoff.md` files and `docs/github-required-checks.md` for completed evidence and repository-admin follow-ups.

## Final release workflow

The integrated features include shared Student/Tutor timetables, mutual availability, bookings and sick-note approvals, scenarios/locks/presence, Tutor swaps, audit/restore, and explainable proposal strategies. The endpoint matrix records role and ownership boundaries.

Run `npm run check` and `npm run coverage` after copying changes into your checkout. Run `npm run db:migrate` against the intended database using its direct connection before releasing; do not reset production or reseed existing production data. See browser verification for authenticated multi-session checks. Deployment, remote CI, Codecov and production migration status are external checks, not implied by this source archive.

The obsolete `START-HERE-SPRINT4-*.md` files and per-member Sprint 4 handoffs have been removed. When copying a source archive over an existing Windows checkout, remove any obsolete files listed in the final audit; extracting over a folder does not delete old files.

## AI declaration

### AI tools and configurations

The Integration Lead confirmed the use of ChatGPT and Codex for development, debugging, code generation, code review, integration and release documentation. Other team members used Qoder.

The AI tools and configurations identified from user-provided information and screenshots on 11 October 2026 are:

| Contributor or activity | AI tool | Reported model or setting | Usage |
|---|---|---|---|
| Integration Lead | ChatGPT | GPT-6, High thinking effort | Code generation, technical guidance, debugging, integration support, documentation and code review |
| Integration Lead | ChatGPT Work | GPT-6 Astra, Max thinking effort | Extended implementation, code analysis, repository audits, integration and documentation assistance |
| Other team members | Qoder | Auto | AI-assisted software development, coding and debugging |
| Integration Lead; final audit and coding tasks | Codex extension in Visual Studio Code | Agent environment: Windows native; speed: Fast; underlying model not verified | Code generation, code auditing, bug fixes, repository review and implementation assistance where used |

**ChatGPT:** The model and thinking-effort settings reported for the Integration Lead are `ChatGPT [GPT-6, High]` and `ChatGPT Work [GPT-6 Astra, Max]`. These are user-reported configurations supported by the supplied interface screenshots. A screenshot of the current setting does not independently establish the model used for every historical interaction or code contribution.

**Qoder:** The other team members used `Qoder [Auto]`. Auto is a model-selection setting rather than an exact model identifier. The underlying model chosen for any particular Qoder interaction has not been independently verified.

**Codex:** The Integration Lead used the Codex extension within Visual Studio Code. The provided Codex settings screenshot confirms that the agent environment is configured as `Windows native` and the speed setting is `Fast`. The interface also shows review-delivery preferences, but these are not AI model identifiers.

The screenshot does not display the underlying Codex model name or version. Consequently, the model must be recorded as **not verified**, rather than assumed to be GPT-6, GPT-6 Astra or another model.

The Codex Windows-native configuration refers to the execution environment, while Fast refers to the agent's speed preference. Neither identifies the model used for code generation or review.

### AI code generation

This repository makes use of AI code generation and AI-assisted development using:

- `ChatGPT [GPT-6, High]`, as reported by the Integration Lead.
- `ChatGPT Work [GPT-6 Astra, Max]`, as reported by the Integration Lead.
- `Qoder [Auto]`, as reported for the other team members.
- `Codex (VS Code extension) [underlying model not verified]`, as used for relevant coding and integration tasks.

AI assistance included code generation, reviewing existing functionality, diagnosing errors, supporting the integration process, preparing fixes and explaining implementation steps.

Individual code changes should be attributed to the tools actually used for those changes. The presence of a tool in this declaration does not imply it contributed to every file or commit.

### AI code review

This repository makes use of AI-assisted code review through ChatGPT, ChatGPT Work and the Codex extension.

The final audit and associated coding review were assisted by Codex in Visual Studio Code, with the underlying model unverified.

Qoder-assisted code review should be attributed to the relevant team members wherever it occurred. Use of Qoder for software development does not automatically establish that it was used for every code review.

### AI in-line editing

Earlier project documentation declared Qoder-assisted development. The confirmed Qoder setting is Auto.

Each team member must confirm whether they used AI in-line editing, code generation, code review or other AI features in their own workflow.

The use of the Codex extension in Visual Studio Code is separately disclosed. Its presence does not, by itself, establish which editor actions or files were modified using AI.

Missing or unverifiable usage evidence must not be converted into a declaration that AI was not used.

### AI attribution and academic policy compliance

The project AI declaration and course-policy checklist remain authoritative for final submission.

The following configurations have been reported:

| Tool | Attribution information |
|---|---|
| ChatGPT | `ChatGPT [GPT-6, High]` |
| ChatGPT Work | `ChatGPT Work [GPT-6 Astra, Max]` |
| Qoder | `Qoder [Auto]` |
| Codex | `Codex (VS Code extension) [underlying model not verified; Windows native; Fast]` |

Where required by the course AI policy, AI-assisted code commits must include an `Assisted-by: <actual-tool>[<actual-model>]` trailer for each assisting tool.

Attribution must be based on the tool and model actually used for the particular change. The settings above must not be copied indiscriminately into historical commits. A setting such as Qoder Auto, or an unverified Codex model, does not establish an exact underlying model if the academic policy requires one.

Earlier handoffs and AI-attribution statements should be checked against the original usage evidence before reuse. Any missing model information remains an explicit evidence gap rather than a claim of full attribution compliance.

### Documentation assistance

The final repository audit and fixes received assistance from the Codex extension in Visual Studio Code, as described above.

This README was subsequently revised with ChatGPT (GPT-6, High thinking effort) assistance to:

- Clarify the correct public application URL and distinguish it from the Render backend API.
- Preserve the existing project architecture, setup instructions, authentication contract and release documentation.
- Update AI-use declarations to reflect ChatGPT, ChatGPT Work, Qoder and Codex configurations.
- Distinguish verified settings from underlying model information that has not been established.

Detailed AI-use evidence and historical attribution should be cross-checked against `AI_DECLARATION.md` and the project AI policy before final academic submission.

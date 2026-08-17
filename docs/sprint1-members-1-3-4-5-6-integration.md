# Sprint 1 Members 1, 3, 4, 5 and 6 integration

## Integration result

This main-ready source starts from the supplied current `main` snapshot, which already contains Members 1, 3, 5 and 6, and integrates the supplied Member 4 Student overflow/shared-interface branch on top of it. Member 2 remains pending.

The integration was checked against physical pages 1-29 of the 16 August 2026 Sprint Handbook. In particular, the Member 4 work is mapped to S1-M4-1, S1-M4-2 and S1-M4-3 while preserving the existing Auth0 -> handwritten Express -> Prisma -> Neon architecture and the handbook rule that browser code must not connect directly to Neon.

## What was integrated from Member 4

### S1-M4-1 - Student overflow page shell

- `/student` now renders the protected `StudentOverflow` view instead of a placeholder role page.
- The page exposes the Sprint 1 work-item fields required by the handbook: `id`, `courseCode`, `courseName`, `startsAt`, `endsAt`, `hours`, `status` and `closesAt`.
- Open work shows course, date/time, expected hours and availability.
- Closed/non-open work cannot be volunteered for.
- Loading, empty, error and retry states are present.
- The current Sprint 1 implementation deliberately keeps Member 4's agreed mock work boundary. No unfinished Student backend endpoint was invented during integration.

### S1-M4-2 - Shared role navigation and status components

- Role-aware navigation shows only the current role's permitted workspace links plus shared account settings.
- Tutor-only forms stay Tutor-only.
- `StatusMessage` provides shared loading, empty, error and success states.
- `SkipToContent` and visible `:focus-visible` styling support keyboard users.
- The shared `#main-content` target is now present on Organiser, Student, Account Settings and the integrated Tutor dashboard/forms main containers.
- Responsive rules keep role navigation and shared status/action areas usable at common phone widths.

### S1-M4-3 - Volunteer confirmation and shared UI tests

- Selecting **Volunteer** opens a confirmation dialog that repeats the selected work details.
- Cancel closes the dialog without sending a claim.
- Confirm enters a pending state and disables both confirmation actions until the request settles.
- Repeated confirm clicks are blocked while pending.
- Already-unavailable work returns the safe `WORK_NOT_AVAILABLE` path; unexpected failures are converted to a generic student-facing message.
- The supplied component/API tests for Student overflow, shared status and confirmation are included.

## Integration fixes made by the Integration Lead

The supplied Member 4 archive contained `frontend/src/api/StudentOverflow.js` while the React imports used `../api/studentOverflow`. That works on case-insensitive file systems but fails on Linux/Cloudflare-style case-sensitive builds. The integrated file is therefore named:

```text
frontend/src/api/studentOverflow.js
```

No new dependency was required, so the existing current-main `package.json` and lock files were preserved rather than replacing them with lockfile metadata-only changes from the Member 4 archive.

The shared skip-link target was also extended to the existing Account Settings, Tutor Dashboard and Tutor Forms main containers so Member 4's shared accessibility shell has a valid destination across the already-integrated role pages.

## Current Sprint 1 member mapping

| Member | Current integrated Sprint 1 scope | Evidence |
| --- | --- | --- |
| 1 | Auth0 entry/account lifecycle, role routing, bearer-token contract and permission tests | `frontend/src/auth/`, `frontend/src/features/AccountSettings.jsx`, `frontend/src/routes/`, `src/auth/`, `docs/member-1-handoff.md` |
| 3 | Own-Tutor dashboard, availability, work logs, excuses and Tutor UI tests | `frontend/src/features/Tutor*.jsx`, Tutor form components, Tutor API files, `docs/member-3-handoff.md` |
| 4 | Student overflow shell, shared role navigation/status UI, confirmation/duplicate-submit flow and tests | `frontend/src/features/StudentOverflow.jsx`, `frontend/src/components/shared/`, `frontend/src/api/student*.js`, `docs/member-4-handoff.md` |
| 5 | Separate handwritten Express API, auth middleware, safe errors, allocation rules and backend tests | `src/app.ts`, `src/server.ts`, `src/auth/`, `src/services/`, `docs/member-5-handoff.md` |
| 6 | Prisma/Neon schema and migrations, safe seed data, external-service spike, CI/Codecov and deployment integration | `prisma/`, `src/integrations/`, `.gitea/workflows/`, `.github/workflows/`, `docs/member-6-handoff.md` |
| 2 | Pending integration | Do not claim Member 2 Sprint 1 role screens complete until that branch is reviewed/integrated. |

## Security and AI-policy checks

- Student/Tutor browser code contains no Prisma import, PostgreSQL client import or `DATABASE_URL` use.
- Student role routing remains behind `ProtectedRoute`; hidden navigation is not treated as the backend security boundary.
- Member 4's mock boundary contains only non-secret Student-facing fields and does not expose Auth0/Neon internals.
- The repository secret/environment and AI-declaration check passes on the integrated tracked file set.
- The repository AI declaration records this 17 August 2026 integration as assisted by `ChatGPT[GPT-5.6 Sol]` and preserves the supplied Member 4 document-attribution statement without guessing additional model usage.

## Verification performed for this archive

The integration environment could not reach the npm registry because DNS resolution timed out, so dependencies could not be freshly installed here. In accordance with the handbook AI/testing policy, no fresh npm/Vitest/coverage result is claimed for this 17 August integration.

The following checks **were** completed on the final source tree:

- TypeScript parser syntax validation for all backend/frontend JS, JSX and TS source files;
- exact-case relative-import resolution check, including the corrected `studentOverflow.js` path;
- frontend boundary scan for Prisma/PostgreSQL/`DATABASE_URL` access;
- tracked-file secret/environment and AI-attribution check; and
- `git diff --cached --check` whitespace validation.

The supplied Member 4 handoff records a prior successful branch run, but the team should rerun the full current-main suite after copying this archive into the local Gitea clone.

## Required local release check before push

From the updated local repository root:

```bash
npm ci
npm ci --prefix frontend
npm run generate
npm run check
npm run coverage
npm run security:check
git diff --check
```

Do not mark Gitea CI/Codecov green unless the lecturer-managed runner actually executes successfully. If the runner is still unavailable, keep the external blocker and attach the local output instead.

## Main-branch integration rule

This archive is prepared for the Integration Lead's own reviewed integration work. The normal member rule remains: pull current Gitea `main`, work on a member branch, push that branch, notify the group and let the Integration Lead integrate approved work into `main`.

Commit the Integration Lead's AI-assisted integration with the actual assisting model, for example:

```text
Assisted-by: ChatGPT[GPT-5.6 Sol]
```

The preceding document was generated and reviewed with the assistance of the following: ChatGPT[GPT-5.6 Sol].

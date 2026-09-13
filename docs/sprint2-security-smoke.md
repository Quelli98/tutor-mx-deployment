# Sprint 2 Cross-Role Security Smoke Suite (S2-M1-3)

Branch: `s2/m1/security-smoke` (reviewer: Member 3). Integration audit updated 13 September 2026 after the Member 4/5/6 Basic journeys were integrated.

This is the repeatable three-role smoke suite the Integration Lead runs before the Sprint 2 release decision. It verifies:

1. Separate Student, Tutor and Organiser accounts resolve only to their expected workspace/role surface.
2. Every authenticated Basic API route has consistent missing/expired-token handling, and every role-restricted route rejects each wrong role with `403 FORBIDDEN`.
3. Tutor and Student own-data routes use the verified token subject rather than a browser-supplied identity.
4. Any severity-one/two security defect blocks release until fixed or formally recorded as a blocker.

## Two layers

| Layer | Artefact | Runs against | Evidence |
| --- | --- | --- | --- |
| Automated in-process suite | `src/security-smoke.test.ts` | Exact Express app with deterministic injected dependencies | Vitest output; safe to run locally/CI |
| Live shared-environment runner | `scripts/security-smoke.ts` via `npm run security:smoke` | Deployed Render/API environment with real Auth0 tokens | PASS/FAIL output retained with release evidence |

## Automated suite coverage

`src/security-smoke.test.ts` is aligned to the current S2-M1-2 matrix, including the routes added by Members 4, 5 and 6.

- **Three-role journeys:** `GET /api/me` resolves the Student/Tutor/Organiser profile expected by the frontend router. Student real overflow and volunteer-request reads, Tutor dashboard/timesheet status, and Organiser tutor/candidate/allocation paths are exercised with the permitted persona.
- **Missing token sweep:** all **36 authenticated routes** answer `401 AUTHENTICATION_REQUIRED` without a bearer token.
- **Expired/invalid token sweep:** the same 36 routes answer `401 INVALID_ACCESS_TOKEN` when verification rejects the token.
- **Wrong-role sweep:** every role-restricted route is called with every disallowed persona and must return `403 FORBIDDEN` without leaking persona email/data.
- **Current Basic coverage:** the sweep includes real Student overflow/volunteer routes, allocation create/edit/remove, organiser timesheet/claim/excuse decisions, Tutor timesheet/excuse status routes, and `GET /api/public-holidays` in addition to the Sprint 1 routes.
- **Own-data manipulation:** spoofed `tutorId`/`studentId` values do not become ownership; Tutor writes and Tutor/Student status/request reads are delegated with the authenticated `auth.subject`.
- **Account binding:** unlinked valid tokens fail closed with `404 PROFILE_NOT_FOUND`; token/database role disagreement returns `403 ROLE_MISMATCH`.
- **Public surface:** `/health`, `/ready` and password-reset remain public as designed; onboarding remains authenticated.

The detailed endpoint list and route-specific evidence are in `docs/sprint2-endpoint-role-matrix.md`.

## Live shared-environment runner

The live runner contains **22 side-effect-safe probes**. Successful probes are read-only. Any write probe is intentionally made with a disallowed/missing token so the request must stop at auth/role middleware before persistence.

It checks:

- health/readiness;
- Student/Tutor/Organiser `/api/me` role resolution;
- Student real overflow and the safe public-holiday backend route;
- permitted Tutor dashboard and Organiser tutor-list reads;
- wrong-role access in both directions, including Student overflow, course writes, allocation writes and Tutor availability;
- missing-token read/write behavior; and
- invalid/tampered-token behavior (`401 INVALID_ACCESS_TOKEN`).

A tampered signature is used as the live runner's safe expired-token equivalent because both fail through the same access-token verification path.

## Local commands

From the repository root:

```bash
npm ci
npm ci --prefix frontend
npm run generate
npx vitest run src/security-smoke.test.ts
npm run check
npm run coverage
```

The full handbook gate remains authoritative: the targeted smoke file is extra evidence, not a replacement for `npm run check` or coverage.

## Shared-environment run

Create/retain three dedicated test accounts and complete normal Tutor Mx onboarding so they have separate `STUDENT`, `TUTOR` and `ORGANISER` profiles. Then obtain a fresh API access token for each account and set environment variables only for the terminal session.

```powershell
$env:SMOKE_BASE_URL = "https://<deployed-backend-origin>"
$env:SMOKE_STUDENT_TOKEN = "<student access token>"
$env:SMOKE_TUTOR_TOKEN = "<tutor access token>"
$env:SMOKE_ORGANISER_TOKEN = "<organiser access token>"
npm run security:smoke
```

Expected format:

```text
Tutor Mx cross-role security smoke against <origin>
Started at <timestamp>

PASS  <probe> (HTTP <status>)
...
22/22 checks passed.
```

Do not put tokens in source files, screenshots, issues or chat. Clear the shell variables when the run is finished.

## Browser complement

For each dedicated account, use a clean browser session and confirm normal sign-in lands at `/student`, `/tutor` or `/organiser`. Manually type another role's route and verify the access-denied behavior rather than that role's data. For an existing linked account, normal sign-in must not return to role choice.

## Failure handling

If any automated/live/manual probe fails, record a reproducible issue with the probe name, expected/actual result, role used, timestamp and non-secret evidence. Fix Member 1-owned permission/session defects on the Member 1 integration branch; hand other defects to their owning Member. A severity-one/two security issue blocks the release decision until fixed/re-tested or formally recorded as a release blocker.

## Evidence status

The source package supplied for S2-M1-3 had a valid earlier smoke suite, but it still reflected the pre-integration Basic route set (19 critical endpoints / 17 live probes). The 13 September integration audit updated it to the current real Sprint 2 route set and removed the obsolete Student-mock assumption. Record the **actual local/CI counts from the commands above** and attach the completed Gitea Actions/Codecov result before marking the issue Done.

# Sprint 1 Member 1 handoff

## Integrated scope

### S1-M1-1 - Auth0 sign-up, sign-in and sign-out

- Auth0 React SDK and Universal Login handle sign-up/sign-in; Tutor Mx stores no passwords.
- The entry UI has explicit loading/error states and disables duplicate submissions.
- Sign-out returns to the application origin and protected routing depends on live Auth0 state.
- Frontend tests cover sign-in, sign-up, safe failure, role entry and sign-out.

### S1-M1-2 - Password reset, account deletion shell and role routing

- `/reset-password` provides a labelled email request form with a deliberately non-enumerating response.
- `/new-password` explains that the actual password form is hosted by Auth0; no Tutor Mx code receives the password.
- Account settings provide two-step deletion with exact `DELETE` confirmation, Cancel behavior, duplicate-submit prevention and a documented `202` backend stub.
- `ROLE_ROUTE_MAP` is authoritative for `ORGANISER`, `TUTOR` and `STUDENT`. Only the matching role link is rendered, and unknown/missing roles are blocked rather than defaulting to Student.

### S1-M1-3 - Authentication contract and permission tests

- `Authorization: Bearer <access-token>` is attached by one frontend helper.
- The Express verifier checks RS256 signatures from Auth0 JWKS plus issuer, audience, expiry, not-before and subject claims.
- Protected routes return safe `401`/`403` JSON. `/api/me` also rejects token/database role mismatches.
- Backend tests cover no token, invalid/expired token, wrong/missing role, permitted role, role mismatch and protected deletion.

## Test and evidence commands

After installing both package-lock files:

```bash
npm run generate
npm run lint
npm run typecheck
npm test
npm run coverage
npm run build
npm run security:check
```

Expected LCOV files are `coverage/lcov.info` and `frontend/coverage/lcov.info`. CI uploads them under separate Codecov flags.

Final local verification for the Members 1, 3, 5 and 6 integration:

- Backend: 12 test files, 117 tests passed; 94.04% statements, 91.00% branches, 87.30% functions and 94.02% lines.
- Frontend: 15 test files, 52 tests passed; 89.34% statements, 83.85% branches, 93.61% functions and 92.26% lines in the conservative clean-archive run.
- Backend/frontend lint, strict backend type-check, both production builds and the tracked-file secret/AI-attribution check passed.
- A built API smoke returned `200 {"status":"ok"}` for `/health` and the agreed safe `401` JSON for unauthenticated `/api/me`.
- The current cross-member acceptance mapping, including Member 4, is in `docs/sprint1-members-1-3-4-5-6-integration.md`. The counts above remain the earlier Members 1, 3, 5 and 6 verification snapshot.

## Sprint 2

### S2-M1-1 - Auth lifecycle hardening and email-verification recovery

Branch: `s2/m1/account-lifecycle` (reviewer: Member 3).

- The Sprint 1 self-service onboarding flow is unchanged; the hardening only covers its edge cases.
- A linked existing account never returns to role choice: a stale pending role that conflicts with the linked profile (`409 ROLE_ALREADY_SET`) is dropped automatically and the user continues straight into their existing workspace.
- An unverified email gets a recovery path: `POST /api/auth/resend-verification` (authenticated, rate-limited, non-enumerating `202`, safe `503`) triggers the Auth0 Management API verification-email job server-side, and the onboarding card exposes a **Resend verification email** button with Try again / Sign out.
- Deletion cannot leave a false signed-in state: a successful `DELETE /api/auth/delete-account` now signs the user out automatically (`returnTo` origin); if the SDK logout itself fails, a fallback message points to the navigation sign-out. Deletion failures keep the form usable for retry and never call logout.
- Failure/recovery tests: backend 202/503/401 for resend-verification; frontend stale-role conflict recovery, unverified-email resend flow, automatic logout after deletion, deletion failure retry.

Local verification for S2-M1-1 (31 August 2026):

- Backend: 13 test files, 146 tests passed. Frontend: 26 test files, 152 tests passed.
- `npm run lint` and `npm run typecheck` pass after `npm run generate`.
- Prerequisite installs: `npm install` at the repository root and in `frontend/` (restores `supertest` and `@testing-library/user-event`).

### S2-M1-2 - Role and ownership protection across the completed Basic API

Branch: `s2/m1/role-protection` (reviewer: Member 3).

- The endpoint-to-role/ownership matrix in `docs/sprint2-endpoint-role-matrix.md` was refreshed during the 13 September integration audit so it now includes the real Student overflow/volunteer API, allocation mutations, organiser approval/decision routes, Tutor status routes and public-holiday route from the integrated Member 4/5/6 baseline.
- The integrated cross-role sweep in `src/security-smoke.test.ts` covers all 36 authenticated Basic routes for missing/expired tokens and every meaningful wrong-role combination. Existing Member 5 organiser/workflow suites continue to provide detailed validation, conflict and state-transition evidence.
- Cross-user protection is asserted at the query level: allocation lookups for work logs and excuses are scoped `where { id, tutorId }`, so a manipulated allocation id for another tutor yields `404 ALLOCATION_NOT_FOUND` with no data exposure.
- No permission defect was found: the audited middleware chains and service ownership filters were already correct, so no security logic moved into React.
- Frontend route guards and backend authorisation remain consistent (RoleRouter/ProtectedRoute hide pages per role; the API independently enforces the matrix).

Local verification for S2-M1-2 (31 August 2026):

- Backend: 13 test files, 150 tests passed; backend lint and strict type-check pass. Frontend unchanged from S2-M1-1 (152 tests).

### S2-M1-3 - Cross-role security smoke suite and assigned fixes

Branch: `s2/m1/security-smoke` (reviewer: Member 3).

- `src/security-smoke.test.ts` now targets the current integrated Sprint 2 Basic API rather than the older pre-Student-integration route set. It exercises Student/Tutor/Organiser persona journeys, all 36 authenticated routes for missing/expired tokens, every wrong-role combination, own-subject forwarding for Tutor/Student routes, unlinked profiles and token/database role mismatch.
- `scripts/security-smoke.ts` plus `npm run security:smoke` provides a 22-probe live shared-environment sequence. Successful probes are read-only; write probes are intentionally rejected before persistence.
- `docs/sprint2-security-smoke.md` documents the three-account setup, local/full-gate commands, live run, browser complement and blocker handling.
- The integration audit found and fixed the main completeness defect in the supplied M1-2/M1-3 evidence: both the role matrix and security smoke still described the old Sprint 1 Student mock boundary even though Members 4/5/6 had already made those Basic routes real.

Integration verification status (13 September 2026):

- Static inspection confirms the combined Member 1 package preserves the integrated Member 4/5/6 route/service contracts while adding M1-1, M1-2 and M1-3 together.
- Dependency installation could not be completed in this sandbox because `npm ci` terminated with an npm internal `Exit handler never called!` error. Do **not** treat that as passing test evidence. Run the handbook gate locally (`npm ci`, frontend `npm ci`, `npm run generate`, `npm run check`, `npm run coverage`) and keep the actual output plus Gitea Actions/Codecov evidence before merging.

## External actions still owned by the team

- Configure the Auth0 SPA, API audience, database connection, callback/logout/origin URLs and reviewed role-claim Action.
- Configure the server-only Auth0 Management API permissions for self-service onboarding. New users are now linked to matching Auth0 roles and Neon `Profile` records automatically by `POST /api/auth/onboarding`; manual per-user linking is no longer the normal path.
- Configure `CODECOV_TOKEN`, keep `main` protected, open the Member 1 integration PR into `main` and obtain the assigned Member 3 review/Integration Lead approval.
- The supplied evidence confirms Qoder application version 1.23.0, VS Code version 1.106.3, Quest Agent mode and the Auto tier. The underlying model was automatically routed and not disclosed; use `Qoder[Auto tier; underlying model automatically routed]` and do not guess a provider model.
- Commit this generated integration with `Assisted-by: Codex[GPT-5]` and retain the required assessment transcript or allowed substitute.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

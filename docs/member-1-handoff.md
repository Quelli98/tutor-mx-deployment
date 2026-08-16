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
- The full cross-member acceptance mapping is in `docs/sprint1-members-1-3-5-6-integration.md`.

## External actions still owned by the team

- Configure the Auth0 SPA, API audience, database connection, callback/logout/origin URLs and reviewed role-claim Action.
- Link Auth0 subjects to the correct `Profile.auth0Id` and role records in Neon.
- Configure `CODECOV_TOKEN`, protect `main`, open the required issue PRs into `main` and obtain Member 2 review.
- The supplied evidence confirms Qoder application version 1.23.0, VS Code version 1.106.3, Quest Agent mode and the Auto tier. The underlying model was automatically routed and not disclosed; use `Qoder[Auto tier; underlying model automatically routed]` and do not guess a provider model.
- Commit this generated integration with `Assisted-by: Codex[GPT-5]` and retain the required assessment transcript or allowed substitute.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

# Sprint 1 Members 1-6 Integration

## Integration result

This main-ready source starts from live Gitea `main` commit `c5a1e19071a2aade57f651ec5e8ed0c6b14e8b01`, which already contained Members 1, 3, 4, 5 and 6, and integrates the supplied Member 2 `s1/m2/course-tutor-ui` branch after review and correction.

The review used physical pages 1-29 of `Tutor_Mx_Sprint_Handbook_Express_Neon_Updated(9).pdf`. Member 2's work maps to S1-M2-1, S1-M2-2 and S1-M2-3 while preserving the established React -> Auth0 bearer token -> handwritten Express -> Prisma -> Neon architecture.

## Member 2 corrections completed during integration

The supplied branch correctly introduced tested course and basic tutor management, protected Organiser navigation and compatible backend endpoints. It did not yet cover all of Member 2's Sprint 1 acceptance criteria. The integration therefore added:

- the `/organiser` allocation-board shell;
- course/session/minimum-mark/required-hour inputs;
- same-page candidate loading, empty, error/retry and result states;
- a reusable Pass/Fail/Not checked rule-result component;
- simultaneous mark, clash and remaining-hour messages;
- eligible-only tutor selection and the handbook-approved save placeholder;
- course marks and once-off/weekly busy-time controls for each tutor;
- frontend validation of all new API response contracts;
- responsive phone layout and keyboard/focus coverage; and
- valid, invalid, threshold-boundary, safe-error and access-control tests.

## Current Sprint 1 member mapping

| Member | Integrated Sprint 1 scope | Evidence |
| --- | --- | --- |
| 1 | Auth0 entry/account lifecycle, self-service role onboarding, role routing, bearer-token contract and permission tests | `frontend/src/auth/`, `frontend/src/features/AccountSettings.jsx`, `src/auth/`, `docs/member-1-handoff.md` |
| 2 | Organiser allocation board, course/tutor management, tutor marks/busy times/hour limits, immediate rule messages and UI/API tests | `frontend/src/features/OrganiserDashboard.jsx`, Organiser management/API files, `src/app.ts`, `src/server.ts`, `docs/member-2-handoff.md` |
| 3 | Own-Tutor dashboard, availability, work logs, excuses and Tutor UI tests | `frontend/src/features/Tutor*.jsx`, Tutor API files, `docs/member-3-handoff.md` |
| 4 | Student overflow shell, shared role navigation/status UI, confirmation/duplicate-submit flow and tests | `frontend/src/features/StudentOverflow.jsx`, shared components, Student API files, `docs/member-4-handoff.md` |
| 5 | Handwritten Express API, auth middleware, safe errors, allocation rules and backend tests | `src/app.ts`, `src/server.ts`, `src/auth/`, `src/services/`, `docs/member-5-handoff.md` |
| 6 | Prisma/Neon schema and migrations, safe seed data, allocation queries, external-service spike, CI/Codecov and delivery integration | `prisma/`, `src/services/`, `src/integrations/`, workflow files, `docs/member-6-handoff.md` |

## Security and architecture checks

- Browser source contains no Prisma client, PostgreSQL client or `DATABASE_URL` use.
- Organiser routes use `ProtectedRoute`, while Express independently authenticates and requires the `ORGANISER` role.
- Candidate calculations remain in the backend allocation-query service. Member 2 maps stable reason codes to plain language without duplicating business rules.
- Auth0 Management API credentials and Neon credentials remain server-only environment values.
- No package dependency or lockfile change was required for Member 2.
- Repository AI declarations truthfully record the 23 August 2026 `Codex[GPT-5]` integration work.

## Verification evidence

The exact final command results and test counts are stored in:

```text
docs/integration-verification-2026-08-23.txt
```

The local checks do not claim that the lecturer-managed Gitea runner or Codecov service executed. After updating the local Gitea clone, push the reviewed main commit and inspect the external checks separately.

## Main-branch workflow

This archive is intended for the Integration Lead to copy into the existing local Gitea clone and commit on `main`. Normal member work still begins by pulling current `main`, working on a member branch, pushing that branch and notifying the Integration Lead.

Use the truthful AI trailer for this integration commit:

```text
Assisted-by: Codex[GPT-5]
```

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

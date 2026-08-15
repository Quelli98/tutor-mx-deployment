# Sprint 1 Member 1 and Member 6 compliance matrix

This matrix is limited to the Sprint 1 issue assignments on handbook pages 11-13 and 26-28 and the corresponding project-wide requirements.

| Issue | Final status in this archive | Evidence |
| --- | --- | --- |
| S1-M1-1 Auth0 entry | Complete in code | Official Auth0 React SDK/Universal Login, sign-up/sign-in/sign-out, loading/error and duplicate-submit protection, component tests |
| S1-M1-2 lifecycle and roles | Complete in code | Non-enumerating reset request, Auth0-hosted new-password path, two-step deletion confirmation, three-role map and route-guard/cancel/confirm tests; backend deletion remains the documented Sprint 1 stub explicitly permitted by the issue |
| S1-M1-3 auth contract | Complete in code | Shared bearer-token helper plus backend/frontend tests for missing, invalid/expired, wrong-role and permitted tokens; Express remains the final permission boundary |
| S1-M6-1 Neon/Prisma | Complete in code | Ordered migrations, constraints, safe three-role seed, reset/setup, migration/constraint tests and secret checks |
| S1-M6-2 GitHub/Gitea CI and Codecov | Code complete; repository-admin setup required | `.github/workflows/ci.yml`, `.gitea/workflows/ci.yml`, separate coverage flags, PostgreSQL smoke, `codecov.yml` and exact protected-main checks in `docs/github-required-checks.md` |
| S1-M6-3 external API spike | Complete in code; coordinator records decision | South African public-holiday service, backend-only spike command, strict decoder, timeout/fallback contract and mocked success/timeout/invalid tests |

## Authentication and security conclusion

Member 1's assigned authentication/security requirements are implemented. Tutor Mx does not store passwords or implement credential authentication: Auth0 Universal Login owns credentials and sessions. Browser tokens are kept in memory and sent through one `Authorization: Bearer` helper. Browser code contains no Neon connection or Auth0 Management token. Protected API tests confirm safe `401`/`403` behavior and deny missing, invalid, expired, unsupported-role and role-mismatched access.

The deletion endpoint returning `202` is not a missing Member 1 Sprint 1 task because S1-M1-2 explicitly allows the backend deletion action to remain a documented stub during Sprint 1. Production deletion and broader backend hardening belong to later/backend-owned work.

## Project-wide items outside this two-member scope

- Shared responsiveness/accessibility is Member 4 work.
- Handwritten course/tutor endpoints, backend middleware hardening and allocation rules are Member 5 work.
- The public documentation website and project-management records are Project Coordinator work.
- Gitea/GitHub main-branch protection, Codecov installation, repository secrets, PR approvals and deployment hosting require access to the actual repository/provider accounts and cannot be applied by importing a ZIP.

## AI declaration status
The supplied evidence confirms Qoder application version 1.23.0, VS Code version 1.106.3, Quest Agent mode and the Auto tier. Qoder automatically routed each request to an underlying model that was not disclosed, so no specific provider model has been guessed. The truthful declaration is `Qoder[Auto tier; underlying model automatically routed]`.


The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

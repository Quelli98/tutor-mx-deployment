# Sprint 1 public demo and repository handoff

## Current shared demo

Public frontend URL: **https://tutor-mx.pages.dev**

This URL gives the team one shared Sprint 1 demonstration environment. Access to protected role areas still depends on an authorised Auth0 account and a matching Tutor Mx database role.

## What was integrated on 16 August 2026

The Gitea-ready source was produced by comparing the existing `tutor-mx-system` main snapshot with the newer GitHub deployment snapshot. The deployment snapshot contained every source file present in the supplied Gitea snapshot and added or updated:

- `render.yaml` for the separate Express API deployment;
- `frontend/public/_redirects` for SPA routing on static hosting;
- deployment documentation under `docs-site/`;
- server-side Auth0 Management API account deletion;
- Helmet security headers and Express API rate limiting;
- database verification transaction handling;
- GitHub deployment-mirror CI changes; and
- package/lock-file updates for the new backend security dependencies.

The existing Gitea workflow remains under `.gitea/workflows/ci.yml`.

## Repository rule

**Gitea `main` is the team source of truth.** GitHub is a deployment mirror for the hosted demo.

After this integrated snapshot is committed to Gitea `main`, Member 2 must pull the latest Gitea `main` before continuing their branch. Member 4 is now included in the shared Sprint 1 source.

1. Pull latest Gitea `main`.
2. Work on your own branch.
3. Run the relevant tests/checks.
4. Push your branch to Gitea.
5. Tell the Integration Lead when it is ready.
6. The Integration Lead reviews and merges approved work into `main`.
7. Refresh the deployment mirror from approved Gitea `main`.

## Current Sprint 1 integration status

- Member 1: integrated authentication and role-security foundation.
- Member 3: integrated Tutor dashboard/forms and related tests.
- Member 5: integrated handwritten Express API, validation, security and API tests.
- Member 6: integrated Prisma/Neon database foundation, verification, CI and integration work.
- Member 2: pending integration.
- Member 4: integrated Student overflow, shared navigation/status components and volunteer confirmation/duplicate-submit handling.

The public demo remains the shared Sprint 1 foundation rather than the final application because Member 2 is still pending and Member 4's Sprint 1 Student work intentionally uses the agreed mock boundary until its later backend endpoint is connected.

## Public-demo architecture

```text
Browser
  -> Cloudflare Pages (React + Vite frontend)
  -> Auth0 Universal Login / Google identity
  -> Bearer access token
  -> Render (handwritten Express API)
  -> Prisma
  -> Neon PostgreSQL
```

The browser never connects directly to Neon and never receives server-only Auth0 Management API credentials.

## AI declaration

This integration comparison, documentation update and verification pass was assisted by ChatGPT[GPT-5.6 Sol]. The team remains responsible for reviewing the changes, reproducing the tests and using the course-required AI attribution.

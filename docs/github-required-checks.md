# Gitea/GitHub main integration settings for Sprint 1

The repository code supplies both Gitea and GitHub workflow copies, but a repository administrator must apply the settings below because branch protection, repository secrets and Codecov installation are not stored in a ZIP.

## Required pull-request checks

Protect `main`, require a pull request, one approval, resolved conversations, and these exact workflow job names:

- `Backend quality and coverage`
- `Frontend quality and coverage`
- `Clean PostgreSQL migration and API smoke`
- the Codecov project/patch checks shown after the Codecov GitHub App is installed

Block force pushes and branch deletion. Do not allow administrators or the Integration Lead to bypass failed checks.

## Repository configuration

1. Install the Codecov integration supported by the repository host.
2. Add `CODECOV_TOKEN` to the repository's Actions secrets.
3. Add the protected-branch rules above for `main`.
4. Add `DEPLOYMENT_URL` only after the HTTPS API has been deployed, then run **Deployment smoke** manually.
5. Before starting or resuming, run `git checkout main` and `git pull origin main`.
6. Open each exact Member issue branch as a pull request into `main`. The repository owner/Integration Lead merges approved work into `main` after the required checks pass; no `develop` branch is used.

The workflows read secrets through GitHub's secret context and contain no secret values. The tracked-file security check also rejects committed environment files, common key formats, hard-coded Codecov/Auth0 tokens and PostgreSQL URLs containing passwords.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

Historical document: its original AI use/non-use and model evidence have not been verified in the final audit. Confirm a document-specific declaration before submitting it for marking; see the root AI_DECLARATION.md.

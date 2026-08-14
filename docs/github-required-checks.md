# GitHub integration settings for Sprint 1

The repository code supplies the workflows, but a GitHub repository administrator must apply the settings below because branch protection, repository secrets and GitHub App installation are not stored in a ZIP.

## Required pull-request checks

Protect both `develop` and `main`, require a pull request, one approval, resolved conversations, and these exact workflow job names:

- `Backend quality and coverage`
- `Frontend quality and coverage`
- `Clean PostgreSQL migration and API smoke`
- the Codecov project/patch checks shown after the Codecov GitHub App is installed

Block force pushes and branch deletion. Do not allow administrators or the Integration Lead to bypass failed checks.

## Repository configuration

1. Install the Codecov GitHub App for this repository.
2. Add `CODECOV_TOKEN` under **Settings > Secrets and variables > Actions**.
3. Add the protected-branch rules above for `develop` and `main`.
4. Add `DEPLOYMENT_URL` only after the HTTPS API has been deployed, then run **Deployment smoke** manually.
5. Open each Member issue branch as a pull request into `develop`; only the Integration Lead opens `develop` into `main`.

The workflows read secrets through GitHub's secret context and contain no secret values. The tracked-file security check also rejects committed environment files, common key formats, hard-coded Codecov/Auth0 tokens and PostgreSQL URLs containing passwords.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

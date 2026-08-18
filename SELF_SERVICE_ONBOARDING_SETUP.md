# Tutor Mx Self-Service Role Onboarding Setup

This version removes the need to manually add each new user to Neon or manually assign each Tutor Mx role in Auth0.

## What happens now

1. A visitor opens the Tutor Mx front page.
2. They choose **Student**, **Tutor** or **Organiser**.
3. They click **Create ... account** and Auth0 Universal Login handles Google/email-password sign-up.
4. After Auth0 has authenticated the user, React calls `POST /api/auth/onboarding` with the selected role and the normal bearer token.
5. Express verifies the Auth0 token. Server-only code then reads the Auth0 user, checks email verification, finds the existing `ORGANISER`, `TUTOR` and `STUDENT` roles, assigns exactly the selected Tutor Mx role, and creates the matching Neon `Profile` using Prisma.
6. The browser never receives the Neon connection string or Auth0 Management API client secret.
7. The selected role is one-time. If the Neon profile already exists with another role, public onboarding returns `ROLE_ALREADY_SET` rather than changing it.

## One-time Auth0 setup

### A. Keep/create these three Auth0 roles

Auth0 Dashboard -> User Management -> Roles. Ensure these exact names exist:

- `ORGANISER`
- `TUTOR`
- `STUDENT`

You do **not** need to copy their IDs into the project. The backend resolves the IDs by exact role name.

### B. Configure the server-only Machine-to-Machine application

Auth0 Dashboard -> Applications -> APIs -> **Auth0 Management API** -> Machine to Machine Applications.

Authorize the M2M application whose Client ID/Secret you already use on the backend and grant:

- `read:users` - read the authenticated user's email/name
- `read:roles` - resolve the three Tutor Mx role IDs by name
- `update:users` - assign/remove Tutor Mx roles
- `delete:users` - keep this only if you want the existing account-deletion feature

Never put this M2M Client Secret in Cloudflare Pages or any `VITE_...` variable.

### C. Keep your Auth0 Post Login role-claim Action

Keep the existing Action that places `event.authorization.roles` into the custom access-token claim configured by `AUTH0_ROLES_CLAIM`. Newly onboarded users can continue immediately because Express resolves the just-created Neon profile if the first token predates role assignment; later tokens should contain the Auth0 role claim too.

## Backend hosting environment values

On the host running the Express API, set/confirm:

```text
AUTH0_DOMAIN=<your Auth0 tenant domain>
AUTH0_AUDIENCE=<your Tutor Mx API audience>
AUTH0_MANAGEMENT_CLIENT_ID=<M2M client id>
AUTH0_MANAGEMENT_CLIENT_SECRET=<M2M client secret>
DATABASE_URL=<Neon connection string>
FRONTEND_ORIGIN=https://tutor-mx.pages.dev
ALLOW_SELF_SERVICE_ORGANISER=true
```

`ALLOW_SELF_SERVICE_ORGANISER=true` is required if you really want any new user to be able to choose Organiser. For a safer production-style configuration, set it to `false` and create/invite organisers separately.

## Cloudflare Pages frontend values

Keep the existing public frontend variables only:

```text
VITE_AUTH0_DOMAIN=<your Auth0 tenant domain>
VITE_AUTH0_CLIENT_ID=<your SPA client id>
VITE_AUTH0_AUDIENCE=<your Tutor Mx API audience>
VITE_API_BASE_URL=<your hosted Express API base URL>
```

Do not add `DATABASE_URL` or `AUTH0_MANAGEMENT_CLIENT_SECRET` to Cloudflare Pages.

## Deployment steps

1. Push this source to Gitea `main` after local checks pass.
2. Redeploy the Express backend so it gets the new onboarding endpoint and environment values.
3. Redeploy Cloudflare Pages from the updated `frontend` build.
4. Open `https://tutor-mx.pages.dev` in a private/incognito browser window.
5. Choose Student first, create a brand-new account, verify the email if Auth0 asks, and return to Tutor Mx.
6. Confirm Auth0 -> User Management -> Users -> the new user has only `STUDENT` among the Tutor Mx roles.
7. Confirm Neon -> `Profile` contains the same Auth0 subject/email and role `STUDENT` automatically.
8. Repeat with a new Tutor account. A brand-new Tutor with no organiser-assigned weekly-hour limit must still reach `/tutor`; the dashboard shows **Weekly hour limit not set yet** and **You have no work assigned right now** instead of failing.
9. Repeat with a new Organiser account only if `ALLOW_SELF_SERVICE_ORGANISER=true`.

## Expected behaviour for existing unlinked Auth0 users

If an older Auth0 account signs in but has no Neon `Profile`, Tutor Mx now shows **Finish setting up your account** and lets that authenticated user choose a role. It then uses the same server-side onboarding flow.

## Local release checks

From the repository root:

```powershell
npm ci
npm ci --prefix frontend
npm run generate
npm run lint
npm run typecheck
npm test
npm run coverage
npm run build
npm run security:check
git diff --check
```

Do not commit or deploy if one of these fails.

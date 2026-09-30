# Tutor Mx Onboarding and Master Organiser Setup

Tutor Mx keeps Auth0 as the authentication/authorization source of truth and stores the organiser-approval audit trail in Neon.

## Role model

Create/keep these Auth0 roles:

- `STUDENT`
- `TUTOR`
- `ORGANISER`
- `MASTER_ORGANIZER`

`MASTER_ORGANIZER` is an extra privilege layered on top of the normal `ORGANISER` workspace role. A Master Organiser should also have `ORGANISER`. Never expose `MASTER_ORGANIZER` as a registration option.

## Important organiser rule

Organisers are lecturers. They are **not Students promoted into Organisers**.

Student registration remains Student-only. Tutor registration remains Tutor-only. There is no **Become an organiser** option inside the Student workspace.

## Lecturer organiser registration flow

1. On the public landing page, the lecturer chooses the **Organiser** role and clicks **Register as organiser**.
2. Auth0 creates/authenticates the lecturer identity and verifies the lecturer email.
3. Tutor MX creates a pending `OrganiserApplication` containing the Auth0 user id, email and name.
4. Tutor MX does **not** create a Student profile and does **not** assign the Auth0 `ORGANISER` role yet.
5. The lecturer returns to the landing page. Under the Organiser role they can enter their email and choose **Check status** at any time.
6. The Master Organiser opens **Organiser applications** and approves or rejects the lecturer registration.
7. On approval, the backend assigns `ORGANISER` through the server-only Auth0 Management API and creates the Neon `Profile` as `ORGANISER`.
8. The lecturer can then sign in using the Organiser role and enter the organiser workspace.
9. If the registration is pending or rejected, the lecturer cannot enter the Student, Tutor or Organiser workspaces from that organiser registration.

## One-time Auth0 setup

### A. Assign the Master Organiser

Auth0 Dashboard -> User Management -> Users -> open the designated main lecturer account -> Roles -> Assign Roles.

Assign:

- `ORGANISER`
- `MASTER_ORGANIZER`

Only trusted project owners/administrators should assign or remove `MASTER_ORGANIZER` in Auth0.

### B. Management API machine-to-machine application

The Express backend uses the server-only Auth0 Management API client. Grant only the scopes Tutor MX needs:

- `read:users`
- `read:roles`
- `update:users`
- `delete:users` only if the existing account-deletion feature remains enabled

Never place the Management API Client Secret in the frontend or a `VITE_...` variable.

### C. Post Login role claim

Keep the Auth0 Post Login Action that writes `event.authorization.roles` to the custom claim configured by `AUTH0_ROLES_CLAIM`. The claim must include `MASTER_ORGANIZER` for the designated main lecturer account so the backend can authorize approval endpoints.

## Backend environment values

```text
AUTH0_DOMAIN=<your Auth0 tenant domain>
AUTH0_AUDIENCE=<your Tutor Mx API audience>
AUTH0_MANAGEMENT_CLIENT_ID=<M2M client id>
AUTH0_MANAGEMENT_CLIENT_SECRET=<M2M client secret>
DATABASE_URL=<Neon connection string>
FRONTEND_ORIGIN=https://tutor-mx.pages.dev
```

## Cloudflare Pages values

```text
VITE_AUTH0_DOMAIN=<your Auth0 tenant domain>
VITE_AUTH0_CLIENT_ID=<your SPA client id>
VITE_AUTH0_AUDIENCE=<your Tutor Mx API audience>
VITE_API_BASE_URL=<your hosted Express API base URL>
```

Do not add `DATABASE_URL` or `AUTH0_MANAGEMENT_CLIENT_SECRET` to Cloudflare Pages.

## Deployment and verification

1. Run Prisma migrations through `20261006010000_lecturer_organiser_registration` against Neon.
2. Deploy the backend and frontend.
3. Sign out of the Master Organiser account and sign in again so its access token contains both `ORGANISER` and `MASTER_ORGANIZER`.
4. Confirm the Organiser sidebar shows **Organiser applications** only for the Master Organiser.
5. Register a new lecturer using **Register as organiser**.
6. Confirm Neon contains a `PENDING` `OrganiserApplication` with the lecturer Auth0 id/email/name and that no new Student `Profile` was created.
7. On the public landing page, use the lecturer email in **Check organiser approval status** and confirm it shows Pending.
8. Approve the lecturer from the Master Organiser page.
9. Confirm Auth0 now gives the lecturer `ORGANISER`, Neon has `Profile.role = ORGANISER`, and the application is `APPROVED` with reviewer/time recorded.
10. Check status again and confirm it shows Approved, then sign in as Organiser and verify the Organiser workspace opens.
11. Repeat with Reject and confirm the status checker reports that the registration was not approved and no Student/Organiser profile is created for that applicant.

## Local release checks

```powershell
npm ci
npm ci --prefix frontend
npm run generate
npm run lint
npm run typecheck
npm test
npm run build
npm run security:check
git diff --check
```

# Sprint 2 endpoint-to-role/ownership matrix (S2-M1-2)

Branch: `s2/m1/role-protection` (reviewer: Member 3). Integration audit updated 13 September 2026 after Members 4, 5 and 6 were integrated.

This matrix covers the **current real Sprint 2 Basic API**, including Student overflow/volunteering, allocation writes, organiser approvals, Tutor status routes and the public-holiday adapter. Protected application routes use the backend middleware in `src/auth/middleware.ts`; React visibility is never treated as the security boundary.

1. `authenticate` -> `401 AUTHENTICATION_REQUIRED` without a bearer token and `401 INVALID_ACCESS_TOKEN` for invalid/expired tokens.
2. `resolveProfileRole` -> `404 PROFILE_NOT_FOUND` for a token with no linked Tutor Mx profile and `403 ROLE_MISMATCH` when token/database roles disagree.
3. `requireRole(...)` -> `403 FORBIDDEN` for a valid linked user with the wrong Tutor Mx role.
4. Own-data services receive the verified `auth.subject`; browser-supplied `tutorId`/`studentId` values are not accepted as ownership proof.

The integrated cross-role sweep in `src/security-smoke.test.ts` covers **all 36 authenticated routes below** for missing/expired tokens and every meaningful wrong-role combination. Existing route suites provide the deeper validation/state/conflict evidence referenced below.

## Public and authentication/account routes

| Endpoint | Access | Ownership / notes | Main evidence |
| --- | --- | --- | --- |
| `GET /health` | Public | Liveness only | `src/server.test.ts`, security smoke public-surface test |
| `GET /ready` | Public | Readiness only | `src/server.test.ts`, security smoke public-surface test |
| `POST /api/auth/password-reset` | Public, rate-limited | Non-enumerating `202`; Auth0 owns password workflow | `src/auth/auth-routes.test.ts` |
| `POST /api/auth/onboarding` | Authenticated token | Uses caller `auth.subject`; first-time linking only | `src/auth/auth-routes.test.ts`, `src/security-smoke.test.ts` |
| `POST /api/auth/resend-verification` | Authenticated token | Sends verification job for caller subject only; safe `202/503` | `src/auth/auth-routes.test.ts`, security smoke token sweep |
| `GET /api/me` | Any linked Tutor Mx role | Own profile from `auth.subject` | `src/auth/auth-routes.test.ts`, security smoke persona/token tests |
| `GET /api/profile/current` | Any linked Tutor Mx role | Own profile from `auth.subject` | `src/auth/auth-routes.test.ts`, security smoke token sweep |
| `DELETE /api/auth/delete-account` | Any linked Tutor Mx role | Deletes caller `auth.subject` only | `src/auth/auth-routes.test.ts`, security smoke token sweep |

## Shared linked-user reads

| Endpoint | Role required | Ownership / notes | Main evidence |
| --- | --- | --- | --- |
| `GET /api/courses` | Student / Tutor / Organiser | Read-only shared course list | `src/auth/auth-routes.test.ts`, security smoke |
| `GET /api/public-holidays?year=YYYY` | Student / Tutor / Organiser | Backend-only external adapter; no identity/secrets sent to provider | `src/auth/auth-routes.test.ts`, public-holiday tests, security smoke |

## Organiser-only routes

All rows require `ORGANISER`. Tutor/Student callers must receive `403 FORBIDDEN` before the handler mutates or exposes organiser data.

| Endpoint | Ownership / notes | Main evidence |
| --- | --- | --- |
| `POST /api/courses` | Organiser-scoped write | `src/auth/auth-routes.test.ts`, security smoke |
| `PATCH /api/courses/:courseId` | Organiser-scoped write | `src/auth/auth-routes.test.ts`, security smoke |
| `DELETE /api/courses/:courseId` | Organiser-scoped write | `src/auth/auth-routes.test.ts`, security smoke |
| `GET /api/tutors` | Lists self-onboarded Tutor profiles | `src/auth/auth-routes.test.ts`, security smoke |
| `POST /api/tutors` | Legacy integration route; not normal self-service UI | `src/auth/auth-routes.test.ts`, security smoke |
| `PATCH /api/tutors/:tutorId` | Edits internal Tutor record | `src/auth/auth-routes.test.ts`, security smoke |
| `GET /api/allocations/candidates` | Rule-checked candidate data | `src/auth/auth-routes.test.ts`, security smoke |
| `POST /api/allocations` | Rechecks mark/clash/hour rules server-side | `src/organiser-routes.test.ts`, security smoke |
| `PATCH /api/allocations/:allocationId` | Rechecks rules and stale state | `src/organiser-routes.test.ts`, security smoke |
| `DELETE /api/allocations/:allocationId` | Safe remove/cancel path | `src/organiser-routes.test.ts`, security smoke |
| `PATCH /api/timesheets/:timesheetId/decision` | Organiser approve/return transition | `src/organiser-routes.test.ts`, security smoke |
| `PATCH /api/volunteer-claims/:claimId/decision` | Organiser approve/reject transition | `src/organiser-routes.test.ts`, security smoke |
| `PATCH /api/excuses/:excuseId/decision` | Organiser approve/reject excuse | `src/member5-workflow-routes.test.ts`, security smoke |
| `GET /api/tutors/:tutorId/marks` | Organiser manages selected Tutor record | `src/auth/auth-routes.test.ts`, security smoke |
| `PUT /api/tutors/:tutorId/marks` | Organiser manages selected Tutor record | `src/auth/auth-routes.test.ts`, security smoke |
| `GET /api/tutors/:tutorId/time-slots` | Organiser manages selected Tutor record | `src/auth/auth-routes.test.ts`, security smoke |
| `POST /api/tutors/:tutorId/time-slots` | Organiser manages selected Tutor record | `src/auth/auth-routes.test.ts`, security smoke |

## Tutor-only own-data routes

All rows require `TUTOR`. The route never accepts a Tutor identity as authority; the service receives the verified subject. A guessed allocation/timesheet/excuse belonging to another Tutor is hidden by subject/profile-scoped queries and safe `404/409` behavior.

| Endpoint | Ownership rule | Main evidence |
| --- | --- | --- |
| `GET /api/tutor/dashboard` | Dashboard by `auth.subject` | `src/tutor-routes.test.ts`, security smoke |
| `POST /api/tutor/time-slots` | Writes slot for token-derived Tutor; body `tutorId` ignored | `src/tutor-routes.test.ts`, security smoke spoof test |
| `POST /api/tutor/work-logs` | Allocation lookup scoped to token-derived Tutor | `src/server.test.ts`, `src/tutor-routes.test.ts`, security smoke |
| `POST /api/tutor/excuses` | Allocation lookup scoped to token-derived Tutor | `src/server.test.ts`, `src/tutor-routes.test.ts`, security smoke |
| `GET /api/tutor/timesheets/:timesheetId/status` | Service gets `(auth.subject, timesheetId)` | `src/member5-workflow-routes.test.ts`, security smoke own-subject test |
| `POST /api/tutor/timesheets/:timesheetId/submit` | Service gets `(auth.subject, timesheetId)` and enforces state | `src/member5-workflow-routes.test.ts`, security smoke |
| `GET /api/tutor/excuses/:excuseId/status` | Service gets `(auth.subject, excuseId)` | `src/member5-workflow-routes.test.ts`, security smoke own-subject test |

## Student-only own-data routes

All rows require `STUDENT`. The Student identity comes from `auth.subject`, never a request `studentId`. Closed/claimed work, duplicate/race conditions and another Student's request are handled in the Student workflow service with safe errors.

| Endpoint | Ownership rule | Main evidence |
| --- | --- | --- |
| `GET /api/student/open-work` | Eligible/open work for caller subject | `src/member5-workflow-routes.test.ts`, `src/services/student-workflows.test.ts`, security smoke |
| `GET /api/student/volunteer-requests` | Lists caller's persisted requests only | `src/member5-workflow-routes.test.ts`, Student workflow tests, security smoke |
| `POST /api/student/volunteer-requests` | Creates one request for caller subject | `src/member5-workflow-routes.test.ts`, Student workflow tests, security smoke |
| `GET /api/student/volunteer-requests/:requestId` | Service receives `(auth.subject, requestId)`; another Student gets safe `404` | `src/member5-workflow-routes.test.ts`, security smoke own-subject test |
| `PATCH /api/student/volunteer-requests/:requestId/withdraw` | Same subject-scoped ownership rule | `src/member5-workflow-routes.test.ts`, security smoke own-subject test |

## Frontend/backend consistency

- `ProtectedRoute`, `RoleRouter` and `ROLE_ROUTE_MAP` show only the workspace/navigation for the signed-in role, but the Express API independently enforces every role and ownership rule above.
- `fetchWithBearerToken` is the shared frontend request wrapper. Hiding a button or manually typing another role's URL cannot grant API access.
- The previous Sprint 1 Student mock boundary has been removed: Student overflow/volunteer now uses the real Sprint 2 API and is covered by this matrix.
- The public-holiday UI consumes only the safe backend response/fallback; the browser never calls the external provider directly.

## Release rule

Any new protected Sprint 2 endpoint must be added to this matrix and to `src/security-smoke.test.ts`. Missing/invalid tokens must fail `401`, wrong roles must fail `403`, and own-data routes must prove that the verified subject—not a browser identity field—controls access.

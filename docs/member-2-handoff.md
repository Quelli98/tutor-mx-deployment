# Sprint 1 Member 2 Handoff

> **Integration Lead note - 23 August 2026:** The supplied `s1/m2/course-tutor-ui` branch was reviewed against handbook pages 14-16 (within the requested physical-page range 1-29), corrected and integrated into live Gitea `main` commit `c5a1e19071a2aade57f651ec5e8ed0c6b14e8b01`. The branch's valid course/tutor work was preserved, while the missing S1-M2-1 and S1-M2-3 Organiser behavior and the missing marks/busy-times portion of S1-M2-2 were completed during integration.

## S1-M2-1 - Organiser allocation-board shell

### Integrated behavior

- The protected `/organiser` route opens one responsive allocation board.
- An Organiser selects the course, session start/end, minimum mark and required hours without leaving the page.
- The browser sends the agreed authenticated request to `GET /api/allocations/candidates`; it does not calculate allocation eligibility or connect directly to Prisma/Neon.
- Loading, empty, safe error/retry and candidate-result states are visible while the board remains usable.
- Native labels, logical source order, visible focus styling and a keyboard-focus component test cover the Sprint 1 accessibility requirement.
- Candidate cards keep the primary selection and save actions reachable at phone widths.
- The **Save allocation** control is the Sprint 1 placeholder required by the handbook. It is disabled until an eligible tutor is selected and does not invent an unapproved write endpoint.

## S1-M2-2 - Course and tutor management UI

### Courses

- `/organiser/courses` lists, adds and edits courses through the handwritten Express API.
- Course removal requires the shared confirmation dialog.
- Cancel closes the dialog without sending a delete request.
- Successful add/edit/delete flows refresh the list so a stale row is not left behind.
- Required/length validation is field-level; safe success and error messages are shown.

### Tutors, marks, busy times and weekly-hour limits

- `/organiser/tutors` lists tutor profiles created automatically by the self-service Tutor sign-up flow; the Organiser never enters or copies an Auth0 subject.
- Organisers can search registered tutors by name or email, then edit the selected tutor using the internal database tutor ID already returned by the API.
- Tutor email, full name and weekly-hour limit have field-level validation matching the backend limits.
- Each tutor exposes **Manage marks and busy times**.
- Organisers can upsert a course mark from 0-100 and immediately see the updated non-stale row.
- Organisers can record once-off or weekly busy time after start/end validation.
- Marks and time slots travel through Organiser-only Express routes and Prisma persistence on the server.

## S1-M2-3 - Immediate allocation-rule messages and UI tests

- One reusable `RuleResult` component renders Pass, Fail and Not checked states.
- Every candidate displays mark eligibility, timetable clash and weekly hours together; failed rules are not hidden.
- Backend reason codes are mapped to plain language. The React code does not duplicate the allocation SQL/business-rule engine.
- Remaining and required hours are visible before save.
- A mark equal to the minimum threshold is tested as passing.
- Status is written as text and symbol as well as colour, satisfying the non-colour-only requirement.
- Only candidates whose backend `isEligible` value is true can be selected; the save placeholder becomes available only after selection.

## Backend contract integrated with the existing Member 5/6 work

The supplied branch's compatible Express/Prisma wiring was retained:

```text
GET /api/allocations/candidates
GET /api/tutors/:tutorId/marks
PUT /api/tutors/:tutorId/marks
GET /api/tutors/:tutorId/time-slots
POST /api/tutors/:tutorId/time-slots
```

Every route authenticates the bearer token, resolves the linked profile role and requires `ORGANISER`. Candidate results delegate to Member 6's existing allocation-query service. Tutor marks and time slots use Prisma only in `src/server.ts`.

## Main-branch integration safeguards

- The current main baseline's Auth0 self-service onboarding, role routing, Tutor/Student sign-out behavior, Student overflow work and shared accessibility components were preserved.
- No Member 2 file introduced a frontend Prisma/`pg` import, `DATABASE_URL`, Auth0 Management token or other secret.
- Existing package and lock files were retained because Member 2 introduced no dependency.
- Routes remain protected by both React role guards and backend Organiser authorization; hidden navigation is not treated as the security boundary.

## Member 2 files introduced or updated

```text
frontend/src/api/organiser.js
frontend/src/api/organiser.test.js
frontend/src/components/organiser/RuleResult.jsx
frontend/src/components/organiser/RuleResult.test.jsx
frontend/src/features/OrganiserDashboard.jsx
frontend/src/features/OrganiserDashboard.test.jsx
frontend/src/features/CourseManagement.jsx
frontend/src/features/CourseManagement.test.jsx
frontend/src/features/TutorManagement.jsx
frontend/src/features/TutorManagement.test.jsx
frontend/src/features/TutorAllocationDetails.jsx
frontend/src/features/TutorAllocationDetails.test.jsx
frontend/src/routes/RoleRouter.jsx
frontend/src/routes/RoleRouter.test.jsx
frontend/src/App.css
src/app.ts
src/auth/auth-routes.test.ts
src/server.ts
src/server.test.ts
src/tutor-routes.test.ts
```

## Verification

Final reproducible results are recorded in `docs/integration-verification-2026-08-23.txt`. The local suite covers valid, invalid, empty, loading, error/retry, cancel, duplicate/pending, role-denied, threshold-boundary and responsive/accessibility paths relevant to Sprint 1.

Before pushing this source to Gitea `main`, the Integration Lead should preserve the normal reviewed-main workflow and use the actual assistance trailer:

```text
Assisted-by: Codex[GPT-5]
```

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

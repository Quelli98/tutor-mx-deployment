# Sprint 1 Member 5 handoff

## Integrated scope

### S1-M5-1 - Separate handwritten backend and health endpoint

- The Express API remains a separate runnable backend entry point in [src/server.ts](../src/server.ts).
- `GET /health` returns the documented `200 { status: "ok" }` response.
- `GET /ready` still checks the database readiness function and returns either `200` with `database: "connected"` or `503` with `database: "disconnected"`.
- The backend still starts independently from the frontend and keeps the Prisma connection server-side.
- Production request logging records only method, path, status and duration. It deliberately omits query strings, headers, bodies and bearer tokens.
- Malformed JSON and unexpected failures use the shared safe error envelope without leaking implementation details.

### S1-M5-2 - Auth middleware plus profile, course and tutor endpoints

Implemented API contract:

- `GET /api/me` returns the current authenticated profile.
- `GET /api/profile/current` is an alias for the current-profile read contract.
- `GET /api/courses` returns protected course data for authenticated users.
- `POST /api/courses` creates a course for an organiser.
- `PATCH /api/courses/:courseId` updates a course for an organiser.
- `DELETE /api/courses/:courseId` removes a course for an organiser.
- `GET /api/tutors` returns protected tutor data for an organiser.
- `POST /api/tutors` creates a tutor profile for an organiser.
- `PATCH /api/tutors/:tutorId` updates a tutor profile for an organiser.
- `GET /api/tutor/dashboard` returns only the logged-in tutor's assignments and weekly-hour summary.
- `POST /api/tutor/time-slots` creates the logged-in tutor's validated availability/busy slot.
- `POST /api/tutor/work-logs` creates/reuses a draft timesheet and adds an owned confirmed-session log in one transaction.
- `POST /api/tutor/excuses` submits a `PENDING` excuse for the logged-in tutor's future confirmed session.

Access rules:

- All protected routes require `Authorization: Bearer <access-token>`.
- `GET /api/me` and `GET /api/profile/current` accept any supported Tutor Mx role, but the token role must still match the linked database profile role.
- Course and tutor write endpoints require `ORGANISER`.
- The shared JSON error shape is `{ error: { code, message } }`.
- Validation failures return `400 VALIDATION_ERROR`.
- Missing or invalid tokens return `401`.
- Wrong-role access returns `403`.
- Missing records return `404`.
- Database conflicts from the server-side Prisma layer are mapped to safe `409` responses.
- Browser CORS preflight explicitly permits the implemented `PATCH` routes.
- Tutor create/update validates email and weekly hours, and tutor updates cannot mutate Organiser or Student profiles.
- Tutor workflow routes require `TUTOR`, derive ownership from the verified token subject and ignore any browser-supplied `tutorId` field.
- Cross-tutor allocation lookups use a non-revealing `404`; duplicate/state/constraint failures use stable safe `409` codes.

### S1-M5-3 - Three allocation-rule functions and boundary tests

Implemented allocation-rule helpers in [src/services/allocation-queries.ts](../src/services/allocation-queries.ts):

- `meetsMinimumMark(mark, minimumMark)` keeps the organiser threshold inclusive.
- `timeRangesOverlap(startsAt, endsAt, otherStartsAt, otherEndsAt)` treats touching ranges as non-overlapping and only flags true clashes.
- `hasEnoughRemainingHours(remainingHours, requestedHours)` keeps the exact limit inclusive and rejects requests that exceed it.
- Missing or malformed inputs return `null` (controlled unknown) rather than silently approving.

The candidate query still returns stable `reasonCodes` from the server-side data layer, and the new unit tests cover the exact threshold, touching-range and exact/exceeded hour boundaries.

## Test and evidence commands

```bash
npm run test:backend -- src/app.test.ts src/auth/auth-routes.test.ts src/server.test.ts src/services/allocation-queries.test.ts
npm run build:backend
```

The earlier Members 1, 3, 5 and 6 integrated verification is recorded in `docs/sprint1-members-1-3-5-6-integration.md`. The current mapping including Member 4 is in `docs/sprint1-members-1-3-4-5-6-integration.md`.

## Status-code table

| Result | HTTP status | JSON contract |
| --- | --- | --- |
| Successful read/update | `200` | `{ data: { ... } }` |
| Successful create | `201` | `{ data: { ... } }` |
| Successful delete | `204` | Empty response body |
| Invalid input or malformed JSON | `400` | `{ error: { code, message } }` |
| Missing/invalid bearer token | `401` | `{ error: { code, message } }` |
| Valid token with wrong role | `403` | `{ error: { code, message } }` |
| Missing record | `404` | `{ error: { code, message } }` |
| Unique/relationship conflict | `409` | `{ error: { code, message } }` |
| Unexpected dependency failure | `500` | Safe `{ error: { code, message } }` without private details |

## Handoff notes for the next member

- Member 2 can consume the new course/tutor response shapes from the backend without touching Prisma directly.
- Member 3's dashboard/forms now consume the own-tutor routes above through the shared bearer helper; the former simulated API modules have been removed.
- Member 6 still owns the schema, seed data and database invariants; the backend routes only wrap those contracts.
- Route names are now documented here, but if the team wants a different public route surface later, update the frontend mocks and this handoff together.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].

Historical document: its original AI use/non-use and model evidence have not been verified in the final audit. Confirm a document-specific declaration before submitting it for marking; see the root AI_DECLARATION.md.

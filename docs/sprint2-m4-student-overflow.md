# Sprint 2 Member 4 - Student overflow and shared quality

## Integration baseline

This completion was reconciled on 13 September 2026 against Gitea `main` at `2307a7a`, after the approved Member 5 and Member 6 integrations. Newer Member 5/6 API, Prisma, migration, public-holiday cache and CI files are preserved.

The supplied `s2/m4/shared-quality` snapshot used older Student and holiday route names. Copying it directly over `main` would have bypassed the integrated Sprint 2 contracts. The reconciled implementation therefore uses the current routes below.

## S2-M4-1 - Real Student open work

- `GET /api/student/open-work` replaces the Sprint 1 mock.
- The backend derives the Student from the verified token and returns only eligible open work not already requested by that Student.
- The UI keeps loading, empty, safe error/retry, open-card and defensive unavailable states.
- API, component and integration tests cover open, defensive closed/filled, empty, invalid-response and failed-load/retry cases.

## S2-M4-2 - Volunteer requests and outcomes

- `POST /api/student/volunteer-requests` sends only `{ overflowWorkId }`; it never sends a Student ID.
- `GET /api/student/volunteer-requests` returns only the authenticated Student's persisted requests, enriched with safe work/course display fields.
- Pending, accepted (shown as Approved), rejected and withdrawn statuses are displayed.
- Duplicate, unavailable/race, conflict and unexpected failures use controlled messages without exposing database details.
- A successful request is removed from the open list and the persisted request list is refreshed.
- The backend query, route and tests enforce token-derived ownership.

## S2-M4-3 - Holiday result, accessibility and responsive regression

- `GET /api/public-holidays?year=YYYY` is called through the authenticated Tutor Mx backend; the browser never contacts the external provider.
- External data is labelled as supporting information and shows its retrieval time.
- The safe fallback or a failed holiday request does not block open-work or volunteer actions.
- Primary actions remain native keyboard controls, the confirmation flow supports keyboard operation and the agreed 360 px Student layout has a regression test.
- The authenticated API callback is stable across renders so the production page does not enter a repeated-fetch loop.

## Fresh local automated evidence

Run from the repository root on 13 September 2026:

```text
npm run check
Backend: 20 files, 395 tests passed
Frontend: 30 files, 174 tests passed
Prisma generation, backend/frontend lint, TypeScript, production builds and security check passed

npm run coverage
Backend: 93.55% statements, 89.72% branches, 95.84% functions, 95.03% lines
Frontend: 86.97% statements, 83.72% branches, 91.95% functions, 89.10% lines
```

The Vite production build emitted its existing informational chunk-size warning; the build completed successfully. A real PostgreSQL migration/API smoke remains the Gitea `postgres-integration` job because this local environment did not provide PostgreSQL. Do not claim Gitea Actions or Codecov green until the pushed pull request finishes on a shared runner.

## Manual handoff still required

Before merging the pull request, use separate Student, Tutor and Organiser test accounts. For the Student flow, verify open, empty/error-retry, request confirmation, persisted outcome and wrong-role rejection. Test at a common phone width and using keyboard-only controls. Save the completed Gitea Actions and Codecov links as evidence.

Historical document: its original AI use/non-use and model evidence have not been verified in the final audit. Confirm a document-specific declaration before submitting it for marking; see the root AI_DECLARATION.md.

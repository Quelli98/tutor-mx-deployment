# Sprint 3 Member 5: follow-up bug audit

This audit reviews the delivered source for failures similar to the organiser approvals issue. It covers frontend API paths, authenticated requests, save/refresh boundaries, timesheet history recovery, and regression checks of the integrated backend and frontend. It is a source and local-test audit, not a production deployment test.

## Findings and fixes

| Finding | Effect | Fix |
| --- | --- | --- |
| Payroll download used a relative frontend URL and fetched its token outside the shared API client. | Split frontend/API deployments could return a frontend HTML page or fail authentication instead of exporting payroll. | Route downloads through the shared authenticated transport, using `VITE_API_BASE_URL`, the configured Auth0 audience, missing-token checks, no-store requests and the API error contract. Normalize trailing slashes on the base URL. |
| The download accepted every successful HTTP body, and cross-origin JavaScript could not read the filename header. | An HTML fallback could be saved as CSV; the server filename was lost across origins. | Require a CSV content type and expose `Content-Disposition` to the configured frontend origin. |
| Failed timesheet history loads remained marked as attempted; the manual check refreshed only status. | A returned week could remain without correction/declaration controls until a full page reload. | Show an explicit timeline error and retry history on the existing Check for decision action. Hide stale correction controls after a failed refresh. Refresh displayed total hours from successful history for the matching status. |
| Timetable import called its refresh callback inside the save error boundary without awaiting asynchronous callbacks. | A synchronous refresh error could falsely report a failed save; an asynchronous rejection could go unhandled. | Await the refresh inside a separate error boundary, retain confirmed import success, clear the submitted form, and give refresh-specific guidance. An unconfirmed save no longer promises that nothing changed. |

## Scope checks

- Every literal frontend API path matched a registered Express route after replacing dynamic IDs with placeholders.
- Reviewed the approvals, staffing, bulk allocation, organiser overflow, student claims/withdrawals, reporting, timetable import and timesheet correction submission paths. Existing list loaders generally catch refresh errors separately; the timetable callback was the additional confirmed save/refresh boundary defect.
- Retained the prior permission, ownership, transaction, idempotency, pagination and sanitised-error protections.
- No additional database migration is required by this follow-up. The original Member 5 migration remains required for the full delivered source.

## Regression coverage

New tests exercise the real payroll API wrapper and shared client together against a separate API origin, including Auth0 parameters, trailing-slash configuration, missing credentials, HTTP errors, an HTML fallback, the filename and download cleanup. Backend coverage verifies filename-header exposure only for the configured origin. UI regressions cover history recovery without a status change and both synchronous and asynchronous import refresh failures.

Verification results are recorded in `evidence/s3-m5/followup-audit-checks.txt`. Live Auth0, Neon and deployed browser smoke checks remain part of integration release verification.

# Tab-focus workspace preservation fix (20 October 2026)

## Bug and cause

The shared `useCurrentUser()` hook previously handled `window.focus` by clearing the signed-in profile and role, then calling `/api/me` again. `App.jsx` reacted to that transient null/loading state by replacing the entire role-based workspace with the loading card. React unmounted active screens, so unsaved input values disappeared when returning from another browser tab/window.

## Fix

The initial profile fetch and explicit `PERMISSION_EVENT` still gate access as before. A **window-focus** recheck is now a **background refresh** once a profile is loaded: it does not clear the current user/role or set the initial workspace loading state. An updated profile/role still replaces stale access when the response arrives. An explicit session invalidation still closes access immediately. Transient background network errors (no HTTP response, HTTP 429 or 5xx) preserve the mounted workspace; other errors fail closed. The backend continues to enforce roles and permissions on every protected request.

This is a shared authentication fix, not a form-specific workaround. It prevents ordinary focus revalidation from unmounting the Tutor, Student and Organiser forms, including Proposal Lab/Scenario Planning. It does **not** save unsaved forms across an explicit page reload, browser crash, closing the tab, or navigating away from a page.

## Added regression tests

`frontend/src/auth/useCurrentUser.test.jsx`:

- Keeps a live Organiser form DOM node and an unsaved proposal name during and after a delayed focus recheck.
- Keeps the role during a transient focus-refresh network failure.
- Updates the role if the latest server profile returns a different role.
- Existing tests continue to cover permission-event revalidation and session invalidation.

## Manual browser QA (use local development, not production data)

1. Sign in to Organiser > Proposal lab, type a unique unsaved proposal name and enter dates. **Do not generate/save.**
2. Click another browser tab for a few seconds; return. The same form, dates and preset remain visible without a loading screen replacing the workspace.
3. Repeat with Scenario planning > Create draft; and an unsaved Add assignment form.
4. Verify Tutor forms and Student forms behave similarly when returning to the tab.
5. Use a genuine sign-out and confirm protected pages are no longer accessible.
6. Check role revocation/permission-denied paths with authorised test accounts; workspace must not remain accessible after denial.
7. Optional: temporarily disconnect network after login and return to tab; an unsuccessful background refresh should not discard unsaved values.

## Test status of this delivered archive

JavaScript syntax check for `useCurrentUser.js`: PASS. TypeScript JSX parser/transpiler syntax diagnostics for both changed files: PASS. Full lint/unit/coverage/build/database/CI checks: **NOT RUN/PASSED HERE** because this execution environment cannot fetch npm dependencies (`EAI_AGAIN` / `ENOTCACHED` from registry.npmjs.org). The merge instructions explicitly block pushing until the complete local checks pass and Gitea CI is subsequently green.

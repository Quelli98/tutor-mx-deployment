# AI Development Declaration

## Sprint 3 Member 4

- Qoder[Auto tier; underlying model automatically routed] was used on 24 September 2026 for S3-M4-1 on branch `s3/m4/completion`: the Student withdrawal action for a pending volunteer request, wired to the existing withdrawal endpoint with the PENDING-only affordance, the confirmation dialog, the in-flight duplicate guard, refresh after a conflict and the accompanying client and component tests.

- Qoder[Auto tier; underlying model automatically routed] was used on 24 September 2026 for S3-M4-2 on branch `s3/m4/completion`: the `sourceRequirementId` trace from overflow work back to the staffing requirement it was converted from, the organiser overflow service listing, posting, editing and closing that work inside Serializable transactions with `updatedAt` version checks and claim guards, the four ORGANISER routes, the overflow API client, the post/edit/close and send-to-overflow screen with its route and navigation entry, and the accompanying unit, route and component tests.

- Qoder[Auto tier; underlying model automatically routed] was used on 24 September 2026 for S3-M4-3 on branch `s3/m4/completion`: the accessibility and responsive polish of the Student and organiser overflow screens, the Tab focus trap and per-dialog title id in the shared confirmation dialog, focus return to the outcome message after confirmed volunteer, withdraw and close actions, focus placement for edit, send-to-overflow, cancel and invalid-field states, and the accompanying keyboard, focus and responsive tests.

## Sprint 3 Member 3

- Qoder[Auto tier; underlying model automatically routed] was used on 23 September 2026 to implement S3-M3-1, S3-M3-2 and S3-M3-3 on branch `s3/m3/completion`: the academic-term model, migration, seed and listing route; the CSV, paste and calendar-file timetable parser and its mapper onto the existing TimeSlot payload, with a preview route, an atomic commit route and the Tutor import card; the returned-timesheet correction, revision-history, declaration and dispute surface, with the database-enforced editability rule, the responsible-organiser notification and the timeline UI; the payroll CSV export and its reconciliation with the workload report; and the accompanying unit, route and schema-integration tests.

## Sprint 2 Member 1

- ChatGPT[GPT-5.6 Sol] was used on 13 September 2026 to integrate the supplied S2-M1-1, S2-M1-2 and S2-M1-3 snapshots on top of the already integrated Members 4/5/6 Basic API, audit them against the 11 September handbook, update the endpoint-role matrix from the obsolete Student-mock boundary to the current real Basic routes, expand the automated smoke suite to all 36 authenticated routes, expand the live smoke runner to 22 representative side-effect-safe probes, and update Member 1 handoff/runbook evidence.

- Qoder[Auto tier; underlying model automatically routed] was used on 31 August 2026 to implement S2-M1-3 (cross-role security smoke suite and assigned fixes) on branch `s2/m1/security-smoke`: the original automated three-role smoke suite, live shared-environment smoke runner, smoke runbook/evidence document and handoff updates.

- Qoder[Auto tier; underlying model automatically routed] was used on 31 August 2026 to implement S2-M1-2 (role and ownership protection across the completed Basic API) on branch `s2/m1/role-protection`: the endpoint-to-role/ownership matrix document, the Organiser-only and Tutor-only wrong-role/missing-token sweep tests, the query-level cross-user ownership assertions for work logs and excuses, and the handoff evidence updates.

- Qoder[Auto tier; underlying model automatically routed] was used on 31 August 2026 to implement S2-M1-1 (auth lifecycle hardening and email-verification recovery) on branch `s2/m1/account-lifecycle`: the authenticated `POST /api/auth/resend-verification` endpoint backed by the server-only Auth0 Management API verification-email job, the frontend resend/recovery UI in the onboarding card, automatic recovery from a stale pending role (`409 ROLE_ALREADY_SET`) so a linked account never returns to role choice, automatic sign-out after successful account deletion, the accompanying failure/recovery tests, and the handoff evidence updates.

## Sprint 2 Member 3

- Qoder[Auto tier; underlying model automatically routed] was used on 12 September 2026 for S2-M3-1 on branch `s2/m3/tutor-dashboard-api`: dashboard refresh/status handling, preservation of the last safe state after a failed refresh, and tests for changed assignments, unset limits and retry.

- Qoder[Auto tier; underlying model automatically routed] was used on 12 September 2026 for S2-M3-2 on branch `s2/m3/timesheet-basic`: the timesheet API client, weekly draft grouping, submission and decision-status UI, returned-week resubmission, session persistence and tests.

- Qoder[Auto tier; underlying model automatically routed] was used on 13 September 2026 for S2-M3-3 on branch `s2/m3/excuse-regression`: excuse decision/status history, organiser outcome display, future-session validation and the combined Tutor Basic regression test.

- Codex[GPT-5] was used on 13 September 2026 to audit and integrate the three supplied Member 3 snapshots into the latest Gitea main, preserve completed Members 1/4/5/6 code, scope cached workflow state to the signed-in tutor, correct draft week labels and run the required integration verification.

## Current integration

- Codex[GPT-5] was used on 14 September 2026 to audit the two supplied Sprint 2 Member 2 snapshots against the 11 September handbook, integrate the valid Organiser work into the completed Members 1/3/4/5/6 main snapshot, finish live allocation create/edit/remove and Organiser approval queues, harden server-side rules and scoped removals, unify the application UI/UX, expand route/service/component/security tests, and prepare the final Sprint 2 handoff.

- Codex[GPT-5] was used on 13 September 2026 to audit Sprint 2 Member 4 against the 11 September Sprint Handbook, reconcile the stale Member 4 routes with the integrated Member 5/6 API, add the signed-in Student volunteer-request list, fix authenticated frontend request stability, complete holiday fallback/source, responsive and keyboard behavior, add regression tests, and update handoff documentation.

- Codex[GPT-5] was used on 23 August 2026 to audit the supplied Member 2 branch against Sprint Handbook pages 1-29, integrate it into the current main snapshot, complete the missing Organiser allocation board/rule messages/tutor mark and busy-time UI, add authenticated API contract wiring and tests, preserve the existing Auth0/Express/Prisma/Neon boundaries, and update integration evidence.

- ChatGPT[GPT-5.6 Sol] was used on 17 August 2026 to integrate the supplied Member 4 Student overflow/shared UI work into the current Members 1, 3, 5 and 6 main snapshot, correct a case-sensitive frontend import/file-name mismatch, preserve role/security boundaries, update Sprint 1 integration documentation and perform static repository verification.

- ChatGPT[GPT-5.6 Sol] was used on 16 August 2026 to compare the Gitea main snapshot with the GitHub deployment snapshot, integrate deployment changes back into the team source tree, update public-demo documentation and verify the merged file set.

- Codex[GPT-5] was used for code generation, integration, test authoring, security review and documentation review.
- The generated and reviewed areas include the Auth0 token verifier, Express authentication contract, profile/course/tutor-workflow endpoints, allocation rules, React account lifecycle, role routing, tutor dashboard/forms, tests, CI integration and handoff documentation.

## Supplied Member 1 work
The supplied evidence confirms Qoder application version 1.23.0, VS Code version 1.106.3, Quest Agent mode and the Auto tier. Qoder automatically routed each request to an underlying model that was not disclosed, so no specific provider model has been guessed. The truthful declaration is `Qoder[Auto tier; underlying model automatically routed]`.

## Supplied Member 4 evidence
The supplied Member 4 handoff records that the handoff document itself was generated/reviewed with `Codex[GPT-5.6 Luna]` and `Claude[Sonnet 5]`. This integration preserves that statement as supplied evidence; it does not infer that those tools generated every Member 4 source file.

## Human responsibility

The team remains responsible for reviewing the code, reproducing the acceptance tests, configuring Auth0/Neon/Codecov without committing secrets, using the required `Assisted-by: <tool>[<model>]` commit trailers and preserving any required assessment transcript.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5], ChatGPT[GPT-5.6 Sol].

- 17 Aug 2026: Self-service role onboarding (front-page role choice, server-only Auth0 Management API role provisioning, automatic Prisma/Neon Profile creation, first-token role resolution and tests) was assisted by ChatGPT [GPT-5.6 Sol].

## Sprint 3 Member 5 hardening - 25 September 2026

Codex (OpenAI; exact model identifier not supplied in this session) was used to audit the supplied integrated main archive against S3-M5-1/2/3, fix the organiser approvals/disputes contract, implement API validation and error hardening, add transactional retry receipts and atomic return history, prevent repeated overflow conversion, bound and measure report/ranking queries, add regression tests, and prepare the handoff/documentation evidence. The changes require human integration review; no remote CI, live authenticated test or deployment is claimed.

Follow-up audit: Codex reviewed API routing and save/refresh handling, corrected authenticated CSV downloads and history recovery, added regression tests, and updated the handoff. The exact underlying model identifier was not supplied by the runtime. Local test results and remaining deployed-environment checks are documented in the audit report.

## CSAM Tutor Hub homepage redesign - 25-26 September 2026

- Claude Code[Claude Opus 5.5] was used on 25-26 September 2026 on branch `design/ui-redesign` to build the public CSAM Tutor Hub homepage from the Figma design: the signed-out landing page with Create account and Sign in for each role (sign-up starts with the chosen role), the vector CSAM mark reused in the header, role navigation and favicon, the line illustrations, brand rings and hover depth with reduced-motion handling, the responsive layout, the display rename from Tutor Mx to CSAM Tutor Hub in user-visible frontend text and API messages, a specific message when Organiser self-sign-up is disabled, and the updated App tests. It was also used to make sign-in and sign-up always show the Auth0 form (so people can choose the account for their role) and to prepare the Auth0 sign-in page branding assets under `frontend/public/auth/`; the building photo was supplied by the team member, and the Plus Jakarta Sans font is included under its SIL Open Font License. The Figma design itself was produced with Claude Code through a local plugin kept outside this repository. The role photos are Pexels images (free licence, no attribution required) with their backgrounds removed using macOS Vision. Verified locally with the frontend (539) and backend (1083) test suites, lint, typecheck, build and headless-browser screenshots; no deployed-environment check is claimed.

## CSAM Tutor Hub organiser workspace redesign - 26 September 2026

- Claude Code[Claude Opus 5.5] was used on 26 September 2026 on branch `design/ui-redesign` to build the organiser workspace from the approved Figma design. It covers:
  - a navy sidebar layout for organiser pages (Home, Courses, Tutors, Reports, a Bulk allocation card, Account settings and Sign out), with a menu on narrow screens;
  - a top bar with the organiser's name, search and notifications;
  - an organiser Home page gathering quick-action tiles, the selected week's figures (open requirements, approvals waiting, hours allocated and budget used this year), the approval queues with their decisions, the week's open staffing requirements, current allocations with edit and remove, course cards, an hours-per-week chart and tutor workloads;
  - the allocation board moved into a slide-over "Allocate a tutor" panel, with its validation, rule results, ranking and save/update/remove behaviour kept the same;
  - the approval logic moved into a shared hook used by both the Approvals page and Home;
  - a later visual pass:
    - a soft brand-coloured page background;
    - on every organiser page, a light banner (after the team member's `banner.webp` reference) with a scene of a person at a chalkboard written about that page and a handwritten line, and a welcome banner on Home;
    - icons on card titles;
    - Courses as photo-cover cards;
    - Tutors as profile cards with a summary strip;
    - four charts on Reports (hours by course, budget used, share of the work, tutor hours and limits) above the unchanged detailed tables.
- It also wrote the new component, hook and helper tests and updated the dashboard and router tests to the new layout.
- The line icons are Lucide (ISC licence) and the flat illustrations are unDraw (free licence, no attribution required), recoloured to the CSAM palette.
- The banner people and the course and tutor cover photos are public-domain (CC0) photos from StockSnap and rawpixel, found through Openverse. The team member chose the people. Their backgrounds were removed with macOS Vision.
- The design itself was produced in Figma with Claude Code through the local plugin kept outside this repository.
- Verified locally with the frontend test suite (576 tests), lint, the production build, the repository security check, and headless-browser screenshots of the real components with sample data at 1440px, 1000px and 390px wide. No deployed-environment or live-API check is claimed.

## CSAM Tutor Hub allocations timetable and main merge - 26 September 2026

- Claude Code[Claude Opus 5.5] was used on 26 September 2026 on branch `design/ui-redesign` for two pieces of work.
- The first was merging `main` into the branch. This brought in a teammate's organiser Command centre and the deep links to one course or one tutor. The merge resolved the conflicts in the router, its tests and `App.css`. It also:
  - placed Command centre in the organiser sidebar;
  - let its banner span the full width until it has a scene of its own;
  - pointed two course deep-link tests at the course cards that replaced the courses table.
- The second was redesigning "Current allocations" on the organiser Home as a week timetable, after the team member compared rendered options and chose it:
  - Monday to Friday, and a weekend day only when a session falls on it;
  - tutors on the same session shown together in a block in the course's colour;
  - the Home week picker driving the timetable, with links to the nearest earlier or later week that has allocations;
  - a compact layout for crowded weeks on narrower screens, and stacked days on phones.
- Each tutor opens the allocation panel. Remove moved into that panel, in a "This allocation" summary, and still asks for confirmation.
- It wrote the timetable component and helper tests and updated the dashboard tests.
- Verified locally with the frontend test suite (722 tests), lint, the production build, the repository security check, and headless-browser screenshots with sample data at 1440px, 1000px and 390px wide. No deployed-environment or live-API check is claimed.


## Sprint 4 Member 1 update - 3 October 2026

Codex assisted with AI code generation, AI in-line editing and AI code review for shared Student/Tutor schedules, session hardening, permission-checked navigation, notifications and recent/favourite destinations. It also generated regression tests and the handoff notes. The final integrator should review the changes and run project CI before merging. See `START-HERE-SPRINT4-MEMBER1.md` and `docs/sprint4-member1-handoff.md`. No live production deployment or stakeholder validation is claimed.

# AI Development Declaration

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

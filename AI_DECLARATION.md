# AI Development Declaration

## Current integration

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

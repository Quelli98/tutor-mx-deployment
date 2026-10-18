# AI use and attribution

Updated 10 October 2026 against the supplied COMS3011A AI Policy dated 20 July 2026. This is the team's implementation of that supplied policy, not a claim that no later course/university policy exists. If policies conflict, the course policy says to follow the University policy and request clarification.

## Confirmed team account

| Contributor | Confirmed tool | Model evidence | Purpose |
| --- | --- | --- | --- |
| Raquel / Integration Lead | ChatGPT (Codex coding agent) | Models as recorded in this repository's `Assisted-by:` trailers on `main` (ChatGPT[GPT-5.6 Sol], ChatGPT[GPT-5.6 Luna], ChatGPT-Work[GPT-5], Codex[GPT-5], Codex[GPT-6], Codex[GPT-5.6 Sol Ultra]) | Project assistance, code generation, integration/review and documentation; session-level confirmation still required |
| Other team members | Qoder | Labels as recorded in this repository's `Assisted-by:` trailers on `main` (Qoder[Auto tier; underlying model automatically routed], Qoder Quest[Auto], Qoder[Claude Sonnet 4]) | Team development assistance; each member must record code-generation, review and in-line editing use where applicable; session-level confirmation still required |
| Final audit, 10 October 2026 | ChatGPT's Codex coding agent | Model labels as recorded in this repository's `Assisted-by:` trailers on `main` (Codex[GPT-5], Codex[GPT-6], Codex[GPT-5.6 Sol Ultra]) | Handbook/source audit, proposal transaction and explanation fixes, regression tests, documentation cleanup, local verification and packaging |

Do not infer an AI model from an application version or an About dialog. If Qoder used Auto, record that observed setting and that the underlying model was not disclosed; ask the lecturer whether this satisfies the model requirement. The current audit has not verified Auto for every member.

Earlier files asserted Codex[GPT-5], ChatGPT[GPT-5.6 Sol] and Claude Code[Claude Opus 5.5], sometimes inconsistently. Those labels now appear in the team's own contemporaneous `Assisted-by:` trailers on the official Gitea `main` branch (79 commits carry 82 trailer lines across 12 forms). The trailers are retained unchanged and record what was declared at commit time; they are not independent verification of the models, and session-level confirmation is still required where noted above. Do not erase truthful original commit attribution if the sessions substantiate it.

## Code requirements

- The README must disclose AI code generation, AI in-line editing and AI code review, including tool and actual model. Declare non-use only where the team has confirmed it.
- Each commit containing AI-generated code requires an `Assisted-by: <tool>[<model>]` trailer for all assisting tools. Preserve actual newlines in the commit body.
- In-line/autocomplete assistance does not require a trailer for every commit under the supplied policy, but does require README disclosure. Code review also requires README disclosure.
- Record what the tool did. Developers must read, understand and verify code before submission. Every member remains responsible; the whole group is liable for group work.
- Do not send credentials, personal records or private production data to AI tools. Use synthetic fixtures and redacted examples.

Template (replace every angle-bracket field using actual session evidence):

```text
fix: complete final Tutor Mx audit and proposal safeguards

Assisted-by: <actual ChatGPT tool>[<verified model>], <other assisting tool>[<verified model>]
```

The ZIP archive distributed with the report contains no original `.git` history; the official Gitea repository does, and `main`'s trailers are verifiable there and preserved unaltered. No remote commit, merge or historical trailer repair is claimed. A later attribution note is not evidence that an earlier AI-generated commit had the required trailer, and no such claim is made here.

## Writing and assessments

Every submitted report/document must include a use/non-use declaration. For assisted writing, state that it was planned/reviewed/edited/generated with each actual tool and model. The supplied policy says documents lacking a declaration will not be marked. A repository README declaration does not replace declarations in separately submitted reports, PDFs or the documentation website.

Review generated prose, references and diagrams, and rewrite in the team's own voice where appropriate. Check references and technical claims rather than assuming generated content is correct.

For an assessment, start a new session and retain the unedited transcript, or the permitted substitute if export is unavailable, when required. Follow any assessment-specific restriction.

## Evidence still required before policy sign-off

1. Raquel's session-level confirmation of the ChatGPT/Codex models recorded in `main`'s trailers for submitted work.
2. Each other member's session-level confirmation of the Qoder labels recorded in `main`'s trailers, plus explicit in-line editing and review use/non-use.
3. A lecturer ruling on whether the recorded Qoder[Auto tier; underlying model automatically routed] wording satisfies the policy's model requirement.
4. Declarations in each separately submitted document, using its actual tools/models.

The selected response “I know the settings” contained no model values. No model values have been invented. The repository security check verifies declaration structure only; it cannot certify provenance or full policy compliance.

The preceding document was reviewed and edited with ChatGPT's Codex coding agent; its code-side model labels are those recorded in this repository's `Assisted-by:` trailers on `main`.

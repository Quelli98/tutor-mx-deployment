# Sprint 4 Members 1–5 — updated source

This package continues the Members 1–4 delivery and adds Member 5. Earlier implementations, guides and evidence are retained. Read this guide for the current update.

## Added for Member 5

- Shared, immutable audit events with actor, time, action, target and safe before/after snapshots. Successful changes and their audit records commit together.
- An Audit timeline in the existing Organiser Command centre, with date, actor, action and target filters, event details and safe CSV export.
- Allocation history and a current-versus-historical restore preview. Confirmation requires a reason and rechecks the version, marks, clashes and capacity. Restore creates a replacement allocation and preserves history.
- Retry receipts for Student sick-note submissions and Organiser decisions, plus focused permission, ownership, rollback and competing-request checks.

The new controls reuse the existing workspace cards, dialogs and compact styling. Member 5 extends the established UI.

## Install

Continue your integrated Members 1–4 checkout on `s4/m5/completion`. Merge the supplied source with any newer team changes; preserve your repository metadata and local credentials. The changed-file list is `docs/sprint4-member5-changed-files.md`.

From the project root:

```sh
npm ci
npm ci --prefix frontend
npm run generate
npm run db:migrate
npm run dev
```

Use the intended development database in `DATABASE_URL`. Apply `20261011000000_s4_audit_restore` and all preceding migrations before starting the updated backend/frontend. Do not reset an existing database. No new environment variable or runtime dependency is needed.

Existing allocations receive a minimum-mark value of 50: the older schema did not retain custom thresholds, so those values cannot be reconstructed automatically. Newly created/updated allocations retain their threshold. Audit history begins with this instrumentation; the update does not invent historical events.

## Try it

1. Make an allocation, scenario, booking, swap or sick-note change through the existing screens.
2. As an Organiser, open Command centre → Audit timeline. Filter and open an event to inspect its actor and before/after details.
3. Choose an allocation event, select its historical event and before/after side, then preview. Read the comparison and any blocking rules.
4. If eligible, enter a reason and confirm Restore. Follow the replacement allocation link. A stale result requires a fresh preview.
5. Export the applied audit filters to CSV. Narrow the filters if the export exceeds 1,000 events or 5 MB.

## Verification and handoff

Focused backend verification passed 385 tests across nine files. After the last threshold/provenance changes, the three affected service suites passed 162 tests. These runs overlap; their counts must not be added. The focused frontend run passed 53 tests across five files. Generation, lint, type checking, both builds and the repository security check passed. Raw evidence and its interpretation are in `docs/evidence/s4-m5/`.

Real-browser screenshots/races and live Auth0/Neon checks remain for the configured integration environment. No final Sprint 4 release gate, remote push, main merge, live migration or deployment is claimed. See `docs/sprint4-member5-handoff.md` and `docs/sprint4-member5-endpoint-role-matrix.md`.

# Sprint 3 Member 5: integrated API hardening

25 September 2026 · branch target `s3/m5/completion`

## Why these changes were needed

Member 5 starts after the vertical features from Members 1-4 have landed. The work therefore keeps the Auth0, Express, Prisma and Neon architecture and strengthens the points where those features meet. The supplied screenshot exposed a contract integration failure: the approval screen requested a disputes URL that the API does not register. Its all-or-nothing parallel load turned that 404 into a blank approvals screen, and reused decision-save wording for a read failure.

The frontend now requests `GET /api/organiser/timesheet-disputes`. A disputes failure is displayed within its section, while timesheets, claims and excuses remain usable. Load failures and uncertain writes have different messages. A confirmed decision removes its card before refreshing, so a later network failure cannot imply that the save failed or invite a duplicate click. The page uses consistent cards, restrained error panels, bounded reason fields, accessible labels, and responsive action layouts. Date-only work dates and week labels render in UTC so browser timezone conversion cannot move them to the previous day.

A second mismatch concerned disputes. The screen offered “Reinstate timesheet” and “Uphold decision”, but the server only persisted a resolution reason. Those buttons were misleading. The corrected screen presents **Resolve dispute**, states that the timesheet status remains unchanged, and sends only the supported field. The organiser queue reads tutor identity and week details through its existing relation query; fallback labels handle older responses.

## S3-M5-1: contracts, permissions and ownership

Every route below authenticates the bearer token and resolves the stored profile role. Profile role mismatches remain 403. Missing credentials remain 401. Resource ownership uses the verified subject, not a browser-supplied profile identifier. Missing and cross-user tutor/student resources retain non-disclosing 404 responses. Organisers have the existing system-wide workflow oversight; this work does not invent course-specific ownership where the application has none.

| Family | Routes | Permitted caller and ownership |
| --- | --- | --- |
| Search | `GET /api/search` | All three roles; role/category intersection. Tutor timesheets/courses and student claims are profile-scoped. |
| Notifications | `GET /api/notifications`, `/unread-count`, `/:id`; `PATCH /:id/read`; `POST /read-all` | Authenticated recipient only; profile ID resolved from token subject. |
| Reminders | `POST /api/notifications/reminders/run` | Organiser only. Recipients and stable event keys are server-derived. |
| Terms | `GET /api/academic-terms`; `POST /api/organiser/academic-terms` | List requires a profile; creation is organiser-only. |
| Requirements | `GET/POST /api/staffing-requirements`; `PATCH /:id`, `/:id/status` | Organiser only; creation actor comes from the token. |
| Ranking and bulk | `GET /api/allocations/candidates`; `POST /api/allocations/bulk-preview`, `/bulk-commit` | Organiser only. Bulk course/time/hours come from stored requirements, with hard eligibility rechecked at write time. |
| Reports | `GET /api/reports/workload`, `/payroll-export` | Organiser only; read-only aggregated queries. |
| Timetable import | `POST /api/tutor/time-slots/import/preview`, `/commit` | Tutor's own schedule; academic-term bounds reloaded on the server. |
| Corrections | `GET /api/tutor/timesheets/:id/history`; `PATCH /:id/work-logs/:logId`; `POST /:id/declaration`, `/:id/disputes` | Owning tutor only; work-log ownership includes both tutor and timesheet. |
| Organiser review | `GET /api/organiser/approvals`, `/api/organiser/timesheet-disputes`; `PATCH /api/timesheets/:id/decision`, `/api/volunteer-claims/:id/decision`, `/api/excuses/:id/decision`, `/api/timesheet-disputes/:id` | Organiser only; persisted state controls permitted decisions. |
| Organiser overflow | `GET/POST /api/organiser/overflow-work`; `PATCH /:id`, `/:id/close` | Organiser only; edits/close require the last observed version. |
| Student overflow | `GET /api/student/open-work`, `/api/student/volunteer-requests`, `/:id`; `POST /api/student/volunteer-requests`; `PATCH /:id/withdraw` | Student only; request ownership comes from token subject. Only open, unexpired work can be claimed. |

The public error envelope remains `{ "error": { "code": "...", "message": "..." } }`. A shared branded error constructor and sanitiser expose only deliberately public errors. Stack traces, SQL, connection details and forged status-shaped errors are not returned. Import-service errors now use that constructor, preserving intended 400/404/409 responses rather than degrading to 500. Bulk item failures use the same sanitiser. Malformed JSON returns 400; oversized JSON returns a specific 413; rate limiting returns JSON 429. CORS headers are applied before body parsing and rate limiting, including error responses.

| Boundary | Enforced limit |
| --- | --- |
| JSON writes | 32 KiB request body |
| PostgreSQL resource IDs | Positive decimal integers, at most 2,147,483,647 |
| Search and notification pages | 1-10,000; page size 1-25; invalid HTTP pagination returns 400 |
| Search text | 2-100 characters; SQL LIKE wildcards escaped and values parameterised |
| Bulk preview/commit | 1-50 items |
| Report period | Monday start; 1-52 weeks |
| Workload output | At most 5,000 course rows and 5,000 tutor rows |
| Payroll output | At most 10,000 grouped lines |
| Candidate ranking | At most 2,000 candidate rows |
| Requirement list | At most 5,000 rows; bulk selection additionally restricts IDs in the database |
| Import | 400 rows/events; 30,000 text characters, also subject to the UTF-8 JSON body limit |
| Reasons | At most 1,000 characters |
| Idempotency key | 8-128 characters from letters, digits, dots, underscores, colons and hyphens |

Report/ranking/list caps query one extra row and return `422 RESULT_LIMIT_EXCEEDED` if exceeded. They never silently truncate totals or change the candidate ranking. Request sizes are additionally bounded before service code runs. Shared validators test safe IDs, page/size limits, declaration-version matching and legal transitions.

## S3-M5-2: retries, transactions and competing writes

A durable `ApiWriteReceipt` table supports import and overflow creation. The receipt owner is the authenticated profile. The stored key incorporates the operation scope, and the validated payload is fingerprinted with deterministic key ordering. The receipt and domain writes use the same serializable transaction: a rollback removes both. A successful retry returns the original result; reusing the key for different content gives `409 IDEMPOTENCY_KEY_REUSED`. No tokens, imported raw files or request bodies are stored in receipt identity fields. Successful response data is stored to support replay.

The frontend holds retry keys after uncertain responses and releases them after a confirmed, contract-valid success. This in-memory cache is bounded to 100 attempts and does not survive a page reload. An API client requiring replay across reloads must retain and reuse its own key. Existing unkeyed timetable clients remain protected by the transactional duplicate check. Requirement conversion additionally deducts active overflow hours, so sequential retries cannot invent new slot indexes for the same already-advertised shortage. Manual creation should use a key, as the supplied frontend now does; identical-looking manual postings can otherwise be intentional separate work.

Concurrent serializable transactions may produce a safe 409 on one competing request. Retrying with the same key then replays the committed outcome. Overflow updates retain their compare-and-set version check, with a monotonically increasing timestamp even within one millisecond. Claim uniqueness and one accepted claim per overflow item continue to use existing database constraints and transitions. Notification delivery uses stable event keys with the database unique index and duplicate-skipping inserts; reminders use the same strategy.

Bulk allocation deliberately retains item-level commit semantics: each allocation is revalidated inside its own serializable transaction. A failed item is reported safely and successful items remain saved. The existing tutor/session clash rules reject duplicate allocations on retry. The audit does not replace this behaviour with an all-or-nothing batch.

A returned timesheet previously relied on a best-effort history operation after the review committed. A database trigger now inserts the return revision in the review transaction. The migration also preserves the latest reason on existing returned sheets if that history is missing. If the history write fails, the decision rolls back. The previous idempotent history helper remains compatible and detects the trigger's record. Correction/revision writes and dispute decisions retain their serializable transactions and ownership guards.

## S3-M5-3: bounded performance and safe observability

Workload reporting previously used correlated aggregates for each course and tutor. It now groups allocated and approved worked hours before joining them to the dimension tables. This retains the existing pricing snapshot and totals but avoids repeated per-row aggregate scans. Two SQL statements produce the workload report; one produces payroll. Bulk loading reads only the selected requirement IDs. Candidate ranking remains one SQL statement per selected requirement because each requirement has a distinct course/time/eligibility window; at most 50 requirement queries are permitted, with one batched requirement-fill query rather than a query per returned row.

Search ordering now includes stable ID tie-breakers. Request logs contain route templates, status and duration, not concrete resource URLs, query strings, tokens or bodies. Background notification/history failures use fixed safe messages instead of raw database errors. Notification recipient lookup is inside the best-effort notification boundary for submission/dispute workflows, so a failure after a committed write cannot turn its success into a false error response.

The reusable benchmark is `node --import tsx scripts/measure-s3-m5.ts`. It applies the actual migrations to a fresh local PGlite database, creates 1,000 tutors, 50 courses, 500 confirmed allocations and 250 approved work logs, checks report totals, and takes seven warm measurements. These measurements exclude production network, Auth0 and hosted database latency.

| Operation | Median ms | Maximum ms | SQL queries per call |
| --- | ---: | ---: | ---: |
| Workload report | 15.29 | 22.68 | 2 |
| Payroll export | 7.21 | 8.91 | 1 |
| Organiser search | 4.00 | 6.02 | 3 |
| Candidate ranking | 27.23 | 35.09 | 1 |
| 400-row import parsing | 10.90 | 12.66 | 0 |

## Verification evidence and boundaries

The backend suite passed 1,082 tests and the frontend suite passed 529 tests. Backend coverage passed the existing thresholds: 92.26% statements, 86.12% branches, 94.57% functions and 93.06% lines. The new role/contract matrix covers every listed feature family; existing ownership suites exercise cross-user notification, tutor and student reads/writes. New tests cover error sanitisation, invalid pagination and IDs, 413/CORS handling, real import receipts and rollback, repeated shortage conversion, overlapping bulk requests, notification/reminder deduplication, dispute compare-and-set conflicts and organiser-page recovery.

PGlite tests execute the real schema, constraints and triggers, including import rollback. PGlite uses a single connection: simultaneous Promise-based tests are not a multi-connection Neon load test. Additional service tests model competing compare-and-set outcomes deterministically. No production credentials were supplied; authenticated live smoke tests and the final combined-main release gate remain the Integration Lead's responsibility. No production deployment or remote CI result is claimed.

The approvals screen was rendered in Chromium at 1440px and 390px widths with fixture data. Both had no runtime errors and no page-level horizontal overflow; the mobile work-log table scrolls within its card. Screenshot evidence is in `docs/evidence/s3-m5/`.

The production build succeeds. Existing non-blocking notices include one unrelated React lint-disable warning and the frontend bundle-size advisory. Neither is presented as a newly introduced regression.

## API examples

All examples require `Authorization: Bearer <access-token>`; write examples also use `Content-Type: application/json`.

```http
GET /api/organiser/timesheet-disputes
```

```http
PATCH /api/timesheet-disputes/71

{"resolutionReason":"Reviewed the disputed entries with the tutor."}
```

```http
POST /api/tutor/time-slots/import/commit
Idempotency-Key: timetable-25sep-attempt-01

{"source":"CSV","text":"date,start,end,label,repeat\n2026-09-28,09:00,10:00,Lecture,once","timeZone":"Africa/Johannesburg","termId":1}
```

Use a real term ID covering the imported dates. Retain the same key and body for a retry; generate a new key for changed content.

```http
POST /api/organiser/overflow-work
Idempotency-Key: overflow-25sep-attempt-01

{"courseId":3,"startsAt":"2030-09-04T10:00:00.000Z","endsAt":"2030-09-04T12:00:00.000Z","hours":2,"closesAt":null,"sourceRequirementId":null}
```

Resource IDs and dates above are illustrative. API success data remains inside `data`; conflicts retain the established safe code/message envelope.

## Handoff and report use

Keep this work on `s3/m5/completion`. Member 5 hands implementation and local evidence to the Integration Lead; Member 6 starts from updated main only after review and integration. The report should describe the contract mismatch, why the existing architecture was preserved, how database transaction boundaries were strengthened, and what the local evidence can and cannot prove. This page is report evidence, not a claim that remote CI, production migrations or user acceptance testing have already run.

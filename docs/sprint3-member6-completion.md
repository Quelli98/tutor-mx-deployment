# Sprint 3 Member 6: Organiser Command Centre

25 September 2026 · branch `s3/m6/completion` (tracking `origin/s3/m6/command-centre-attention`)

Member 6 adds the Organiser Command Centre: one organiser screen at `/organiser/command-centre` backed by one aggregate read, `GET /api/organiser/command-centre`, that puts the live Sprint 3 data side by side for a chosen period of whole weeks — the headline staffing, money, workload and queue figures (S3-M6-1), a day-by-day shortage heatmap with budget and workload/fairness visualisations (S3-M6-2), and a Needs Attention feed whose cards deep-link to the screen that already handles each issue (S3-M6-3). It introduces one new backend service (`src/services/command-centre-service.ts`), one new route, and one new frontend screen, and it reuses the reads that Members 1–5 already provide rather than re-deriving any of their figures.

## Why these changes were needed

Before this work an organiser had to open five separate screens to answer the questions the Command Centre answers at a glance:

- **Headline operational summary** — how many hours the coming weeks require, how many are allocated, and how many are still unfilled were three different screens' numbers, read at different moments.
- **Staffing shortage visibility** — the staffing board shows one requirement at a time; there was no view of *which days* the period is short of tutors.
- **Budget visibility** — spend against budget existed only as per-course report rows, with no period-level position and no over-budget flag carried onto an organiser's start page.
- **Workload/fairness visibility** — tutor loading was visible only inside the workload report, with no summary of who is carrying the period and how the work is spread.
- **Actionable Needs Attention feed** — nothing told an organiser what needs a person *right now*: shortages, posted work nobody claimed, queues waiting on a decision (and how long they have waited), tutors at or near capacity, and budgets already overspent.

The implementation deliberately reuses the live Sprint 3 data and services already provided by Members 1–5: the staffing requirement service, the reporting service, the approval, dispute and overflow reads, and Member 1's notification store for reminder context. The one architectural addition is a single aggregate **read-only** endpoint, justified only because a dashboard is a cross-domain composition: no existing single read carries staffing, finance, workload and queue figures for the same period, and reading them separately would let the panels disagree by being measured at different moments. The aggregate owns no business rule of its own — it composes existing readers, sums what they already define, and is built from readers alone so a reporting screen cannot change any of the work it reports on.

## S3-M6-1: live Command Centre summary + drill-downs

**Route and navigation.** The screen is registered in `frontend/src/routes/RoleRouter.jsx` at `/organiser/command-centre`, wrapped in `ProtectedRoute` for the `ORGANISER` role, and listed first in the organiser navigation (`ORGANISER_LINKS`). A tutor or student navigating there gets the existing Access denied page; `RoleRouter.test.jsx` covers both directions.

**Period and week contract.** The period is whole weeks starting on a Monday, the same contract as the reports. The screen opens on the current week's Monday (`localMonday(new Date())` from `frontend/src/components/shared/scheduleWeek.js`), offers Previous/This/Next week buttons, a "Go to week" date picker that snaps any chosen day to its Monday before sending it ("The server only accepts a Monday, so snap to one rather than send a day it would refuse"), a length selector of 1, 4 or 12 weeks (`PERIOD_LENGTHS`, matching the reports screen's three lengths), and a Refresh button. The server re-validates everything: `parseWorkloadReportQuery` in `src/app.ts` insists on a Monday `weekStart` and an integer `weeks` of 1–52, answering `400 VALIDATION_ERROR` otherwise (route tests cover a non-Monday, a missing week, a malformed date, 0 weeks, 1.5 weeks and 53 weeks). The response's `period.weekEnd` is exclusive — the Monday after the last week — exactly as the reports read it.

**Backend aggregate endpoint and service.** `GET /api/organiser/command-centre` authenticates the bearer token, resolves the profile role and requires `ORGANISER`; it then calls `dependencies.commandCentreSummary(subject, query)`, passing the verified token subject so the dispute queue is read for the organiser asking. The dependency is optional: an environment that has not wired it answers `503 COMMAND_CENTRE_UNAVAILABLE` rather than a dashboard of blanks. `src/server.ts` wires `createCommandCentreService` over five existing readers:

- `staffingRequirementService.listStaffingRequirements({ status: "OPEN" })` — the period is applied in the command centre service, because the requirement list is the one read with no period of its own;
- `reportingService.workloadReport` — the finance and workload panels, unchanged;
- `organiserService.listApprovals` — the pending timesheet, volunteer-claim and excuse queues;
- `organiserOverflowService.listOverflowWork` — posted work and its claim counts;
- `timesheetCorrectionsService.listDisputes` — the organiser's open disputes (the service resolves the organiser from the `auth0Id` it is handed).

**Server-computed totals and the domain interpretation.** All totals are computed server-side. Staffing measures are summed from the requirement rows the staffing service already produced, using its own domain model: `requiredHours = windowHours × tutorsNeeded` (`requiredHoursFor` is the single definition), `shortageHours` carries the 0.01-hour tolerance rule, and `shortageTutors` is whole people rounded up. The service scopes requirements to the period by the instant they **start** (`startsAt` within `[weekStart, weekEnd)`), the same rule the reports use to bucket work; a requirement dated outside the period is another period's problem and is excluded from every total. The response carries `staffing.requiredHours`, `assignedHours`, `unfilledHours`, plus `openRequirements`/`unfilledRequirements` counts and the full requirement rows for the heatmap and feed. Spend is the money owed for approved work and `committed` the booked-but-not-worked hours priced at the current rate — both exactly as the reporting service defines them. `actions.total` is the four queue lengths added from the queues the summary already read, "counted from the queues above rather than from a separate query that could disagree with them".

**KPI cards and drill-downs.** `buildKpis` in `frontend/src/features/commandCentreModel.js` arranges the server totals into six cards — Allocated hours, Required hours, Unfilled work, Spend, Budget, Outstanding actions — each with a detail sentence, a tone, and a link to the existing screen that owns the figure: the allocation board (`/organiser`), staffing requirements (`/organiser/staffing`), bulk fill (`/organiser/staffing/bulk`), reports (`/organiser/reports`) and approval queues (`/organiser/approvals`). `DRILL_DOWN_PATHS`/`DRILL_DOWN_LABELS` are the single source of these targets, so a drill-down never lands on a page that is not there.

**Loading/empty/error/retry.** The screen shows the shared `LoadingState`, an `ErrorState` with a retry button, and a whole-period `EmptyState` (`isEmptyPeriod`: no requirements, no course rows, no tutor rows, no queue items and no open overflow) instead of drawing blank panels. Error copy is mapped by code (`PROFILE_NOT_FOUND`, `ROLE_MISMATCH`, `COMMAND_CENTRE_UNAVAILABLE`/`REPORTING_UNAVAILABLE`, `VALIDATION_ERROR`) and never leaks detail.

**Why the aggregate exists, and no duplicate business maths in React.** The endpoint exists because the cards, the heatmap and the feed must all be measured over the *same* weeks at the *same* moment; the service is composed from readers alone, and the frontend view model "arranges them for the screen … and never adds hours together or turns them into money itself". The API client (`getCommandCentreSummary` in `frontend/src/api/organiser.js`) validates the whole summary shape (`isCommandCentreSummary`) and refuses a response that is missing a panel or carries a non-number where a figure belongs, so a malformed payload fails loudly rather than rendering half a dashboard.

## S3-M6-2: shortage heatmap + budget/workload/fairness visualisations

**Shortage heatmap.** The backend produces `staffing.days`: every day of the period in order, each summed from the requirements that start on it (`daysOf` in the command centre service). A day with nothing on it keeps its zeros and has **no fill state at all**, so an empty day can never read as a filled one. The day's state is `fillStateFor(assignedHours, unfilledHours, "OPEN")` — the staffing service's own rule, not a second opinion about what "full" means. `fillStateFor` was accordingly promoted from module-private to exported in `src/services/staffing-requirement-service.ts` (the only change to that file: visibility plus a doc comment), "so a day's worth of requirements is described in exactly the same words as a single one".

The frontend renders one week per table row, weekdays as columns (`buildHeatmap` in `commandCentreModel.js`). Each square shows the required hours, the written state and the unfilled note; the courses starting that day are linked to their course screen (`/organiser/courses/:id`, the same path the search results publish). The states are **fully staffed / partly staffed / unstaffed / not being filled / nothing starts**, each written in the square (`heat-state`), in the legend, and in the accessible fallback table — colour is never the only reading (`STAFFING_STATUS_TONES` reuses the staffing board's own colour names so the two screens agree). `staffingStatusFor` uses the server's stated `fillState` as it stands and only falls back to the staffing service's zero/some/none rule for a day the server sent figures for but no state.

**Accessible table/text fallback.** A "Show the written list" toggle (`aria-expanded`/`aria-controls`, with an explicit CSS rule so the `hidden` attribute wins over the grid display) reveals the same days as a second table with Day / State / Required / Allocated / Unfilled / Courses columns, built from the same day objects as the squares "so the two can never drift apart". Both tables carry captions, `scope`d headers, a keyboard-focusable scroll container (`tabIndex="0"` with `aria-label`), and a visually-hidden detail sentence per day.

**Budget gauge.** `buildBudgetPanel` renders the period position as one bar plus a sentence. The bar is drawn only when it is honestly readable: a budget that exists and is greater than zero, a spend that could be priced, and a remaining figure that could be worked out (`gaugeable`). Over-budget handling caps the bar at full (`Math.min(1, spend / budget)`) while the true percentage is written beside it, so "a period well past its budget says so rather than reading as exactly full" (a tested case renders "127% of budget used" with `aria-valuenow` 100). A budget of zero is **not divided by at all** — it is "No budget set", a distinct state from "Spend cannot be worked out", which is what unpriced money produces: `budgetStatusFor` returns `UNKNOWN` whenever `spend` or `remaining` is null, and `null` "never stands for zero". Courses with work but no hourly rate are counted as `unpricedCourses` and excluded from every money total, with an explicit note saying so, and the server withholds `remaining` entirely when a budgeted course has no rate ("the answer would otherwise be short by whatever that course went on to spend"). The server-side counterparts are `sumMoney` (null when nothing could be priced) and `remainingOf` in the command centre service. The bar is an ARIA `meter` (`aria-valuemin/max/now/valuetext`); the workload bars are decoration and `aria-hidden`.

**Workload view.** `buildWorkloadPanel` lists the tutors carrying allocated or approved hours, in the report's order, with allocated/approved hours, the report's own share figure, and capacity: what is left is the two server figures subtracted ("never a fresh guess about capacity"), rendered as `capacityLeft = capacityHours − allocatedHours` with three written notes (capacity left / all allocated / over capacity), plus an idle-tutor count. Each row links to the tutor screen (`/organiser/tutors/:id`). Tutors with no stated capacity are shown with "what is left cannot be worked out" rather than a guess.

**Fairness wording.** The share of allocated hours is presented as exactly what it is: the panel ends with "The share is the report's own figure for how the period's allocated hours are spread. It is indicative only, not a target or a fair-share rule." Nothing on the screen marks a tutor as fairly or unfairly loaded.

**NaN/Infinity prevention.** Every ratio on the screen is guarded: the budget fraction and percentage are computed only when `gaugeable`; a zero-or-missing budget is never a divisor; `formatHours`/`formatPercent` return `--` for non-finite values; the workload fraction is null when `capacityHours` is null or `<= 0` and is capped at 1 otherwise; the server rounds every sum to two decimals and uses `null` for unknown money rather than a computed zero.

## S3-M6-3: Needs Attention feed + quick actions

**The feed.** `frontend/src/features/attentionFeed.js` builds one structured item per underlying issue from the summary plus Member 1's notification store, and `CommandCentre.jsx` renders it with a filter per category and a total badge. The five categories (with their filter labels) are:

| Category | Items | Priority |
| --- | --- | --- |
| Shortages | each open requirement with `shortageHours > 0` (worst shortage first, ties by id; an `unfilled` requirement is Urgent, a partially-filled one Soon); plus one aggregate card for posted overflow work with no student claims | critical / warning |
| Approvals | volunteer claims waiting for a decision; excuses waiting for a decision | warning / info |
| Timesheets | submitted timesheets waiting for approval; open disputes | warning |
| Tutor capacity | tutors at, over, or near their stated capacity (see the fix below) | warning / info |
| Budget | each course the server figures put over budget (`budgetRemaining < 0`); one card when the period budget is spent to the cent | critical / warning |

**Quick actions are links, not decisions.** Every card carries a category and urgency in words as well as colour, and its only action is a link to the screen that already handles the issue. Nothing here decides an approval, fills a shortage or re-checks a permission — "the destination screen keeps responsibility for permission, state and the decision itself". The volunteer/overflow action opens `/organiser/overflow`, excuse/approval and timesheet/dispute actions open `/organiser/approvals`, shortage cards open `/organiser/staffing`, budget cards open the reports or the named course, and capacity cards open the named tutor. `RoleRouter.test.jsx` verifies that clicking an attention card lands on a screen that re-reads its own data on entry.

**Reuse of Member 1 notifications, with no duplicate alert storage.** Waiting-time context comes from Member 1's reminder store, reused read-only: the screen calls `fetchAllNotifications({ status: 'all' })` alongside the summary and folds `TIMESHEET_REVIEW_DUE`, `VOLUNTEER_CLAIM_DUE` and `EXCUSE_REVIEW_DUE` rows into the matching queue card ("A review reminder has already been raised for N of them."). Reminders repeat daily, so distinct target IDs are counted, keeping one underlying issue one card; the overdue count is clamped to the queue length because a reminder can outlive its item. A reminder never becomes a card of its own and nothing is written back — no second alert store exists.

**Stable IDs, deterministic ordering, de-duplication.** Every item's id is `category:entity:id` (e.g. `shortage:requirement:12`, `tutor-capacity:tutor:7`) — never an array index — so React keys and deep links stay stable across refreshes. Items are collected into a `Map` keyed by id, so a duplicate requirement row, a repeated reminder or a repeated tutor row collapses to one card. Priority per kind never varies with the data, so the same state always produces the same order (critical, then warning, then info; within a priority, the order the figures were read in).

**Stale-target rejection, forbidden routes, role safety.** `resolveAttentionTarget` is the only place an item becomes a route, and it refuses anything it cannot vouch for, rendering the card with "No longer in the current data." instead of a link: malformed items, unknown kinds, entity IDs that are missing or not positive integers, **stale targets** (an entity absent from the IDs the latest read knows, checked against `knownCourseIds`/`knownTutorIds` passed from the current summary), and **forbidden routes** (anything outside `ATTENTION_ROUTE_ALLOWLIST` — the eight organiser screens — plus the two detail patterns `/organiser/courses/\d+` and `/organiser/tutors/\d+`). The allowlist is defence in depth; the real gate is the role guard the destination route already carries, which a link never bypasses. The mapper tests cover every refusal reason, including routes another role owns and screens that do not exist.

**Filters and empty states.** Filter buttons (All plus one per category, each with its count, `aria-pressed`) show one category at a time from the same single feed; the empty state is `role="status"` and names the category ("Nothing needs attention in Budget for this period."). When the reminder read itself fails, the feed keeps standing on the counts alone and says so under the feed ("Waiting times come from the reminder read, which could not be completed, so a queue may be more urgent than it looks.") — the summary owns every figure, so a secondary read failure cannot blank the screen.

## Previously identified gaps and how they were fixed

Two gaps were found while reviewing the Member 6 work against S3-M6-3. Both were fixed on this branch before completion.

### Near-capacity Tutor fix

**The original gap.** The first version of the feed (commit `40159c5`) surfaced a tutor only once their allocated hours had *reached or passed* the stated capacity, on the argument that "no near-capacity threshold exists anywhere in the application, so none is invented here". That did not satisfy S3-M6-3's near-capacity warning: a tutor at 95% of capacity — exactly the tutor an organiser should not allocate more work to — produced no card until the moment they hit 100%.

**The existing documented rule.** A near-capacity rule already existed and was already user-visible: `getTutorWorkloads` in `src/services/allocation-queries.ts` states each tutor's `capacityStatus` in SQL — `not-set`, `limit-reached`, or **`near-limit` when `usedHours >= weeklyLimit * 0.8`** — and the tutor screens render it. The 80% share is that pre-existing rule, reused; it was not invented for this feed.

**The fix** (commit `a38e505`). The feed now judges the two period figures the workload report sends by that same share, via `NEAR_CAPACITY_SHARE = 0.8` in `attentionFeed.js`, with the source documented beside it: the report's `capacityHours` are the same weekly limit measured over the period's weeks, so the same share of the two period figures is the same rule. The feed now distinguishes:

- **below 80%** — not on the feed; the workload panel already shows how full the tutor is;
- **80% to under 100%** — "…is near the capacity stated for the period", priority info, with a `nearCapacitySentence` that states the hours, what is left, and the rule itself ("The application marks a tutor as near their limit once 80% of the stated capacity is allocated.") so the judgement can be checked rather than taken on trust;
- **at 100% or over** — "has no capacity left for the period" (exactly at) or "is over the capacity stated for the period" (past it), priority warning, with the hours and the overrun.

Tutors with no stated capacity still cannot be judged and stay on the workload panel rather than being guessed at. Stable IDs (`tutor-capacity:tutor:<id>`) and the tutor deep link were unchanged, and a duplicated tutor row still collapses to one card.

**Tests added.** `attentionFeed.test.js`: "surfaces a tutor at the application's own near-limit share of the stated capacity" (32 of 40 h — exactly 80%, with the duplicate-row collapse), "leaves a tutor below the near-limit share to the workload panel" (31 of 40 h — 77.5%), "leaves tutors with no stated capacity to the workload panel rather than guessing", plus the at/over-capacity cases. `CommandCentre.test.jsx`: "takes a tutor near the capacity stated for them to the tutor screen as well", asserting the on-screen 80% wording and the deep link.

### Notification pagination fix

**The original limitation.** The feed's first version (commit `40159c5`) read the reminder context from a single call to `fetchNotifications({ status: 'all' })` — one page of at most 25 rows, the same screenful the notification bell pages through. Because reminders are folded into queue cards, a due reminder that did not sit on page one was simply omitted: a queue that had already waited long enough for a reminder could look less urgent than it was, and the earliest-waiting item is exactly the one unlikely to be on the first page.

**The intermediate limit.** Commit `a38e505` introduced `fetchAllNotifications` in `frontend/src/api/notifications.js`, which walks the same paginated read one page at a time — but bounded it with `MAX_NOTIFICATION_PAGES = 40`. At the endpoint's 25-row page size that is a 1,000-row ceiling, so a reminder on row 1,001 or later could still be missed.

**The final behaviour** (commit `2c1381c`). The 40-page constant was removed. The walk is now bounded by the backend-reported `total` alone: `lastPage = Math.ceil(first.total / pageSize)` is fixed from page one's response before the walk starts, and the loop also stops when the rows read reach that total. Three safety behaviours remain: a page that comes back empty ends the walk early; a later page claiming a larger total cannot stretch it (tested); and a page past the endpoint's own page maximum is refused by the server — the existing `/api/notifications` validation of **page 1–10,000 and pageSize 1–25, else `400 VALIDATION_ERROR`** — which rejects the whole read. A failed page rejects the read rather than returning half the store, and `CommandCentre.jsx` already degrades gracefully: the reminder read runs `Promise.all`-parallel to the summary with a `.catch(() => null)`, so the queue cards keep standing on the counts alone and the feed says the reminder read could not be completed.

**The test proving the ceiling is gone.** `notifications.test.js` → "reads past a thousand rows, so a reminder on the last page is still surfaced": a mocked store of 1,001 rows is walked in 41 page reads, and the `TIMESHEET_REVIEW_DUE` reminder at id 1001 (targetId 901) on the final page is returned. Companion tests cover the multi-page walk (51 rows, 3 reads), the single-read case, the total-based stop against a later inflated total, and the reject-on-failed-page behaviour.

## Implementation history

All five Member 6 commits were made on 25 September 2026 on `s3/m6/completion`, directly on top of `main`. Every commit message carries the project's AI-assistance trailer.

| Commit | Time | What it added |
| --- | --- | --- |
| `6b1108a` | 17:47 | The Command Centre end to end: backend aggregate service, route, wiring, `fillStateFor` export, and the frontend screen with period controls, KPI cards, heatmap, budget and workload panels, routing and API client (15 files, +3,526/−1). |
| `a002fa7` | 18:45 | Verbal staffing states and the budget gauge: the written-state heatmap with legend and written-list fallback, the meter bar with its over-budget/zero-budget/unknown handling, the fairness wording, and the course/tutor detail routes with deep-link handling on the existing Course/Tutor screens (11 files, +1,156/−84). |
| `40159c5` | 19:56 | The Needs Attention feed: `attentionFeed.js` with categories, priorities, stable IDs, the deep-link mapper, filters and empty states, and the first reminder read (single page) (8 files, +1,750/−229). |
| `a38e505` | 20:35 | The audit fixes: near-capacity tutors at the application's own 80% share, and `fetchAllNotifications` walking all pages (with the then-40-page cap) (7 files, +337/−34). |
| `2c1381c` | 20:56 | Removal of the 40-page/1,000-row cap so the walk is bounded by the backend-reported total (2 files, +54/−18). |

Per change:

1. **Backend aggregate service/route** (`6b1108a`): added `src/services/command-centre-service.ts` (readers-only composition, period scoping, day bucketing, money null-semantics), the `GET /api/organiser/command-centre` route in `src/app.ts` with the reports' period validation and organiser role requirement, the `CommandCentreSummary`/`CommandCentreStaffingDay` contract types, and the `src/server.ts` wiring over the five existing services. No new business logic: every figure is an existing service's figure, summed. Tests: `command-centre-service.test.ts` (15) and `command-centre-routes.test.ts` (12). Risk: additive only; the optional dependency means unwired environments answer 503.
2. **`fillStateFor` export** (`6b1108a`): the one touch to an existing backend file — visibility plus a doc comment, no behaviour change. The staffing requirement service's own 43 tests still pass.
3. **Frontend model/view-model** (`6b1108a`, `a002fa7`): `commandCentreModel.js` arranges server figures (KPIs, heatmap weeks, budget panel, workload panel, empty-period test) and owns no business maths. Tests: 43 in `commandCentreModel.test.js`.
4. **KPI and period controls** (`6b1108a`): six KPI cards with drill-down links; Monday-snapping date picker, week stepping, 1/4/12-week lengths, Refresh. Tested in `CommandCentre.test.jsx` (33 tests) including Monday snapping, retry, and empty-period behaviour.
5. **Heatmap** (`6b1108a`, `a002fa7`): server-summed days rendered as weeks × weekdays with written states, legend, and the written-list fallback table.
6. **Budget visualisation** (`a002fa7`): sentence + status badge + ARIA meter with over-budget capping, zero-budget and unpriced-money states.
7. **Workload/fairness visualisation** (`a002fa7`): tutor rows with allocated/approved/share/capacity and remaining capacity, idle count, indicative-only fairness note.
8. **Course/Tutor deep links** (`a002fa7`): detail routes reuse the existing CourseManagement/TutorManagement screens; each opens the named entity's edit form/details once (`deepLinkOpened` ref), so cancelling leaves it cancelled; `RoleRouter.jsx` gained the two routes. No new data reads — the screens use their existing lists.
9. **Needs Attention feed** (`40159c5`): as documented under S3-M6-3. Tests: 37 in `attentionFeed.test.js` across nine describe blocks (builder, shortages, queues/waiting time, tutor capacity, budgets, empty states, duplicate sources, deep-link mapper, filters).
10. **Notification aggregation/pagination** (`a38e505`, `2c1381c`): `fetchAllNotifications` in `frontend/src/api/notifications.js`; 15 tests in `notifications.test.js` including the 1,001-row walk.
11. **Near-capacity Tutor fix** (`a38e505`): as documented above.
12. **Supporting routing/CSS/test-harness changes**: `RoleRouter.jsx` navigation link and routes (tests in `RoleRouter.test.jsx`, 32 tests in the file); `App.css` additions for the KPI grid, heatmap, gauge, attention cards, the written-list `hidden` rule, the visually-hidden utility reuse and the 640px responsive rules; API contract tests in `organiser.test.js` ("Member 6 command centre contract": one-call summary, day-with-no-requirements acceptance, refusal of a missing panel and of a non-number figure).
13. **Later cleanup** (`2c1381c`): the pagination cap removal — a pure refactor of the walk bound, covered by updating/adding the notifications tests.

## Existing Sprint 3 functionality reused

| Existing service/data | How Member 6 reuses it |
| --- | --- |
| `staffingRequirementService.listStaffingRequirements` (Member 2) | Read with `{ status: "OPEN" }`, then period-scoped by start instant in the command centre service; the requirement rows feed the staffing KPIs, the heatmap day buckets and the shortage items, with the service's own `requiredHours`/`shortageHours`/`shortageTutors`/`fillState` figures used as they stand. |
| `fillStateFor` (Member 2 staffing service) | Exported and reused verbatim to state a day's fill from the day's totals, so a day is described "in exactly the same words as a single one". |
| `reportingService.workloadReport` (Member 2) | The same `WorkloadReportQuery`; the course rows are the finance panel, the tutor rows the workload panel, and the report's `budgetRemaining`/`hourlyRate` figures drive the over-budget and unpriced states. |
| `getTutorWorkloads` near-limit rule (Member 2, `allocation-queries.ts`) | The documented 80% share (`usedHours >= weeklyLimit * 0.8` → `near-limit`) is the rule the feed reuses for tutor-capacity items over the period figures. |
| `organiserService.listApprovals` (Member 2/5) | Queue lengths for pending timesheets, volunteer claims and excuses; `actions.total` is their sum plus open disputes. |
| `timesheetCorrectionsService.listDisputes` (Member 3/5) | Open dispute count, read for the asking organiser via the token subject passed through the route. |
| `organiserOverflowService.listOverflowWork` (Member 4) | Open items, open hours and the service's own `pendingClaims` counts for the unclaimed-work KPI and attention item. |
| Notification service `GET /api/notifications` (Member 1) | `fetchAllNotifications({ status: 'all' })` provides the reminder/waiting-time context folded into queue cards; read-only, no new alert storage. |
| Auth middleware `authenticate`/`resolveProfileRole`/`requireRole` (Members 1/5) | Route protection for the aggregate endpoint; verified token subject passed to the service. |
| `parseWorkloadReportQuery` and the reports period contract (Member 2) | Identical `weekStart`/`weeks` validation for the Command Centre, so both screens measure identical weeks. |
| `ProtectedRoute`/`RoleRouter` and the existing organiser screens (Members 1–4) | Every drill-down and quick action is a link to an existing screen; the course/tutor detail routes reuse the existing Course/Tutor screens. |
| `scheduleWeek` helpers (`localMonday`, `weekRangeLabel`, `addDays`) | The period controls' Monday arithmetic and labels. |

## API / contract details

All examples require `Authorization: Bearer <access-token>`.

```http
GET /api/organiser/command-centre?weekStart=2030-09-02&weeks=4
```

- **Method/path:** `GET /api/organiser/command-centre`.
- **Authentication/role:** bearer token required; any authenticated Tutor Mx profile resolves; **organiser only**. Missing/invalid token → `401`; tutor or student profile → `403 FORBIDDEN` (verified in `command-centre-routes.test.ts`).
- **Query parameters:** `weekStart` (required, a Monday as `YYYY-MM-DD`) and `weeks` (optional positive integer, default 1, maximum 52). Invalid periods → `400 VALIDATION_ERROR` with the message "Choose a week starting on a Monday and a length of 1 to 52 weeks."; the summary dependency is not called.
- **Success (200):** `{ "data": { period, staffing, finance, workload, actions, overflow } }` where
  - `period = { weekStart, weekEnd, weeks }` with `weekEnd` exclusive;
  - `staffing = { requiredHours, assignedHours, unfilledHours, openRequirements, unfilledRequirements, requirements: StaffingRequirementSummary[], days: CommandCentreStaffingDay[] }` — every day of the period, zeros and `fillState: null` when nothing starts on it;
  - `finance = { budget, spend, committed, remaining, overBudgetCourses, unpricedCourses, courses: CourseReportRow[] }` — the money fields are `number | null`, and `null` means "cannot be worked out", never zero;
  - `workload = { tutors: TutorReportRow[] }`;
  - `actions = { pendingTimesheets, pendingVolunteerClaims, pendingExcuses, openDisputes, total }`;
  - `overflow = { openItems, openHours, unclaimedItems }`.
- **Errors:** `503 COMMAND_CENTRE_UNAVAILABLE` when the aggregate is not wired; a panel reader's own safe error passes through unchanged (e.g. `503 REPORTING_UNAVAILABLE`); unexpected failures become `500 INTERNAL_ERROR` with the established sanitised envelope — the route test asserts a thrown "private connection detail" is not leaked.
- **Safety:** the service is read-only and composed of existing readers; the dispute read is scoped to the verified token subject, so the response is never influenced by client-supplied identity.

Existing contracts Member 6 relies on, unchanged:

```http
GET /api/notifications?status=all&page=1&pageSize=25
```

- Any authenticated role for its own notifications; `page` 1–10,000 and `pageSize` 1–25, else `400 VALIDATION_ERROR`. This server-side maximum is the only bound on the all-pages walk; the walk itself terminates on the reported `total`.

```http
GET /api/reports/workload?weekStart=2030-09-02&weeks=4
```

- Organiser only; the same Monday/1–52-week period contract the Command Centre reuses; at most 5,000 course and 5,000 tutor rows (`422 RESULT_LIMIT_EXCEEDED` beyond), which therefore also bound the Command Centre's panels.

## Verification evidence

Commands actually run locally on 25 September 2026 (Windows, Node/npm workspaces at the repository root and `frontend/`):

| Check | Command | Result |
| --- | --- | --- |
| Focused backend Member 6 tests | `npx vitest run src/services/command-centre-service.test.ts src/command-centre-routes.test.ts` | 2 files, **27 tests passed** (15 service, 12 route) |
| Backend suite | `npx vitest run` | 41 files, **1,110 tests passed** (~201 s) |
| Frontend suite | `npx vitest --run` (in `frontend/`) | 53 files, **672 tests passed** (~151 s) |
| Backend typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Backend lint | `npx eslint "src/**/*.ts"` | exit 0, clean |
| Frontend lint | `npx eslint .` (in `frontend/`) | 0 errors; 1 pre-existing warning (see below) |
| Backend coverage | `npx vitest run --coverage` | thresholds met; All files: **92.44% statements, 86.22% branches, 94.83% functions, 93.20% lines** (configured thresholds 90/85/83/90). `command-centre-service.ts` is at 100% on all four measures |
| Frontend coverage | `npx vitest --run --coverage` (in `frontend/`) | All files: 86.79% statements, 83.47% branches, 89.66% functions, 89.08% lines (informational — the frontend configures no thresholds). Member 6 modules: `attentionFeed.js` 100/92.66/100/100, `commandCentreModel.js` 97.34/95.8/100/97.05, `CommandCentre.jsx` 87.09/80.41/92.5/90.69, `RoleRouter.jsx` 100/95/100/100 |
| Backend build | `npx tsc -p tsconfig.build.json` | exit 0 |
| Frontend build | `npx vite build` (in `frontend/`) | exit 0; the long-standing chunk-size advisory remains (691.02 kB minified bundle) |
| Repository security check | `node scripts/check-repository.mjs` | passed: "Tracked-file secret and AI-attribution checks passed" |

Focused frontend Member 6 files within the passing suite: `CommandCentre.test.jsx` (33 tests), `commandCentreModel.test.js` (43), `attentionFeed.test.js` (37) and `notifications.test.js` (15) — 128 tests across the four files — plus the Member 6 command-centre contract block in `organiser.test.js` and the command-centre routing cases in `RoleRouter.test.jsx`.

**Flaky/pre-existing behaviour, stated honestly.** No flakiness was observed in this session: every suite above passed on its first attempt, including the full backend and frontend runs and both coverage runs (the backend coverage suite was executed twice, both green). No isolation-versus-full-suite discrepancy arose. Two non-blocking notices are pre-existing and unrelated to Member 6: the unused `eslint-disable` directive warning at `frontend/src/features/TutorAllocationDetails.jsx:69` (that file is untouched by Member 6) and the Vite bundle-size advisory. The deployed cross-role smoke (`npm run security:smoke`, `scripts/security-smoke.ts`) was **not** run: it requires `SMOKE_BASE_URL` and three persona access tokens against a deployed environment, and its probe list predates Member 6 — it does not include the command-centre endpoint. The local, mock-based `src/security-smoke.test.ts` (part of the 1,110) also does not probe the command centre; that endpoint's 401/403 behaviour is covered by `command-centre-routes.test.ts` instead.

## Regression audit

- **Members 1–5 services:** the full backend suite includes and passes the suites for notifications (15 + 22 tests across the two files), search (20 + 5), staffing requirements (43), reporting (`reporting-service.ts` at 100% coverage), organiser service (54), overflow (40), timesheet corrections (46), timesheet workflows (30), excuse workflows (23), allocation queries (40), timetable import (43), payroll export (11), Member 5 workflow routes (57), the Member 5 contract suite (44), hardening (19) and the schema/database suites.
- **Existing organiser pages:** the frontend suite passes OrganiserDashboard, OrganiserApprovals, OrganiserReports, OrganiserOverflow, StaffingRequirements, BulkAllocation, CourseManagement and TutorManagement tests, including the deep-link additions to the last two.
- **Notifications:** the notification API tests (15) and the notification bell/store suites pass; `fetchAllNotifications` is additive and leaves the existing `fetchNotifications` untouched.
- **Staffing/report/workload behaviour:** the only change to an existing backend service file is the `fillStateFor` export (visibility + comment); its 43 tests pass. The reporting service is untouched by Member 6.
- **Routing/role guards:** `RoleRouter.test.jsx` (32 tests) covers the command centre opening for an organiser, being withheld from a tutor, navigation link presence, and the destination screen re-reading its own data when an attention card is clicked.
- **Conclusion:** no Member 6 regression is known — supported by the full green suites above. Pre-existing warnings left untouched are listed in the verification section. Nothing unrelated was modified.

## Accessibility and UX

- **Written heatmap state labels:** each square carries its state in words (`Fully staffed`, `Partly staffed`, `Unstaffed`, `Not being filled`, `Nothing starts`), as does the legend; the same words appear in the fallback table.
- **Accessible fallback table:** the written list repeats every day with work on it in a real `<table>` with caption, scoped headers and course links, behind an `aria-expanded`/`aria-controls` toggle; an explicit `.heatmap-written[hidden]` rule keeps the `hidden` attribute effective against the grid display.
- **ARIA attributes:** KPI cards are `<article>` labelled by their `<h3>` ids; the budget bar is `role="meter"` with `aria-valuemin/max/now/valuetext` and a labelled percentage; the workload bars are `aria-hidden` decoration; the filter group is `role="group"` with `aria-pressed` buttons; the feed's empty state is `role="status"`; each heatmap cell carries a visually-hidden detail sentence; the table scroll containers are focusable (`tabIndex="0"`, `aria-label`).
- **Non-colour-only status:** states, budget positions, and feed urgency (`Urgent` / `Soon` / `For information`) are written in text in addition to colour; the budget position is also a full sentence.
- **Keyboard operability:** all controls are native buttons, selects, a date input and links; the written-list toggle and filters are buttons with state exposed to assistive technology; focusable scroll regions make the wide heatmap reachable by keyboard.
- **Responsive behaviour:** the KPI grid is `auto-fit`/`minmax`, the budget and workload panels share a grid that collapses, and a 640px breakpoint stacks the metric list and aligns attention items; the heatmap table scrolls horizontally inside its card rather than overflowing the page. This is verified in CSS and jsdom tests only — **no live browser or screen-reader testing was performed for Member 6** (unlike Member 5, no screenshot evidence exists under `docs/evidence/`).

## Git / branch integrity

- **Current branch:** `s3/m6/completion`, up to date with `origin/s3/m6/command-centre-attention`.
- **Current HEAD:** `2c1381c` (`refactor(notifications): remove max page limit in fetchAllNotifications`).
- **Member 6 commits:** `6b1108a` → `a002fa7` → `40159c5` → `a38e505` → `2c1381c`, all 25 September 2026, each a direct child of the previous, in that order. `git log main..HEAD` is exactly these five commits and nothing else; the cumulative diff against `main` is 23 files, +6,470/−13.
- **Relationship of the three implementation stages:** stage one (`6b1108a`) delivered S3-M6-1's summary, KPIs and drill-downs together with the first heatmap/budget/workload panels; stage two (`a002fa7`) completed S3-M6-2's verbal states, gauge semantics and the course/tutor deep links; stage three (`40159c5`, then the two audit fixes `a38e505`/`2c1381c`) delivered S3-M6-3's feed and closed the near-capacity and pagination gaps. Each stage builds on the previous one — the feed reads the same summary the earlier stages introduced, and the fixes amend the feed in place.
- **Working tree:** clean (`git status` reports nothing to commit; `coverage/`, `dist/`, `frontend/dist/` and `frontend/coverage/` are gitignored, so the local verification runs left no tracked-file changes).
- **`main`:** still at `af5b950` (the Member 5 integration merge). `main` was not modified, and nothing has been committed, merged, rebased or pushed from this session.

The final branch therefore contains the complete cumulative Member 6 implementation, including both audit fixes, and nothing from any other stream of work.

## Remaining limitations and boundaries

### Functional/interpretive limitations

- **Queue counts are current-state, not period-scoped.** The staffing, finance and workload panels are measured over the selected weeks, but the approval, dispute and overflow counts are what is waiting *now* (`listApprovals` reads `SUBMITTED`/`PENDING` states; `listDisputes` reads `OPEN`). The screen says the panels are for the selected weeks; the queues are live regardless of the chosen period.
- **Drill-downs do not carry the selected period.** Every KPI/feed link opens its destination screen without the chosen `weekStart`/`weeks`; the destination asks its own question with its own defaults. Only the course/tutor detail links carry an entity id.
- **Scope of organiser-visible returned timesheets.** The feed's Timesheets category covers submitted timesheets waiting for review (with reminder context) and open disputes. Timesheets in `RETURNED` status are the tutor's action to resubmit, and the only reminder type for them (`TIMESHEET_RESUBMIT_DUE`) is addressed to the tutor, so no organiser-facing reminder source exists for them and the feed creates no card for them rather than inventing one.
- **Unclaimed overflow is one aggregate card**, not one item per posting; the overflow screen remains the place to see individual postings.
- **Period lengths in the UI are 1, 4 and 12 weeks** (matching the reports screen); the server accepts any 1–52-week period, which other API clients may use.

### Technical limitations

- **The 80% near-limit share is duplicated.** `NEAR_CAPACITY_SHARE = 0.8` in `frontend/src/features/attentionFeed.js` restates the `0.8` in the `getTutorWorkloads` SQL in `src/services/allocation-queries.ts`. The comment cross-references the source, but a change to the server rule would still need a matching frontend change; there is no shared constant across the boundary.
- **Deep links open the named entity once per screen mount.** The `deepLinkOpened` ref means navigating to a second course/tutor id without remounting the screen will not auto-open the new entity, and the destination screens do not carry the command centre's period context.
- **The notification walk's remaining bound is the server's page maximum.** A filtered store larger than 250,000 rows (10,000 pages × 25 rows) cannot be walked in one read; the server refuses the page and the read fails, degrading the feed to counts-only. The walk is also sequential — one page per request — by design, since it reuses the bell's paginated read.
- **The aggregate makes five parallel reads per request with no caching.** Every Refresh re-reads staffing, reports, approvals, overflow and disputes; there is no cross-request memoisation.

### Pre-existing issues (demonstrably unrelated to Member 6)

- The unused `eslint-disable` warning at `frontend/src/features/TutorAllocationDetails.jsx:69` (file untouched by Member 6).
- The Vite production-bundle chunk-size advisory (691.02 kB > 500 kB).
- CI runs the backend suite with test parallelism disabled and an increased hook timeout (pre-existing from the Sprint 3 Member 2 CI fix).

### Not verified

- **Live PostgreSQL/Neon integration** — the command centre service tests exercise the composition with reader fakes; no live database was queried for this document. (The suite's PGlite-backed suites cover the underlying services the aggregate composes.)
- **Live browser testing** — no Chromium/Playwright rendering of the Command Centre was performed; the evidence is jsdom tests and the CSS as written. No screenshots exist.
- **Remote CI** — neither the GitHub Actions nor the Gitea workflows were run from this session.
- **Production deployment** — nothing was deployed to Render or anywhere else.
- **The deployed cross-role security smoke** — not run (requires `SMOKE_BASE_URL` and persona tokens); it also does not yet probe `/api/organiser/command-centre`.
- **Performance measurement** — the `measure-s3-m5.ts` benchmark was not run and no timing claims are made for the aggregate endpoint beyond the suite durations above.

## Final completion matrix

| Story | Status | Evidence |
| --- | --- | --- |
| S3-M6-1 — Live Command Centre summary + drill-downs | Complete | `GET /api/organiser/command-centre` over five existing readers (`command-centre-service.ts`, `app.ts`, `server.ts`); period contract with Monday/1–52-week validation; six KPI cards with drill-down links; loading/empty/error/retry states; 27 focused backend tests plus `CommandCentre.test.jsx` and the `organiser.test.js` contract block, all green within the 1,110 backend / 672 frontend passing suites. |
| S3-M6-2 — Shortage heatmap + budget/workload/fairness visualisations | Complete | Server-summed `staffing.days` with the staffing service's own fill states; written-state squares, legend and written-list fallback; budget gauge with over-budget/zero-budget/unpriced/unknown handling and guarded ratios; workload panel with remaining capacity and indicative-only fairness wording; tested in `commandCentreModel.test.js` (43) and `CommandCentre.test.jsx` (33). |
| S3-M6-3 — Needs Attention feed + quick actions | Complete | Five categories with filters and empty states; stable `category:entity:id` identities, deterministic priorities, Map-based de-duplication; deep-link mapper refusing malformed/unknown/stale/forbidden targets; reminder context reused from Member 1's store with no duplicate alert storage and graceful degradation; both audit gaps (near-capacity tutors at the application's own 80% rule; notification pagination past the former 1,000-row ceiling) fixed and tested — 37 tests in `attentionFeed.test.js` plus 15 in `notifications.test.js`, including the 1,001-row reminder walk. |

## Handoff statement

Member 6's implementation is complete and documented on `s3/m6/completion` (HEAD `2c1381c`), which carries the whole cumulative Command Centre work — the three user stories and both audit fixes — and nothing else. Local verification proves, for the code as it stands on this branch: 1,110 backend and 672 frontend tests pass, including 27 focused backend and 128 focused frontend Member 6 tests; strict TypeScript, both linters, both production builds and the repository security check are clean; and the backend coverage thresholds are met with the new service at 100%. What that evidence cannot prove — live PostgreSQL behaviour of the aggregate, a real browser session, remote CI, or any deployment — remains the Integration Lead's responsibility, as does merging this branch into `main`, running the deployed cross-role smoke (which should be extended with a command-centre probe), and any production migration or release gate. This document is evidence of the implementation state of the repository, not a claim of production deployment or remote CI success.

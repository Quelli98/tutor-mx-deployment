# Sprint 4 Members 1–4 — updated source

This delivery adds Member 4 to the previous Members 1–3 project. Start here; the earlier delivery guides and evidence are retained for history.

## What was added

- Students can submit a reason against their own eligible tutoring booking and see Pending, Approved or Rejected with the Organiser's review note.
- Organiser Approvals includes a Student sick-note queue with approve/reject confirmation, required rejection notes, pagination and history.
- Approval before the booking starts marks it EXCUSED and releases busy time. Approval at or after the start marks it SKIPPED and retains it on the timetable. Rejection leaves it scheduled.
- Pending requests pause cancellation. Version checks, transactions and database guards prevent competing actions from producing contradictory results or duplicate notifications.
- Private reasons/review notes are available only to the Student and Organisers. Tutors receive attendance status, not medical reasons. No document upload is added.
- Timetables have a labelled list alternative. Student, Tutor and Organiser shells have Compact mode with the same data and actions. Dialog focus recovery and conflict messages are improved.

## Install the update

Use your approved main after Member 3 integration, on `s4/m4/completion`. This ZIP continues the supplied source snapshot; preserve any newer team changes and your local credentials. The Member 4 file list is in `docs/sprint4-member4-changed-files.md`.

```powershell
git switch main
git pull --ff-only
git switch -c s4/m4/completion
```

Copy/merge the source into that checkout, preserving `.git`, `.env` and `frontend/.env`. From the project root:

```powershell
npm ci
npm ci --prefix frontend
npm run generate
npm run db:migrate
npm run check
npm run dev
```

Use the intended development database for `DATABASE_URL`. Do not reset an existing database to install this update. Apply `20261010000000_s4_student_sick_notes` before deploying the updated backend and frontend. All preceding migrations are included. No new runtime dependency or environment variable is required.

## Try the feature

1. Student: My timetable → Booking details → enter a reason → Submit sick note → confirm.
2. Organiser: Approvals → Student sick notes → enter a review note → approve or reject → confirm.
3. Student: refresh booking details to see the decision and note. An approved future booking is retained in history but removed from active busy time.
4. Tutor: refresh My timetable to see attendance changes without the private reason.
5. Use Compact mode in the top bar and Show schedule as a list in the timetable.

## Verification and remaining environment checks

The complete backend suite passed (1,361 tests), as did the full frontend suite (827 tests). The last conflict-recovery change has a separate passing targeted run, including one additional test; the delivered frontend contains 828 tests. Typecheck, lint, both production builds and the repository security check passed. Backend coverage exceeds all configured thresholds.

Real-browser races, screenshots and live Auth0/Neon checks remain unverified: Chromium was unavailable and its attempted download failed. A runnable browser audit and exact fixture instructions are included in `docs/sprint4-member4-browser-checks.md`. Do not mark those acceptance checks complete until they pass in your configured test environment.

See `docs/sprint4-member4-handoff.md` for APIs, rules and acceptance mapping. No remote push, main merge, live migration or deployment was performed.

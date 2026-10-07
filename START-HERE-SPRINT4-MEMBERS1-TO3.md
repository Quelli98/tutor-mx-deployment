# Sprint 4 Members 1–3 — updated source

This is the complete Tutor MX project with Members 1 and 2 preserved and all three Member 3 implementation cards added. Use this guide instead of the older delivery guides.

## Added for Member 3

- **Tutor swaps:** choose one of your future confirmed allocations, see eligible replacement Tutors and before/after calendar/hour projections, then send a request. The replacement accepts or declines. An Organiser approves or rejects after checking the current allocation, mark, timetable, bookings and weekly capacity. Requesters can cancel pending/accepted requests. Every decision remains in history.
- **Student bookings:** Find a tutoring time now has **Book this time** and a confirmation dialog. The server checks mutual availability again inside the transaction. Confirmed bookings appear on both participants' My timetable and block later booking/allocation clashes.
- **Booking details and cancellation:** both participants can see their own booking list, details and history. Either can cancel a scheduled appointment before its start. Cancellation changes status, keeps history, frees the interval and notifies both people. Stale actions refresh the latest state.
- **Notifications:** de-duplicated booking and swap events link to fresh, permission-checked details, including when the destination screen is already open.

The screens use the existing Tutor/Student/Organiser shells, calendar, cards, buttons and confirmation dialog. Student bookings are scheduling-only appointments; they do not create payroll allocations.

## Apply to your repository

This delivery continues the supplied source snapshot. It is not a verified snapshot of a newer remote main. Keep your credentials/environment files and any newer team changes when integrating.

1. Start from your clean, approved main after Member 2 is merged, then create the Member 3 branch:

```powershell
git switch main
git pull --ff-only
git switch -c s4/m3/completion
```

2. Copy this project into that checkout, keeping your `.git`, `.env` and `frontend/.env`. If your team has changed the source since the previous delivery, merge the files listed in `docs/sprint4-member3-changed-files.md` rather than replacing newer work wholesale.
3. From the project root, run:

```powershell
npm ci
npm ci --prefix frontend
npm run generate
npm run db:migrate
npm run check
npm run dev
```

Set `DATABASE_URL` to the intended development database before migrating. Do not reset or reseed an existing database to install this update. No new packages or environment variables are required for Member 3.

The new migration is `20261009000000_s4_swaps_bookings`. It adds TutoringBooking, TutorSwap, BookingEvent, SwapEvent, notification types and scheduling concurrency guards. If you have not installed the preceding deliveries, the earlier Member 1 and 2 migrations are included and Prisma applies them in order.

## Where to find the features

| Account | Screen | Try this |
| --- | --- | --- |
| Student | Find a tutoring time | Choose a Tutor/course and term, search, select Book this time, confirm |
| Student or Tutor | My timetable | Open booking details/history; cancel a future booking; change the displayed week |
| Tutor | Tutor swaps | Request a replacement for your future confirmed allocation; accept/decline invitations addressed to you |
| Organiser / Master Organiser | Tutor swaps | Review accepted requests, before/after hours and history; approve/reject |

For a swap demonstration, use two eligible Tutors with course marks and sufficient selected-week capacity, plus an Organiser account. For bookings, use a Student, eligible Tutor and published term with a shared free time.

`docs/sprint4-member3-handoff.md` maps the handbook cards to code/tests and explains rules, APIs, concurrency and Member 4's extension point. Test evidence is in `docs/evidence/s4-m3/`.

No live migration, deployment, remote push or main merge was performed. Your Integration Lead can review this branch and its evidence, then merge before Member 4 starts. Deploy in migration → backend → frontend order and complete the configured-environment browser checks in the handoff.

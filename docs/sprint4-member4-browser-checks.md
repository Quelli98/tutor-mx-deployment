# Member 4 configured browser checks

Status: **not executed here**. Chromium was absent; the attempted installation failed (see `evidence/s4-m4/browser-install.txt`). The script has been syntax checked. Unit/component tests do not substitute for this rendered, multi-session audit.

Use a dedicated test deployment and synthetic people/data. The race checks change their test bookings, requests and overflow claim. Keep session files outside the repository and ZIP. No credentials are bundled.

## Run the supplied audit

Install Playwright separately for the audit if it is not already available:

```powershell
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

Use Playwright codegen to sign in normally as each account and save storage state into private paths, for example:

```powershell
npx playwright codegen --save-storage=C:/private/student.json https://YOUR-TEST-FRONTEND
```

Repeat for Student 2, Tutor and Organiser (optionally a second Organiser). The app uses Auth0 local-storage caching; these files are credentials. Use fresh sessions and do not commit/upload them.

Create a private JSON config:

```json
{
  "baseURL": "https://YOUR-TEST-FRONTEND",
  "states": {
    "student": "C:/private/student.json",
    "student2": "C:/private/student2.json",
    "tutor": "C:/private/tutor.json",
    "organiser": "C:/private/organiser.json"
  },
  "fixtures": {
    "bookingId": 101,
    "pendingSickNoteId": 201,
    "overflowClaimId": 301,
    "overflowCourseCode": "S4RACE",
    "availability": {
      "courseId": 1,
      "tutorId": 3,
      "termId": 1,
      "startsAtLocal": "2030-09-02T13:00",
      "endsAtLocal": "2030-09-02T14:00",
      "durationMinutes": 60
    }
  }
}
```

Replace every example ID/date with current fixture values. Availability must be future, inside the next 180 days and a published term, inside the default 08:00–18:00 search hours, and free for both Students and the Tutor. Use an exact one-session interval so both searches find precisely one result. This time must differ from the two bookings below.

- `bookingId`: a separate future CONFIRMED/SCHEDULED booking owned by Student and Tutor, without a sick note.
- `pendingSickNoteId`: a pending request on another booking, visible on page 1 of both Organiser queues.
- `overflowClaimId`: a pending request from Student for OPEN overflow work, visible in the Organiser approvals queue. Use a unique course code among that Student's pending claims.
- Populate a scenario and dense staffing/proposal data to make the responsive screenshots meaningful. Use long synthetic names/reasons to exercise wrapping.

Run:

```powershell
node scripts/sprint4-browser-audit.mjs C:/private/s4-browser-config.json
```

The runner opens independent browser contexts and checks competing booking confirmations, Student report versus Tutor cancellation, two sick-note decisions and overflow approval versus withdrawal. Each race requires one successful mutation and one 409 conflict. It also checks viewport overflow/action bounds and captures screenshots at 360, 768 and 1440px in both density modes. Results go to `docs/evidence/s4-m4/browser/`; failure exits nonzero. Refresh the fixtures before rerunning because successful race outcomes are terminal.

## Finish the manual review

1. Check persisted rows, BookingEvent history and notification counts after each race: one legal outcome and one event per committed version, no duplicate recipient notification. Check that private reasons never appear in Tutor payloads or notifications.
2. Repeat approval just before start and at/after start: Excused releases the interval; Skipped stays in the timetable; rejection preserves the schedule and displays its review note.
3. Tab through booking/search, sick-note form, Organiser queue and both dialogs. Confirm Escape cancellation, Tab/Shift+Tab trapping, focus recovery when the trigger disappears, and screen-reader status/conflict announcements.
4. Toggle the timetable list and Command Centre written heatmap table. Compare the values against the visuals. Compare scenario/proposal tables and compact mode without losing actions.
5. Review screenshots at each width with long names/reasons. Wide data tables may scroll inside their labelled local region; the entire page should not scroll horizontally. Inspect primary actions, mobile navigation and 200% text zoom.
6. Record browser/version, build SHA, test account roles (without secrets), results and screenshots. Run remote CI and the normal live health/readiness checks before deployment sign-off.

# Student volunteer and sick-note demonstration (Slides 19–20)

The current Tutor MX code already implements the workflow. This update adds
clear navigation guidance from the Student workspace to the existing booking
sick-note screen; it does **not** add a new endpoint, change stored records,
or bypass any security check.

## Prepare an authorised demo Student account

1. Sign in as Student and open `/student`. The existing **Available volunteer work**
   section lists OPEN opportunities supplied by the backend. The **My volunteer
   requests** section shows that Student's persisted request statuses.
2. If no open work appears, ask the Organiser to create a safe test volunteer
   opportunity using the existing Organiser workflow. Do not fabricate a claim
   or promise that the account will have any particular status.
3. To demonstrate a request, select an OPEN work item, click **Volunteer** and
   confirm. Check **My volunteer requests** for the resulting Pending status.
   Existing Approved/Rejected records may also be shown, if present.
4. To demonstrate sick notes, use the new **Open my timetable and bookings**
   link, or go directly to `/student/timetable`. Open a real eligible booking's
   **Booking details**, then find **Student sick notes**. Submit a note only on
   an authorised demo booking; otherwise explain the form without submitting.
5. With an Organiser account signed into a separate browser profile, open
   `/organiser/approvals` and find **Student sick notes**. Pending requests can
   be approved or rejected there, subject to permissions and current state.

## Important distinctions

- Volunteer requests are not student bookings and do not create a sick note.
- A sick note belongs to one of the Student's tutoring bookings. If no booking
  exists, the Student cannot demonstrate submitting a booking sick note.
- Submitting a sick note does not approve it; an Organiser reviews it.
- A request may be rejected or unavailable if its state has already changed.
- This patch is a navigation/discoverability improvement, not a claim that
  every demo account already has test data.

## Regression checks

- Student page still loads volunteer opportunities and persisted requests.
- The new link opens the existing Student timetable route.
- Booking details still show existing sick notes and any eligible submission form.
- Organiser `/organiser/approvals` still contains the sick-note queue.
- Run all project lint, unit, coverage, build, migration and security checks
  before updating `origin/main`; verify Gitea CI jobs afterward.

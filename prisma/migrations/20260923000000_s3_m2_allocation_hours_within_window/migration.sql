-- Sprint 3 Member 2: allocated hours must fit inside the session they belong to.
--
-- allocatedHours is typed by hand on the allocation board and was only checked
-- against 0 and 24, so a 10:00-12:00 booking could record 20 hours. Both the
-- weekly capacity check and the staffing shortage add these hours up, so a wrong
-- value quietly corrupts a tutor's remaining capacity and a course's shortage.
--
-- Less than the window stays allowed: a tutor may do two hours of work inside a
-- four-hour block. More than the window is now impossible.
--
-- This sits beside the existing "Allocation_hours_range" rather than replacing
-- it: that one caps a single session at 24 hours however long the window is.
ALTER TABLE "Allocation"
  ADD CONSTRAINT "Allocation_hours_within_window"
  CHECK (
    "allocatedHours" > 0
    AND "allocatedHours" <= EXTRACT(EPOCH FROM ("endsAt" - "startsAt")) / 3600
  );

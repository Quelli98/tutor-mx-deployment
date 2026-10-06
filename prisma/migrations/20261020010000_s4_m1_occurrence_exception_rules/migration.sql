-- Sprint 4 Member 1: Tutors and Students can now skip or move a single
-- occurrence of a repeating timetable entry ("set recurring exceptions" in the
-- project brief). OccurrenceException existed since the shared-timetable
-- migration and is already read by the clash checks and the calendar; this
-- adds the rules the new write path relies on.

-- One exception per occurrence: changing the same week again replaces the
-- earlier change rather than leaving two contradicting rows. Nothing wrote this
-- table before, but keep the newest row should a duplicate exist.
DELETE FROM "OccurrenceException" older
  USING "OccurrenceException" newer
  WHERE older."timeSlotId" = newer."timeSlotId"
    AND older."occurrenceDate" = newer."occurrenceDate"
    AND older."id" < newer."id";

CREATE UNIQUE INDEX "OccurrenceException_timeSlotId_occurrenceDate_key"
  ON "OccurrenceException"("timeSlotId", "occurrenceDate");

-- A skipped week carries no times; a moved week carries a valid new range.
-- NOT VALID applies the rule to every new or changed row without failing the
-- deploy on any hand-made row that predates it.
ALTER TABLE "OccurrenceException"
  ADD CONSTRAINT "OccurrenceException_shape_check" CHECK (
    ("exceptionType" = 'CANCELLED' AND "newStartsAt" IS NULL AND "newEndsAt" IS NULL)
    OR ("exceptionType" = 'MOVED' AND "newStartsAt" IS NOT NULL AND "newEndsAt" IS NOT NULL
        AND "newEndsAt" > "newStartsAt")
  ) NOT VALID;

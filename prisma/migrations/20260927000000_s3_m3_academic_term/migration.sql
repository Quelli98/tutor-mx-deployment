-- Sprint 3 Member 3 (S3-M3-1): academic terms bound recurring schedule imports.
--
-- Purpose. The timetable import repeats a weekly row until a repeat-until date.
-- Without a term to stop at, a mistyped or absent repeat-until would create an
-- open-ended weekly block that silently suppresses allocation forever. A term
-- gives the import one authoritative end date.
--
-- Scope. This table is read-only reference data for the schedule. It does not
-- touch, replace or duplicate the existing "TimeSlot" table: an imported entry
-- is written as an ordinary "TimeSlot" row with its existing columns, which is
-- what keeps imported and hand-entered entries indistinguishable to the
-- allocation clash queries.
--
-- Dates are DATE, not TIMESTAMP, because a term boundary is a calendar day.
-- Storing it as an instant would make the boundary depend on the reader's
-- timezone and the last week of term could include or exclude a day depending
-- on where the reader is.

CREATE TABLE "AcademicTerm" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id"),
  -- A term must run forwards. A single-day term is allowed; a backwards one is
  -- always a data-entry mistake.
  CONSTRAINT "AcademicTerm_dates_ordered" CHECK ("endsOn" >= "startsOn"),
  -- A blank name would render as an unselectable option in the import form.
  CONSTRAINT "AcademicTerm_name_not_blank" CHECK (length(btrim("name")) > 0)
);

-- Callers pick a term by name in the import UI, and the API lists terms in
-- date order.
CREATE UNIQUE INDEX "AcademicTerm_name_key" ON "AcademicTerm"("name");

-- Shared timetable: categories, series, fortnightly recurrence, occurrence exceptions, enhanced terms.
-- All changes are additive and preserve existing data.

-- 1. Time slot category distinguishes CLASS (lectures/labs) from UNAVAILABLE (personal).
--    The existing BUSY type is preserved; category adds meaning on top.
ALTER TABLE "TimeSlot" ADD COLUMN IF NOT EXISTS "category" VARCHAR(32) NOT NULL DEFAULT 'UNAVAILABLE';

-- 2. Stable series identifier groups all occurrences of a recurring entry.
ALTER TABLE "TimeSlot" ADD COLUMN IF NOT EXISTS "seriesId" VARCHAR(36);

-- 3. Link timetable entries to the academic term they were imported against.
ALTER TABLE "TimeSlot" ADD COLUMN IF NOT EXISTS "termId" INTEGER;
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "TimeSlot_category_idx"
  ON "TimeSlot"("tutorId", "category", "startsAt");
CREATE INDEX IF NOT EXISTS "TimeSlot_seriesId_idx"
  ON "TimeSlot"("seriesId") WHERE "seriesId" IS NOT NULL;

-- 4. Occurrence exceptions: cancel or move individual occurrences of a recurring series.
CREATE TABLE IF NOT EXISTS "OccurrenceException" (
  "id" SERIAL PRIMARY KEY,
  "timeSlotId" INTEGER NOT NULL,
  "occurrenceDate" DATE NOT NULL,
  "exceptionType" VARCHAR(16) NOT NULL DEFAULT 'CANCELLED',
  "newStartsAt" TIMESTAMP,
  "newEndsAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  FOREIGN KEY ("timeSlotId") REFERENCES "TimeSlot"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "OccurrenceException_lookup_idx"
  ON "OccurrenceException"("timeSlotId", "occurrenceDate");

-- 5. Enhanced AcademicTerm: structured year/term, publishing, teaching breaks.
ALTER TABLE "AcademicTerm" ADD COLUMN IF NOT EXISTS "year" INTEGER;
ALTER TABLE "AcademicTerm" ADD COLUMN IF NOT EXISTS "termNumber" INTEGER;
ALTER TABLE "AcademicTerm" ADD COLUMN IF NOT EXISTS "published" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AcademicTerm" ADD COLUMN IF NOT EXISTS "teachingBreaks" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Unique on (year, termNumber) only when both are set, so legacy terms without them are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "AcademicTerm_year_termNumber_key"
  ON "AcademicTerm"("year", "termNumber")
  WHERE "year" IS NOT NULL AND "termNumber" IS NOT NULL;

-- The API and calendar support alternating-week entries. Extend the database
-- constraint as a new migration so already-applied migration checksums stay valid.
ALTER TABLE "TimeSlot"
  DROP CONSTRAINT "TimeSlot_recurrence_supported",
  ADD CONSTRAINT "TimeSlot_recurrence_supported"
    CHECK ("recurrence" IS NULL OR "recurrence" IN ('WEEKLY', 'FORTNIGHTLY', 'ONCE'));

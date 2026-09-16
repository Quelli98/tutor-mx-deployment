ALTER TABLE "TimeSlot"
  DROP CONSTRAINT "TimeSlot_recurrence_supported",
  ADD CONSTRAINT "TimeSlot_recurrence_supported"
    CHECK ("recurrence" IS NULL OR "recurrence" IN ('WEEKLY', 'ONCE'));

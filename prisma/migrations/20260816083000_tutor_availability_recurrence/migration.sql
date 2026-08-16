-- Sprint 1 Member 3: retain the agreed recurrence placeholder for tutor
-- availability while keeping the supported values intentionally narrow.

ALTER TABLE "TimeSlot"
  ADD COLUMN "recurrence" VARCHAR(32),
  ADD CONSTRAINT "TimeSlot_recurrence_supported"
    CHECK ("recurrence" IS NULL OR "recurrence" IN ('WEEKLY'));

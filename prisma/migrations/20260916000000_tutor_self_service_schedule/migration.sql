-- Tutor self-service schedule and capacity.
--
-- Add optional label and recurrenceUntil fields to TimeSlot to support
-- tutor-managed busy schedules with bounded recurrence. The label lets
-- tutors name their busy times (e.g., "Lecture", "Study group") and
-- recurrenceUntil bounds WEEKLY recurrence so clash detection can
-- determine the last occurrence.

ALTER TABLE "TimeSlot"
  ADD COLUMN "label" VARCHAR(255),
  ADD COLUMN "recurrenceUntil" TIMESTAMP;

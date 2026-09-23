-- Sprint 3 Member 2 (S3-M2-3): what a course may spend, and what an hour costs.
--
-- Every tutor is paid the same rate for a given course, so the rate belongs to
-- the course and never to a tutor record. Spend is worked out at read time as
-- approved worked hours times this rate; nothing is stored against an allocation.
--
-- Both are optional: courses set up before this migration have neither, and a
-- course without a rate reports its hours with no money figure at all, which is
-- honest, rather than a zero that reads as "free".
ALTER TABLE "Course"
  ADD COLUMN "hourlyRate" DECIMAL(8,2),
  ADD COLUMN "budget" DECIMAL(12,2);

-- A rate of zero would make every course look free; a negative budget is not a
-- budget. Unset stays allowed.
ALTER TABLE "Course"
  ADD CONSTRAINT "Course_hourlyRate_positive"
    CHECK ("hourlyRate" IS NULL OR "hourlyRate" > 0),
  ADD CONSTRAINT "Course_budget_not_negative"
    CHECK ("budget" IS NULL OR "budget" >= 0);

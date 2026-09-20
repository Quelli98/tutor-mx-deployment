-- Sprint 3 Member 2 (S3-M2-1): staffing demand is counted in tutors, not hours.
--
-- An organiser thinks "that lab runs all afternoon and I need two tutors on it",
-- not "that lab needs nine tutor-hours". Storing a total also allowed nonsense
-- that no constraint could catch, such as 900 hours against a two-hour window.
-- The total is now derived from the window and the tutor count, never stored.

-- 1. Add the new column as nullable so existing rows can be filled in first.
ALTER TABLE "StaffingRequirement" ADD COLUMN "tutorsNeeded" INTEGER;

-- 2. Convert existing demand: how many tutors would cover those hours across the
--    window, rounded up so no requirement is quietly reduced, and kept inside the
--    range the new constraint allows.
UPDATE "StaffingRequirement"
  SET "tutorsNeeded" = LEAST(
    20,
    GREATEST(
      1,
      CEIL(
        "requiredHours"
        / (EXTRACT(EPOCH FROM ("endsAt" - "startsAt")) / 3600)
      )::integer
    )
  );

-- 3. Now that every row has a value, make it required.
ALTER TABLE "StaffingRequirement" ALTER COLUMN "tutorsNeeded" SET NOT NULL;

-- A whole number of people, with an upper bound that a real session can staff.
ALTER TABLE "StaffingRequirement"
  ADD CONSTRAINT "StaffingRequirement_tutors_needed_range"
  CHECK ("tutorsNeeded" >= 1 AND "tutorsNeeded" <= 20);

-- 4. Remove the stored total. Its CHECK is dropped first so the intent is
--    explicit rather than relying on the column drop to take it along.
ALTER TABLE "StaffingRequirement"
  DROP CONSTRAINT "StaffingRequirement_hours_range";
ALTER TABLE "StaffingRequirement" DROP COLUMN "requiredHours";

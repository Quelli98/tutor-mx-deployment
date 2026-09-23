-- Sprint 3 Member 2 (S3-M2-1): staffing requirements record tutoring demand.
--
-- Demand only. A row says which course needs cover, over which window, and how
-- many hours are wanted; the status says whether the organiser still wants it
-- filled. Nothing here assigns work, and no existing table is modified.
-- Fill level is never stored: a shortage is calculated at read time as the
-- required hours minus the CONFIRMED allocated hours that overlap the window.

-- OPEN: still wanted. CLOSED: no longer being pursued. CANCELLED: withdrawn.
-- None of these mean "filled", which is always derived from hours.
CREATE TYPE "StaffingRequirementStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

CREATE TABLE "StaffingRequirement" (
  "id" SERIAL NOT NULL,
  "courseId" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "requiredHours" DECIMAL(5,2) NOT NULL,
  "status" "StaffingRequirementStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffingRequirement_pkey" PRIMARY KEY ("id"),
  -- The window must cover real time. Same half-open rule as
  -- "Allocation_valid_period", so a requirement can be compared with an
  -- allocation without a second definition of "overlaps".
  CONSTRAINT "StaffingRequirement_valid_period" CHECK ("endsAt" > "startsAt"),
  -- Demand must be a positive number of hours. The upper bound is the column's
  -- own maximum, because a requirement may cover a period longer than one
  -- session, unlike "Allocation_hours_range" which caps a single session at 24.
  CONSTRAINT "StaffingRequirement_hours_range"
    CHECK ("requiredHours" > 0 AND "requiredHours" <= 999.99),
  -- Notes are optional, but a blank string must not masquerade as a note.
  CONSTRAINT "StaffingRequirement_notes_not_blank"
    CHECK ("notes" IS NULL OR length(btrim("notes")) > 0)
);

-- Serves the shortage read path: requirements for one course, filtered by
-- status, in time order.
CREATE INDEX "StaffingRequirement_courseId_status_startsAt_idx"
  ON "StaffingRequirement"("courseId", "status", "startsAt");

-- Keeps the SET NULL below from scanning the table when a profile is deleted.
CREATE INDEX "StaffingRequirement_createdById_idx"
  ON "StaffingRequirement"("createdById");

-- Organiser role guard for the createdById reference, matching the guards that
-- keep every other role-bearing reference pointing at the right kind of profile.
CREATE FUNCTION "enforce_staffing_requirement_creator_role"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."createdById" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Profile"
    WHERE "id" = NEW."createdById" AND "role" = 'ORGANISER'
  ) THEN
    RAISE EXCEPTION 'createdById must reference an ORGANISER profile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StaffingRequirement_creator_role"
  BEFORE INSERT OR UPDATE OF "createdById" ON "StaffingRequirement"
  FOR EACH ROW EXECUTE FUNCTION "enforce_staffing_requirement_creator_role"();

-- RESTRICT matches "Allocation" and "OverflowWork": the database refuses to
-- orphan a requirement, and course deletion removes requirements explicitly in
-- src/services/course-service.ts.
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL matches "Allocation_reviewedById_fkey": deleting the organiser who
-- raised a requirement clears the author but keeps the demand record.
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sprint 2 Member 6: Allocation organiser audit trail for mutation tracking.
-- Records which organiser confirmed or cancelled an allocation so that
-- allocation create/edit/remove operations remain accountable.

-- 1. Add nullable columns before any constraints reference them.
ALTER TABLE "Allocation"
  ADD COLUMN "reviewedById" INTEGER,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- 2. Organiser role guard for the new reviewedById reference.
CREATE FUNCTION "enforce_allocation_reviewer_role"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."reviewedById" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Profile"
    WHERE "id" = NEW."reviewedById" AND "role" = 'ORGANISER'
  ) THEN
    RAISE EXCEPTION 'reviewedById must reference an ORGANISER profile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Allocation_reviewer_role"
  BEFORE INSERT OR UPDATE OF "reviewedById" ON "Allocation"
  FOR EACH ROW EXECUTE FUNCTION "enforce_allocation_reviewer_role"();

-- 3. Backfill existing confirmed allocations so the CHECK below succeeds.
UPDATE "Allocation"
  SET "reviewedById" = (
    SELECT "id" FROM "Profile"
    WHERE "auth0Id" = 'demo|organiser'
    LIMIT 1
  ),
  "reviewedAt" = "updatedAt"
  WHERE "status" = 'CONFIRMED' AND "reviewedById" IS NULL;

-- 4. CHECK constraint: non-PROPOSED allocations must record the organiser.
ALTER TABLE "Allocation"
  ADD CONSTRAINT "Allocation_reviewed_when_decided"
  CHECK ("status" = 'PROPOSED' OR "reviewedById" IS NOT NULL);

-- 5. Indexes for the new foreign key and common query patterns.
CREATE INDEX "Allocation_reviewedById_idx"
  ON "Allocation"("reviewedById");

-- 6. Foreign key to Profile with SET NULL so organiser deletion does not
--    block allocation history.
ALTER TABLE "Allocation"
  ADD CONSTRAINT "Allocation_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "Profile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

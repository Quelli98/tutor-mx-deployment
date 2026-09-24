--
-- Links overflow work back to the staffing requirement it was converted from,
-- so "Send to overflow" leaves an auditable trace instead of a copy. Additive
-- only: one nullable column, one unique index and one foreign key. Existing
-- rows keep a NULL source, and nothing else that references "OverflowWork"
-- changes.
--
-- Nullable because overflow posted by hand has no source requirement. UNIQUE
-- because one requirement converts into at most one overflow item, which also
-- gives two organisers clicking "Send to overflow" a database-level backstop.

ALTER TABLE "OverflowWork"
  ADD COLUMN IF NOT EXISTS "sourceRequirementId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "OverflowWork_sourceRequirementId_key"
  ON "OverflowWork"("sourceRequirementId");

-- RESTRICT matches "OverflowWork_courseId_fkey": the database refuses to orphan
-- the trace. Course deletion already removes overflow rows before staffing
-- requirements in src/services/course-service.ts, so the order stays valid.
ALTER TABLE "OverflowWork" ADD CONSTRAINT "OverflowWork_sourceRequirementId_fkey" FOREIGN KEY ("sourceRequirementId") REFERENCES "StaffingRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

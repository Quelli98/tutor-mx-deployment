--
-- Corrects the overflow shortage model to represent multiple tutor opportunities
-- per staffing requirement. A requirement for N tutors over a window creates up
-- to N separate overflow opportunities (one per tutor slot), each with hours <=
-- session length. This matches the real-world constraint that one student cannot
-- fill multiple tutor slots simultaneously.
--
-- The previous unique index on sourceRequirementId incorrectly forced all
-- shortage hours into a single overflow item, which could exceed the session
-- length and misrepresent the work as one large opportunity instead of N
-- separate ones.
--
-- Additive changes:
-- 1. Drop the incorrect unique constraint on sourceRequirementId
-- 2. Add slotIndex column (0-based tutor slot index, NULL for manual overflow)
-- 3. Add composite unique on (sourceRequirementId, slotIndex) for concurrency
-- 4. Existing rows get slotIndex = 0 (first slot), preserving the trace
--

-- Step 1: Drop the incorrect unique constraint
DROP INDEX IF EXISTS "OverflowWork_sourceRequirementId_key";

-- Step 2: Add slotIndex column (nullable for manual overflow, required for converted)
ALTER TABLE "OverflowWork"
  ADD COLUMN IF NOT EXISTS "slotIndex" INTEGER;

-- Step 3: Set slotIndex = 0 for existing converted rows (preserves trace)
UPDATE "OverflowWork"
  SET "slotIndex" = 0
  WHERE "sourceRequirementId" IS NOT NULL AND "slotIndex" IS NULL;

-- Step 4: Make slotIndex required when sourceRequirementId is set
-- We use a CHECK constraint instead of making the column NOT NULL because
-- manual overflow (sourceRequirementId IS NULL) should have slotIndex IS NULL.
ALTER TABLE "OverflowWork"
  ADD CONSTRAINT "OverflowWork_slotIndex_required_for_converted"
  CHECK (
    ("sourceRequirementId" IS NULL AND "slotIndex" IS NULL) OR
    ("sourceRequirementId" IS NOT NULL AND "slotIndex" IS NOT NULL)
  );

-- Step 5: Add composite unique for concurrency protection
-- Two organisers clicking "Send to overflow" for the same requirement and slot
-- will hit this constraint, giving database-level deduplication.
CREATE UNIQUE INDEX IF NOT EXISTS "OverflowWork_sourceRequirementId_slotIndex_key"
  ON "OverflowWork"("sourceRequirementId", "slotIndex")
  WHERE "sourceRequirementId" IS NOT NULL;

-- Step 6: Add index for efficient shortage queries
CREATE INDEX IF NOT EXISTS "OverflowWork_sourceRequirementId_status_key"
  ON "OverflowWork"("sourceRequirementId", "status")
  WHERE "sourceRequirementId" IS NOT NULL;

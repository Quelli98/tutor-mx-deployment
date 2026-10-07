-- One generic Profile owner; Prisma ownerId maps to the existing tutorId column.
-- No row IDs, timestamps, dedupe hashes or occurrence links are rewritten.
DROP TRIGGER "TimeSlot_tutor_role" ON "TimeSlot";
CREATE FUNCTION "enforce_schedule_owner_role"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Profile" WHERE "id" = NEW."tutorId" AND "role" IN ('TUTOR', 'STUDENT')) THEN
    RAISE EXCEPTION 'Schedule owner must reference a TUTOR or STUDENT profile' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TimeSlot_owner_role"
  BEFORE INSERT OR UPDATE OF "tutorId" ON "TimeSlot"
  FOR EACH ROW EXECUTE FUNCTION "enforce_schedule_owner_role"();
COMMENT ON COLUMN "TimeSlot"."tutorId" IS 'Generic Profile owner (Prisma ownerId); legacy SQL name retained for compatibility.';

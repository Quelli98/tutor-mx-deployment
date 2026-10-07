CREATE TYPE "SickOccurrenceStatus" AS ENUM ('EXCUSED', 'SKIPPED');
CREATE TYPE "AbsenceReason" AS ENUM ('SICK');
ALTER TABLE "Excuse"
  ADD COLUMN "occurrenceStatus" "SickOccurrenceStatus",
  ADD COLUMN "absenceReason" "AbsenceReason" NOT NULL DEFAULT 'SICK',
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" INTEGER REFERENCES "Profile"("id") ON DELETE SET NULL;
ALTER TABLE "TimeSlot" ADD COLUMN "dedupeKey" VARCHAR(64);
CREATE UNIQUE INDEX "TimeSlot_dedupeKey_key" ON "TimeSlot"("dedupeKey");
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_term_number" CHECK ("termNumber" IS NULL OR "termNumber" BETWEEN 1 AND 4);

UPDATE "Excuse" SET "reviewedAt" = "updatedAt" WHERE "status" <> 'PENDING';
-- Past approvals have no recorded attendance classification. Keep them visible.
UPDATE "Excuse" SET "occurrenceStatus" = 'SKIPPED' WHERE "status" = 'APPROVED';

CREATE OR REPLACE FUNCTION "enforce_excuse_transition"() RETURNS TRIGGER AS $$
DECLARE a "Allocation"%ROWTYPE;
BEGIN
  SELECT * INTO a FROM "Allocation" WHERE "id" = NEW."allocationId" AND "tutorId" = NEW."tutorId" FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' OR a."status" IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION 'excuses require a confirmed session owned by the tutor and start PENDING' USING ERRCODE = '23514';
    END IF;
    NEW."occurrenceStatus" := NULL;
    NEW."reviewedAt" := NULL;
  ELSIF NEW."status" <> OLD."status" THEN
    IF OLD."status" <> 'PENDING' OR NEW."status" NOT IN ('APPROVED','REJECTED') THEN
      RAISE EXCEPTION 'invalid excuse status transition' USING ERRCODE = '23514';
    END IF;
    NEW."reviewedAt" := COALESCE(NEW."reviewedAt", CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
    IF NEW."status" = 'APPROVED' THEN
      IF a."status" IS DISTINCT FROM 'CONFIRMED' THEN
        RAISE EXCEPTION 'only a confirmed session can be excused' USING ERRCODE = '23514';
      END IF;
      NEW."occurrenceStatus" := CASE
        WHEN (NEW."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Johannesburg')::date
           < (a."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Johannesburg')::date
           AND a."endsAt" > NEW."reviewedAt"
        THEN 'EXCUSED'::"SickOccurrenceStatus" ELSE 'SKIPPED'::"SickOccurrenceStatus" END;
    ELSE
      NEW."occurrenceStatus" := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER TABLE "Excuse" ADD CONSTRAINT "Excuse_attendance_state" CHECK (
  ("status" = 'APPROVED' AND "occurrenceStatus" IS NOT NULL AND "reviewedAt" IS NOT NULL)
  OR ("status" <> 'APPROVED' AND "occurrenceStatus" IS NULL)
);

CREATE OR REPLACE FUNCTION "enforce_work_log_rules"() RETURNS TRIGGER AS $$
DECLARE
  allocation_status "AllocationStatus";
  allocation_day DATE;
  sheet_week DATE;
  sheet_status "TimesheetStatus";
  allowed_hours DECIMAL(5,2);
  existing_hours DECIMAL(8,2);
BEGIN
  SELECT "status", ("startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Johannesburg')::date
    INTO allocation_status, allocation_day
    FROM "Allocation"
    WHERE "id" = NEW."allocationId" AND "tutorId" = NEW."tutorId" FOR UPDATE;

  IF EXISTS (SELECT 1 FROM "Excuse" WHERE "allocationId" = NEW."allocationId" AND "tutorId" = NEW."tutorId" AND "status" = 'APPROVED') THEN
    RAISE EXCEPTION 'approved sick sessions cannot have worked hours' USING ERRCODE = '23514';
  END IF;

  IF allocation_status IS NULL OR allocation_status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'work logs require a confirmed allocation owned by the tutor'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."workDate" <> allocation_day THEN
    RAISE EXCEPTION 'workDate must match the allocated session date'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."timesheetId" IS NOT NULL THEN
    SELECT "weekStart", "status"
      INTO sheet_week, sheet_status
      FROM "Timesheet"
      WHERE "id" = NEW."timesheetId" AND "tutorId" = NEW."tutorId";
    -- Allow updates to approvedHourlyRate even on approved timesheets, since
    -- this is a snapshot field set at approval time for audit reproducibility.
    -- Block the update only if a field other than approvedHourlyRate changed.
    IF sheet_status NOT IN ('DRAFT', 'RETURNED') AND (
      NEW."hours" IS DISTINCT FROM OLD."hours" OR
      NEW."workDate" IS DISTINCT FROM OLD."workDate" OR
      NEW."description" IS DISTINCT FROM OLD."description" OR
      NEW."allocationId" IS DISTINCT FROM OLD."allocationId" OR
      NEW."timesheetId" IS DISTINCT FROM OLD."timesheetId"
    ) THEN
      RAISE EXCEPTION 'work logs can only change on draft or returned timesheets'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."workDate" < sheet_week OR NEW."workDate" >= sheet_week + 7 THEN
      RAISE EXCEPTION 'workDate must fall inside the timesheet week'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT "weeklyHours" INTO allowed_hours
    FROM "TutorHourLimit" WHERE "tutorId" = NEW."tutorId";
  SELECT COALESCE(sum("hours"), 0) INTO existing_hours
    FROM "WorkLog"
    WHERE "tutorId" = NEW."tutorId"
      AND "workDate" >= date_trunc('week', NEW."workDate")::date
      AND "workDate" < date_trunc('week', NEW."workDate")::date + 7
      AND "id" <> COALESCE(NEW."id", -1);
  IF allowed_hours IS NULL OR existing_hours + NEW."hours" > allowed_hours THEN
    RAISE EXCEPTION 'weekly work log hours exceed the tutor limit'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Keep pre-existing work logs as evidence, but prevent submitting/paying sick work.
CREATE FUNCTION "prevent_sick_timesheet_submission"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IN ('SUBMITTED','APPROVED') AND NEW."status" <> OLD."status" AND EXISTS (
    SELECT 1 FROM "WorkLog" w JOIN "Excuse" e ON e."allocationId" = w."allocationId" AND e."tutorId" = w."tutorId"
    WHERE w."timesheetId" = NEW."id" AND e."status" = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'timesheet contains an approved sick session; review its existing work log' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Timesheet_sick_sessions" BEFORE UPDATE OF "status" ON "Timesheet"
FOR EACH ROW EXECUTE FUNCTION "prevent_sick_timesheet_submission"();

CREATE FUNCTION "preserve_excused_session_identity"() RETURNS TRIGGER AS $$
BEGIN
  IF (NEW."tutorId",NEW."courseId",NEW."startsAt",NEW."endsAt") IS DISTINCT FROM
     (OLD."tutorId",OLD."courseId",OLD."startsAt",OLD."endsAt")
     AND EXISTS (SELECT 1 FROM "Excuse" WHERE "allocationId" = OLD."id") THEN
    RAISE EXCEPTION 'a session with excuse history cannot be moved; create a separate allocation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Allocation_excuse_identity" BEFORE UPDATE ON "Allocation"
FOR EACH ROW EXECUTE FUNCTION "preserve_excused_session_identity"();

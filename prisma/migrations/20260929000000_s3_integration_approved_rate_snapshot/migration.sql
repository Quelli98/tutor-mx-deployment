-- Snapshot the course hourly rate on every work log whose timesheet is already
-- approved, so historical spend stays reproducible even if the rate changes.
-- Work logs on non-approved timesheets keep the column null; it is filled when
-- the timesheet is approved later.

ALTER TABLE "WorkLog"
  ADD COLUMN IF NOT EXISTS "approvedHourlyRate" DECIMAL(8, 2);

UPDATE "WorkLog" w
  SET "approvedHourlyRate" = c."hourlyRate"
  FROM "Allocation" a, "Course" c, "Timesheet" t
  WHERE a."id" = w."allocationId"
    AND c."id" = a."courseId"
    AND t."id" = w."timesheetId"
    AND t."status" = 'APPROVED'
    AND w."approvedHourlyRate" IS NULL;

-- Modify the work log trigger to allow updates to the approvedHourlyRate field
-- even on approved timesheets, since this is a snapshot set at approval time.
CREATE OR REPLACE FUNCTION "enforce_work_log_rules"() RETURNS TRIGGER AS $$
DECLARE
  allocation_status "AllocationStatus";
  allocation_day DATE;
  sheet_week DATE;
  sheet_status "TimesheetStatus";
  allowed_hours DECIMAL(5,2);
  existing_hours DECIMAL(8,2);
BEGIN
  SELECT "status", "startsAt"::date
    INTO allocation_status, allocation_day
    FROM "Allocation"
    WHERE "id" = NEW."allocationId" AND "tutorId" = NEW."tutorId";

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

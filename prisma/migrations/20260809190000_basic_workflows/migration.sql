-- Sprint 2 Member 6: Basic workflow schema, constraints and query indexes.

-- Complete the Sprint 1 value constraints before adding workflow tables.
ALTER TABLE "Profile"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "Profile_auth0Id_not_blank" CHECK (length(btrim("auth0Id")) > 0),
  ADD CONSTRAINT "Profile_email_not_blank" CHECK (length(btrim("email")) > 0),
  ADD CONSTRAINT "Profile_fullName_not_blank" CHECK (length(btrim("fullName")) > 0);

ALTER TABLE "Course"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "Course_code_not_blank" CHECK (length(btrim("code")) > 0),
  ADD CONSTRAINT "Course_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "TutorMark"
  ADD CONSTRAINT "TutorMark_mark_range" CHECK ("mark" >= 0 AND "mark" <= 100);

ALTER TABLE "TimeSlot"
  ADD CONSTRAINT "TimeSlot_valid_period" CHECK ("endsAt" > "startsAt");

ALTER TABLE "TutorHourLimit"
  ADD CONSTRAINT "TutorHourLimit_weeklyHours_range"
  CHECK ("weeklyHours" > 0 AND "weeklyHours" <= 168);

ALTER TABLE "Allocation"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "Allocation_valid_period" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "Allocation_hours_range"
  CHECK ("allocatedHours" > 0 AND "allocatedHours" <= 24),
  ADD CONSTRAINT "Allocation_id_tutorId_key" UNIQUE ("id", "tutorId");

CREATE INDEX "TutorMark_courseId_mark_idx"
  ON "TutorMark"("courseId", "mark");
CREATE INDEX "TimeSlot_tutorId_type_startsAt_endsAt_idx"
  ON "TimeSlot"("tutorId", "type", "startsAt", "endsAt");
CREATE INDEX "Allocation_tutorId_status_startsAt_endsAt_idx"
  ON "Allocation"("tutorId", "status", "startsAt", "endsAt");
CREATE INDEX "Allocation_courseId_status_startsAt_idx"
  ON "Allocation"("courseId", "status", "startsAt");

CREATE TYPE "TimesheetStatus" AS ENUM (
  'DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED'
);
CREATE TYPE "ExcuseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "OverflowWorkStatus" AS ENUM (
  'OPEN', 'FILLED', 'CLOSED', 'CANCELLED'
);
CREATE TYPE "VolunteerClaimStatus" AS ENUM (
  'PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'
);

CREATE TABLE "Timesheet" (
  "id" SERIAL NOT NULL,
  "tutorId" INTEGER NOT NULL,
  "weekStart" DATE NOT NULL,
  "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" INTEGER,
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Timesheet_week_starts_monday"
    CHECK (EXTRACT(ISODOW FROM "weekStart") = 1),
  CONSTRAINT "Timesheet_return_reason"
    CHECK ("status" <> 'RETURNED' OR length(btrim("reviewReason")) > 0)
);

CREATE TABLE "WorkLog" (
  "id" SERIAL NOT NULL,
  "tutorId" INTEGER NOT NULL,
  "allocationId" INTEGER NOT NULL,
  "timesheetId" INTEGER,
  "workDate" DATE NOT NULL,
  "hours" DECIMAL(5,2) NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkLog_hours_range" CHECK ("hours" > 0 AND "hours" <= 24),
  CONSTRAINT "WorkLog_description_not_blank"
    CHECK (length(btrim("description")) > 0)
);

CREATE TABLE "Excuse" (
  "id" SERIAL NOT NULL,
  "tutorId" INTEGER NOT NULL,
  "allocationId" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "ExcuseStatus" NOT NULL DEFAULT 'PENDING',
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Excuse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Excuse_reason_not_blank" CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "Excuse_rejection_reason"
    CHECK ("status" <> 'REJECTED' OR length(btrim("reviewReason")) > 0)
);

CREATE TABLE "OverflowWork" (
  "id" SERIAL NOT NULL,
  "courseId" INTEGER NOT NULL,
  "sourceAllocationId" INTEGER,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "hours" DECIMAL(5,2) NOT NULL,
  "status" "OverflowWorkStatus" NOT NULL DEFAULT 'OPEN',
  "closesAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OverflowWork_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OverflowWork_valid_period" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "OverflowWork_hours_range" CHECK ("hours" > 0 AND "hours" <= 24),
  CONSTRAINT "OverflowWork_close_before_start"
    CHECK ("closesAt" IS NULL OR "closesAt" <= "startsAt")
);

CREATE TABLE "VolunteerClaim" (
  "id" SERIAL NOT NULL,
  "overflowWorkId" INTEGER NOT NULL,
  "studentId" INTEGER NOT NULL,
  "status" "VolunteerClaimStatus" NOT NULL DEFAULT 'PENDING',
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VolunteerClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VolunteerClaim_rejection_reason"
    CHECK ("status" <> 'REJECTED' OR length(btrim("reviewReason")) > 0)
);

CREATE UNIQUE INDEX "Timesheet_tutorId_weekStart_key"
  ON "Timesheet"("tutorId", "weekStart");
CREATE UNIQUE INDEX "Timesheet_id_tutorId_key"
  ON "Timesheet"("id", "tutorId");
CREATE INDEX "Timesheet_status_submittedAt_idx"
  ON "Timesheet"("status", "submittedAt");
CREATE INDEX "Timesheet_tutorId_status_weekStart_idx"
  ON "Timesheet"("tutorId", "status", "weekStart");

CREATE UNIQUE INDEX "WorkLog_tutorId_allocationId_workDate_key"
  ON "WorkLog"("tutorId", "allocationId", "workDate");
CREATE INDEX "WorkLog_tutorId_workDate_idx"
  ON "WorkLog"("tutorId", "workDate");
CREATE INDEX "WorkLog_timesheetId_idx" ON "WorkLog"("timesheetId");

CREATE UNIQUE INDEX "Excuse_tutorId_allocationId_key"
  ON "Excuse"("tutorId", "allocationId");
CREATE INDEX "Excuse_status_createdAt_idx" ON "Excuse"("status", "createdAt");
CREATE INDEX "Excuse_tutorId_status_idx" ON "Excuse"("tutorId", "status");

CREATE UNIQUE INDEX "OverflowWork_sourceAllocationId_key"
  ON "OverflowWork"("sourceAllocationId");
CREATE INDEX "OverflowWork_status_startsAt_closesAt_idx"
  ON "OverflowWork"("status", "startsAt", "closesAt");
CREATE INDEX "OverflowWork_courseId_status_startsAt_idx"
  ON "OverflowWork"("courseId", "status", "startsAt");

CREATE UNIQUE INDEX "VolunteerClaim_overflowWorkId_studentId_key"
  ON "VolunteerClaim"("overflowWorkId", "studentId");
CREATE UNIQUE INDEX "VolunteerClaim_one_accepted_per_work_key"
  ON "VolunteerClaim"("overflowWorkId") WHERE "status" = 'ACCEPTED';
CREATE INDEX "VolunteerClaim_overflowWorkId_status_idx"
  ON "VolunteerClaim"("overflowWorkId", "status");
CREATE INDEX "VolunteerClaim_studentId_status_createdAt_idx"
  ON "VolunteerClaim"("studentId", "status", "createdAt");

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_tutorId_fkey"
    FOREIGN KEY ("tutorId") REFERENCES "Profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Timesheet_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "Profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkLog"
  ADD CONSTRAINT "WorkLog_tutorId_fkey"
    FOREIGN KEY ("tutorId") REFERENCES "Profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkLog_allocationId_tutorId_fkey"
    FOREIGN KEY ("allocationId", "tutorId")
    REFERENCES "Allocation"("id", "tutorId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkLog_timesheetId_tutorId_fkey"
    FOREIGN KEY ("timesheetId", "tutorId")
    REFERENCES "Timesheet"("id", "tutorId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Excuse"
  ADD CONSTRAINT "Excuse_tutorId_fkey"
    FOREIGN KEY ("tutorId") REFERENCES "Profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Excuse_allocationId_tutorId_fkey"
    FOREIGN KEY ("allocationId", "tutorId")
    REFERENCES "Allocation"("id", "tutorId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OverflowWork"
  ADD CONSTRAINT "OverflowWork_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OverflowWork_sourceAllocationId_fkey"
    FOREIGN KEY ("sourceAllocationId") REFERENCES "Allocation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VolunteerClaim"
  ADD CONSTRAINT "VolunteerClaim_overflowWorkId_fkey"
    FOREIGN KEY ("overflowWorkId") REFERENCES "OverflowWork"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "VolunteerClaim_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database role guards keep direct API/SQL writes from assigning workflow rows
-- to the wrong kind of profile.
CREATE FUNCTION "enforce_tutor_role"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Profile"
    WHERE "id" = NEW."tutorId" AND "role" = 'TUTOR'
  ) THEN
    RAISE EXCEPTION 'tutorId must reference a TUTOR profile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_student_role"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Profile"
    WHERE "id" = NEW."studentId" AND "role" = 'STUDENT'
  ) THEN
    RAISE EXCEPTION 'studentId must reference a STUDENT profile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_timesheet_reviewer_role"() RETURNS TRIGGER AS $$
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

CREATE TRIGGER "TutorMark_tutor_role"
  BEFORE INSERT OR UPDATE OF "tutorId" ON "TutorMark"
  FOR EACH ROW EXECUTE FUNCTION "enforce_tutor_role"();
CREATE TRIGGER "TimeSlot_tutor_role"
  BEFORE INSERT OR UPDATE OF "tutorId" ON "TimeSlot"
  FOR EACH ROW EXECUTE FUNCTION "enforce_tutor_role"();
CREATE TRIGGER "TutorHourLimit_tutor_role"
  BEFORE INSERT OR UPDATE OF "tutorId" ON "TutorHourLimit"
  FOR EACH ROW EXECUTE FUNCTION "enforce_tutor_role"();
CREATE TRIGGER "Allocation_tutor_role"
  BEFORE INSERT OR UPDATE OF "tutorId" ON "Allocation"
  FOR EACH ROW EXECUTE FUNCTION "enforce_tutor_role"();
CREATE TRIGGER "Timesheet_tutor_role"
  BEFORE INSERT OR UPDATE OF "tutorId" ON "Timesheet"
  FOR EACH ROW EXECUTE FUNCTION "enforce_tutor_role"();
CREATE TRIGGER "WorkLog_tutor_role"
  BEFORE INSERT OR UPDATE OF "tutorId" ON "WorkLog"
  FOR EACH ROW EXECUTE FUNCTION "enforce_tutor_role"();
CREATE TRIGGER "Excuse_tutor_role"
  BEFORE INSERT OR UPDATE OF "tutorId" ON "Excuse"
  FOR EACH ROW EXECUTE FUNCTION "enforce_tutor_role"();
CREATE TRIGGER "VolunteerClaim_student_role"
  BEFORE INSERT OR UPDATE OF "studentId" ON "VolunteerClaim"
  FOR EACH ROW EXECUTE FUNCTION "enforce_student_role"();
CREATE TRIGGER "Timesheet_reviewer_role"
  BEFORE INSERT OR UPDATE OF "reviewedById" ON "Timesheet"
  FOR EACH ROW EXECUTE FUNCTION "enforce_timesheet_reviewer_role"();

CREATE FUNCTION "enforce_allocation_transition"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'PROPOSED' THEN
    RAISE EXCEPTION 'allocations must start as PROPOSED' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."status" <> OLD."status" THEN
    IF OLD."status" = 'CANCELLED'
      OR (OLD."status" = 'CONFIRMED' AND NEW."status" <> 'CANCELLED') THEN
      RAISE EXCEPTION 'invalid allocation status transition: % -> %', OLD."status", NEW."status"
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Allocation_status_transition"
  BEFORE INSERT OR UPDATE OF "status" ON "Allocation"
  FOR EACH ROW EXECUTE FUNCTION "enforce_allocation_transition"();

CREATE FUNCTION "enforce_timesheet_transition"() RETURNS TRIGGER AS $$
DECLARE
  log_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'timesheets must start as DRAFT' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."status" <> OLD."status" THEN
    IF NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" = 'SUBMITTED')
      OR (OLD."status" = 'RETURNED' AND NEW."status" = 'SUBMITTED')
      OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'RETURNED'))
    ) THEN
      RAISE EXCEPTION 'invalid timesheet status transition: % -> %', OLD."status", NEW."status"
        USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'SUBMITTED' THEN
      SELECT count(*) INTO log_count FROM "WorkLog" WHERE "timesheetId" = NEW."id";
      IF log_count = 0 THEN
        RAISE EXCEPTION 'a timesheet must contain at least one work log before submission'
          USING ERRCODE = '23514';
      END IF;
      NEW."submittedAt" := COALESCE(NEW."submittedAt", CURRENT_TIMESTAMP);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Timesheet_status_transition"
  BEFORE INSERT OR UPDATE OF "status" ON "Timesheet"
  FOR EACH ROW EXECUTE FUNCTION "enforce_timesheet_transition"();

CREATE FUNCTION "enforce_work_log_rules"() RETURNS TRIGGER AS $$
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
    IF sheet_status NOT IN ('DRAFT', 'RETURNED') THEN
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

CREATE TRIGGER "WorkLog_rules"
  BEFORE INSERT OR UPDATE ON "WorkLog"
  FOR EACH ROW EXECUTE FUNCTION "enforce_work_log_rules"();

CREATE FUNCTION "enforce_excuse_transition"() RETURNS TRIGGER AS $$
DECLARE
  allocation_status "AllocationStatus";
  allocation_start TIMESTAMP(3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'excuses must start as PENDING' USING ERRCODE = '23514';
    END IF;
    SELECT "status", "startsAt" INTO allocation_status, allocation_start
      FROM "Allocation"
      WHERE "id" = NEW."allocationId" AND "tutorId" = NEW."tutorId";
    IF allocation_status <> 'CONFIRMED' OR allocation_start <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'excuses require a future confirmed allocation owned by the tutor'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" <> OLD."status" THEN
    IF OLD."status" <> 'PENDING' OR NEW."status" NOT IN ('APPROVED', 'REJECTED') THEN
      RAISE EXCEPTION 'invalid excuse status transition: % -> %', OLD."status", NEW."status"
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Excuse_status_transition"
  BEFORE INSERT OR UPDATE OF "status" ON "Excuse"
  FOR EACH ROW EXECUTE FUNCTION "enforce_excuse_transition"();

CREATE FUNCTION "enforce_overflow_work_rules"() RETURNS TRIGGER AS $$
DECLARE
  source_course INTEGER;
  source_start TIMESTAMP(3);
  source_end TIMESTAMP(3);
  source_hours DECIMAL(5,2);
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'OPEN' THEN
    RAISE EXCEPTION 'overflow work must start as OPEN' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."status" <> OLD."status" THEN
    IF OLD."status" <> 'OPEN' OR NEW."status" NOT IN ('FILLED', 'CLOSED', 'CANCELLED') THEN
      RAISE EXCEPTION 'invalid overflow work status transition: % -> %', OLD."status", NEW."status"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."sourceAllocationId" IS NOT NULL THEN
    SELECT "courseId", "startsAt", "endsAt", "allocatedHours"
      INTO source_course, source_start, source_end, source_hours
      FROM "Allocation" WHERE "id" = NEW."sourceAllocationId";
    IF source_course IS NULL OR source_course <> NEW."courseId"
      OR source_start <> NEW."startsAt" OR source_end <> NEW."endsAt"
      OR source_hours <> NEW."hours" THEN
      RAISE EXCEPTION 'overflow work must match its source allocation'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OverflowWork_rules"
  BEFORE INSERT OR UPDATE ON "OverflowWork"
  FOR EACH ROW EXECUTE FUNCTION "enforce_overflow_work_rules"();

CREATE FUNCTION "enforce_volunteer_claim_transition"() RETURNS TRIGGER AS $$
DECLARE
  work_status "OverflowWorkStatus";
  work_start TIMESTAMP(3);
  work_close TIMESTAMP(3);
BEGIN
  SELECT "status", "startsAt", "closesAt"
    INTO work_status, work_start, work_close
    FROM "OverflowWork" WHERE "id" = NEW."overflowWorkId" FOR UPDATE;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'volunteer claims must start as PENDING' USING ERRCODE = '23514';
    END IF;
    IF work_status <> 'OPEN' OR work_start <= CURRENT_TIMESTAMP
      OR (work_close IS NOT NULL AND work_close <= CURRENT_TIMESTAMP) THEN
      RAISE EXCEPTION 'volunteer claims require open future work'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" <> OLD."status" THEN
    IF OLD."status" <> 'PENDING'
      OR NEW."status" NOT IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN') THEN
      RAISE EXCEPTION 'invalid volunteer claim status transition: % -> %', OLD."status", NEW."status"
        USING ERRCODE = '23514';
    END IF;
    IF NEW."status" = 'ACCEPTED' AND work_status <> 'OPEN' THEN
      RAISE EXCEPTION 'accepted claims require work that is still OPEN'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "fill_overflow_work_after_accept"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" = 'ACCEPTED' AND OLD."status" <> 'ACCEPTED' THEN
    UPDATE "OverflowWork"
      SET "status" = 'FILLED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = NEW."overflowWorkId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VolunteerClaim_status_transition"
  BEFORE INSERT OR UPDATE OF "status" ON "VolunteerClaim"
  FOR EACH ROW EXECUTE FUNCTION "enforce_volunteer_claim_transition"();
CREATE TRIGGER "VolunteerClaim_fill_work"
  AFTER UPDATE OF "status" ON "VolunteerClaim"
  FOR EACH ROW EXECUTE FUNCTION "fill_overflow_work_after_accept"();

-- Sprint 3 Member 3 (S3-M3-2): returned-timesheet corrections, declarations and
-- disputes.
--
-- Purpose. A returned timesheet is the one place a tutor must be able to change
-- work they have already submitted. Until now that change was possible but left
-- no trace: the work log was updated in place and the organiser's return reason
-- was cleared on the next resubmission. This migration adds the history those
-- corrections need.
--
-- Scope. Nothing here replaces the existing Timesheet columns or the existing
-- transition trigger. "status", "submittedAt", "reviewedAt", "reviewedById" and
-- "reviewReason" keep their current meaning and their current consumers; the new
-- tables record what used to be lost. The editability rule itself is already
-- enforced by "enforce_work_log_rules", which refuses work-log changes on any
-- timesheet that is not DRAFT or RETURNED.
--
-- Three additions:
--   1. "TimesheetRevision" keeps the PRIOR hours and description of every
--      correction beside the new ones, plus the reason that prompted it. The
--      CHECK constraints make an incomplete correction unwritable, so the
--      history cannot be written as a bare overwrite.
--   2. "TimesheetDeclaration" stores who acknowledged which statement wording,
--      and when. Resubmitting a returned timesheet now requires a declaration
--      newer than both the return and the last correction, so the tutor always
--      declares the figures actually being submitted.
--   3. "TimesheetDispute" records a formal objection with its own lifecycle.

CREATE TYPE "TimesheetRevisionKind" AS ENUM ('RETURN', 'CORRECTION');
CREATE TYPE "TimesheetDisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- Appended rather than inserted so the stored enum order matches a plain
-- ALTER TYPE ... ADD VALUE, which cannot position a value inside a transaction.
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_DISPUTED';
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_DISPUTE_RESOLVED';

-- The declaration gate compares against "reviewedAt", so a returned timesheet
-- without one would make the comparison NULL and leave the sheet unsubmittable.
-- Every return path already sets it (organiser-service.decideTimesheet), and the
-- existing "Timesheet_return_reason" CHECK already requires a reason, so this
-- states the same invariant for the reviewer timestamps.
ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_returned_when_reviewed"
  CHECK ("status" <> 'RETURNED' OR "reviewedAt" IS NOT NULL);

CREATE TABLE "TimesheetRevision" (
  "id" SERIAL NOT NULL,
  "timesheetId" INTEGER NOT NULL,
  "tutorId" INTEGER NOT NULL,
  "kind" "TimesheetRevisionKind" NOT NULL,
  "workLogId" INTEGER,
  -- Nullable for the same reason as "Timesheet"."reviewedById": deleting the
  -- account that wrote a line of history clears who wrote it and keeps the
  -- history itself, which is the rule the deletion transaction already follows.
  "authorProfileId" INTEGER,
  "reason" TEXT,
  "previousHours" DECIMAL(5,2),
  "previousDescription" TEXT,
  "newHours" DECIMAL(5,2),
  "newDescription" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimesheetRevision_pkey" PRIMARY KEY ("id"),
  -- A correction that dropped the prior values would be the overwrite this
  -- table exists to prevent.
  CONSTRAINT "TimesheetRevision_correction_shape"
    CHECK (
      "kind" <> 'CORRECTION'
      OR (
        "workLogId" IS NOT NULL
        AND "previousHours" IS NOT NULL
        AND "newHours" IS NOT NULL
        AND "previousDescription" IS NOT NULL
        AND "newDescription" IS NOT NULL
      )
    ),
  -- A return without a reason is unusable to the tutor reading the timeline.
  CONSTRAINT "TimesheetRevision_return_reason"
    CHECK ("kind" <> 'RETURN' OR length(btrim("reason")) > 0)
);

CREATE INDEX "TimesheetRevision_timesheetId_createdAt_idx"
  ON "TimesheetRevision"("timesheetId", "createdAt");

CREATE TABLE "TimesheetDeclaration" (
  "id" SERIAL NOT NULL,
  "timesheetId" INTEGER NOT NULL,
  "tutorId" INTEGER NOT NULL,
  "statementVersion" VARCHAR(32) NOT NULL,
  "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimesheetDeclaration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimesheetDeclaration_timesheetId_declaredAt_idx"
  ON "TimesheetDeclaration"("timesheetId", "declaredAt");

CREATE TABLE "TimesheetDispute" (
  "id" SERIAL NOT NULL,
  "timesheetId" INTEGER NOT NULL,
  "tutorId" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "TimesheetDisputeStatus" NOT NULL DEFAULT 'OPEN',
  "raisedByProfileId" INTEGER NOT NULL,
  "resolvedByProfileId" INTEGER,
  "resolutionReason" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimesheetDispute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TimesheetDispute_reason" CHECK (length(btrim("reason")) > 0),
  -- A resolution has to name its decision and its moment, so a closed dispute is
  -- always explainable after the fact. The resolver's identity is deliberately
  -- not part of that rule: "resolvedByProfileId" is cleared when the organiser's
  -- account is deleted, exactly like a timesheet's "reviewedById", and blocking
  -- that deletion would leave an account unable to close itself.
  CONSTRAINT "TimesheetDispute_resolution"
    CHECK (
      "status" <> 'RESOLVED'
      OR (
        "resolvedAt" IS NOT NULL
        AND length(btrim("resolutionReason")) > 0
      )
    )
);

CREATE INDEX "TimesheetDispute_timesheetId_status_idx"
  ON "TimesheetDispute"("timesheetId", "status");
CREATE INDEX "TimesheetDispute_status_createdAt_idx"
  ON "TimesheetDispute"("status", "createdAt");
-- One live objection per timesheet, so a tutor cannot bury a decision under
-- repeated disputes. Resolved disputes stay behind as history.
CREATE UNIQUE INDEX "TimesheetDispute_one_open_per_sheet"
  ON "TimesheetDispute"("timesheetId") WHERE "status" = 'OPEN';

ALTER TABLE "TimesheetRevision"
  ADD CONSTRAINT "TimesheetRevision_timesheetId_tutorId_fkey"
    FOREIGN KEY ("timesheetId", "tutorId") REFERENCES "Timesheet"("id", "tutorId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TimesheetRevision_workLogId_fkey"
    FOREIGN KEY ("workLogId") REFERENCES "WorkLog"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TimesheetRevision_authorProfileId_fkey"
    FOREIGN KEY ("authorProfileId") REFERENCES "Profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimesheetDeclaration"
  ADD CONSTRAINT "TimesheetDeclaration_timesheetId_tutorId_fkey"
    FOREIGN KEY ("timesheetId", "tutorId") REFERENCES "Timesheet"("id", "tutorId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimesheetDispute"
  ADD CONSTRAINT "TimesheetDispute_timesheetId_tutorId_fkey"
    FOREIGN KEY ("timesheetId", "tutorId") REFERENCES "Timesheet"("id", "tutorId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TimesheetDispute_raisedByProfileId_fkey"
    FOREIGN KEY ("raisedByProfileId") REFERENCES "Profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TimesheetDispute_resolvedByProfileId_fkey"
    FOREIGN KEY ("resolvedByProfileId") REFERENCES "Profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Replaces the Sprint 2 body verbatim except for the declaration gate, which is
-- the only new rule. Keeping the rest identical means the transition rules,
-- the work-log requirement and the resubmission timestamp behaviour are
-- unchanged for every existing caller.
CREATE OR REPLACE FUNCTION "enforce_timesheet_transition"() RETURNS TRIGGER AS $$
DECLARE
  log_count INTEGER;
  declared BOOLEAN;
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

      -- Resubmission after a return is an assertion that the corrected figures
      -- are right. It must be covered by an acknowledgement newer than the
      -- return that asked for the changes AND newer than the last change the
      -- tutor made, otherwise a tutor could correct hours after declaring them
      -- and resubmit figures nobody vouched for. First submission
      -- (DRAFT -> SUBMITTED) is deliberately untouched: it is not a correction
      -- of anything, and gating it would change an existing contract.
      IF OLD."status" = 'RETURNED' THEN
        SELECT EXISTS (
          SELECT 1
          FROM "TimesheetDeclaration" d
          WHERE d."timesheetId" = NEW."id"
            AND d."declaredAt" > OLD."reviewedAt"
            AND d."declaredAt" > COALESCE(
              (
                SELECT max(r."createdAt")
                FROM "TimesheetRevision" r
                WHERE r."timesheetId" = NEW."id" AND r."kind" = 'CORRECTION'
              ),
              OLD."reviewedAt"
            )
        ) INTO declared;
        IF NOT declared THEN
          RAISE EXCEPTION 'a returned timesheet needs a declaration newer than the return and the last correction'
            USING ERRCODE = '23514';
        END IF;
      END IF;

      -- Stamp the (re)submission time. On DRAFT -> SUBMITTED the old value is
      -- NULL; on RETURNED -> SUBMITTED it still holds the previous submission,
      -- which must not be reused. Respect an explicit new value from the caller.
      IF NEW."submittedAt" IS NULL OR NEW."submittedAt" IS NOT DISTINCT FROM OLD."submittedAt" THEN
        NEW."submittedAt" := CURRENT_TIMESTAMP;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

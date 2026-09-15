-- Sprint 2 final stability corrections.
--
-- 1. Allocation reviewer integrity.
--    20260911000000 added CHECK ("status" = 'PROPOSED' OR "reviewedById" IS NOT
--    NULL) together with a foreign key that is ON DELETE SET NULL. Those two
--    rules contradict each other: deleting an organiser who reviewed a decided
--    allocation nulls "reviewedById" and immediately violates the CHECK, so the
--    deletion (and self-service account removal) fails. Re-express the audit
--    invariant against "reviewedAt", which the application always sets alongside
--    "reviewedById" and which is never nulled by the foreign key. The decision
--    timestamp still proves the allocation was reviewed even after the reviewer
--    profile is removed.
ALTER TABLE "Allocation"
  DROP CONSTRAINT "Allocation_reviewed_when_decided";

ALTER TABLE "Allocation"
  ADD CONSTRAINT "Allocation_reviewed_when_decided"
  CHECK ("status" = 'PROPOSED' OR "reviewedAt" IS NOT NULL);

-- 2. Returned-timesheet resubmission timestamp.
--    The original transition trigger used COALESCE(NEW."submittedAt", now()),
--    which keeps the ORIGINAL submission time when a RETURNED timesheet is
--    re-submitted (the row already carries a non-null "submittedAt"). The
--    organiser approval queue orders by "submittedAt", so re-submissions kept a
--    stale position and time. Refresh "submittedAt" whenever a timesheet enters
--    SUBMITTED, unless the caller supplied a genuinely new value.
CREATE OR REPLACE FUNCTION "enforce_timesheet_transition"() RETURNS TRIGGER AS $$
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

-- Sprint 3 Member 2: record why a staffing requirement stopped being filled.
--
-- Closing or cancelling a requirement that is still short overrides the
-- shortage the platform calculated, so the organiser must say why. The words are
-- kept with the requirement and cleared when it is reopened.
--
-- Null means no reason was needed or given: the requirement is open, it was
-- fully staffed when it was closed, or it closed itself when its session ended.
ALTER TABLE "StaffingRequirement" ADD COLUMN "statusReason" TEXT;

-- A blank string is not a reason.
ALTER TABLE "StaffingRequirement"
  ADD CONSTRAINT "StaffingRequirement_statusReason_not_blank"
  CHECK ("statusReason" IS NULL OR length(btrim("statusReason")) > 0);

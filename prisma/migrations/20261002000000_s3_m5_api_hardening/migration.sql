-- Import receipts are committed atomically with the imported rows. A failed
-- transaction leaves neither a receipt nor a partially imported timetable.
CREATE TABLE "ApiWriteReceipt" (
  "profileId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE CASCADE,
  "key" VARCHAR(128) NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("profileId", "key")
);
CREATE INDEX "Allocation_confirmed_window_idx" ON "Allocation" ("startsAt", "courseId", "tutorId") WHERE "status" = 'CONFIRMED';
CREATE INDEX "WorkLog_report_date_idx" ON "WorkLog" ("workDate", "timesheetId");

-- The review and its correction history are one critical write. A background
-- worker must never be the only place that preserves a returned-sheet reason.
CREATE FUNCTION "record_timesheet_return_revision"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'SUBMITTED' AND NEW."status" = 'RETURNED' THEN
    INSERT INTO "TimesheetRevision" (
      "timesheetId", "tutorId", "kind", "authorProfileId", "reason", "createdAt"
    ) VALUES (
      NEW."id", NEW."tutorId", 'RETURN', NEW."reviewedById", NEW."reviewReason", NEW."reviewedAt"
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "timesheet_return_revision_atomic"
AFTER UPDATE OF "status" ON "Timesheet"
FOR EACH ROW EXECUTE FUNCTION "record_timesheet_return_revision"();

-- Preserve the latest reason on pre-existing returned sheets if the old
-- best-effort history write failed. Existing history is left untouched.
INSERT INTO "TimesheetRevision" (
  "timesheetId", "tutorId", "kind", "authorProfileId", "reason", "createdAt"
)
SELECT t."id", t."tutorId", 'RETURN', t."reviewedById", t."reviewReason", t."reviewedAt"
FROM "Timesheet" t
WHERE t."status" = 'RETURNED' AND t."reviewedAt" IS NOT NULL
  AND length(btrim(t."reviewReason")) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "TimesheetRevision" r
    WHERE r."timesheetId" = t."id" AND r."kind" = 'RETURN'
      AND r."createdAt" >= t."reviewedAt"
  );

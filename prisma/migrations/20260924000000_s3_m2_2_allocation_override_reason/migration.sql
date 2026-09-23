-- Sprint 3 Member 2 (S3-M2-2): record why an organiser overrode a suggestion.
--
-- Bulk allocation proposes the top-ranked eligible tutor for each staffing
-- requirement. An organiser may choose a different eligible tutor instead, and
-- when they do they must say why. The words are kept with the allocation so the
-- decision can be explained later.
--
-- Null means nobody overrode anything: the proposed tutor was accepted, or the
-- allocation was made one at a time from the board.
ALTER TABLE "Allocation" ADD COLUMN "overrideReason" TEXT;

-- A blank string is not a reason.
ALTER TABLE "Allocation"
  ADD CONSTRAINT "Allocation_overrideReason_not_blank"
  CHECK ("overrideReason" IS NULL OR length(btrim("overrideReason")) > 0);

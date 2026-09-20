-- Sprint 3 Member 1: In-app notification inbox and due reminders.

-- Notification categories emitted from existing workflow state transitions
-- (allocation, timesheet, excuse, volunteer) plus scheduled due reminders.
CREATE TYPE "NotificationType" AS ENUM (
  'ALLOCATION_CREATED',
  'ALLOCATION_CHANGED',
  'TIMESHEET_SUBMITTED',
  'TIMESHEET_RETURNED',
  'TIMESHEET_APPROVED',
  'EXCUSE_SUBMITTED',
  'EXCUSE_DECIDED',
  'VOLUNTEER_OUTCOME',
  'TIMESHEET_REVIEW_DUE',
  'TIMESHEET_RESUBMIT_DUE',
  'VOLUNTEER_CLAIM_DUE',
  'EXCUSE_REVIEW_DUE'
);

CREATE TABLE "Notification" (
  "id" SERIAL NOT NULL,
  "recipientProfileId" INTEGER NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "linkPath" TEXT NOT NULL,
  "targetType" VARCHAR(64) NOT NULL,
  "targetId" INTEGER,
  "eventKey" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_title_not_blank" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "Notification_linkPath_not_blank"
    CHECK (length(btrim("linkPath")) > 0),
  CONSTRAINT "Notification_eventKey_not_blank"
    CHECK (length(btrim("eventKey")) > 0)
);

-- The unique event key is the de-duplication guarantee: retries and repeated
-- reminder runs collide on this constraint instead of inserting a second row.
CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");

CREATE INDEX "Notification_recipientProfileId_readAt_createdAt_idx"
  ON "Notification"("recipientProfileId", "readAt", "createdAt");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientProfileId_fkey"
  FOREIGN KEY ("recipientProfileId") REFERENCES "Profile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'SWAP_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'SWAP_UPDATED';
ALTER TABLE "Profile" ADD COLUMN "scheduleRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "TutoringBooking" (
 "id" SERIAL PRIMARY KEY,
 "studentId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE RESTRICT,
 "tutorId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE RESTRICT,
 "courseId" INTEGER NOT NULL REFERENCES "Course"("id") ON DELETE RESTRICT,
 "termId" INTEGER NOT NULL REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT,
 "startsAt" TIMESTAMP(3) NOT NULL,"endsAt" TIMESTAMP(3) NOT NULL,
 "status" VARCHAR(16) NOT NULL DEFAULT 'CONFIRMED',
 "occurrenceStatus" VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED',
 "version" INTEGER NOT NULL DEFAULT 1,
 "requestKey" VARCHAR(128) NOT NULL,"requestHash" VARCHAR(64) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "TutoringBooking_window" CHECK ("endsAt">="startsAt"+interval '15 minutes' AND "endsAt"<="startsAt"+interval '180 minutes'),
 CONSTRAINT "TutoringBooking_status" CHECK ("status" IN ('CONFIRMED','CANCELLED')),
 CONSTRAINT "TutoringBooking_occurrence" CHECK ("occurrenceStatus" IN ('SCHEDULED','EXCUSED','SKIPPED')),
 CONSTRAINT "TutoringBooking_version" CHECK ("version">0),
 UNIQUE("studentId","requestKey")
);
CREATE INDEX "TutoringBooking_tutorId_status_startsAt_idx" ON "TutoringBooking"("tutorId","status","startsAt");
CREATE INDEX "TutoringBooking_studentId_status_startsAt_idx" ON "TutoringBooking"("studentId","status","startsAt");
CREATE TABLE "TutorSwap" (
 "id" SERIAL PRIMARY KEY,"allocationId" INTEGER NOT NULL REFERENCES "Allocation"("id") ON DELETE RESTRICT,
 "requesterId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE RESTRICT,
 "replacementId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE RESTRICT,
 "replacementAllocationId" INTEGER REFERENCES "Allocation"("id") ON DELETE RESTRICT,
 "allocationRevision" VARCHAR(64) NOT NULL,"snapshot" JSONB NOT NULL,
 "reason" VARCHAR(1000) NOT NULL,
 "status" VARCHAR(16) NOT NULL DEFAULT 'REQUESTED',"version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "TutorSwap_status" CHECK ("status" IN ('REQUESTED','ACCEPTED','DECLINED','APPROVED','REJECTED','CANCELLED')),
 CONSTRAINT "TutorSwap_version" CHECK ("version">0),
 CONSTRAINT "TutorSwap_distinct" CHECK ("requesterId"<>"replacementId")
);
CREATE UNIQUE INDEX "TutorSwap_one_active_allocation" ON "TutorSwap"("allocationId") WHERE "status" IN ('REQUESTED','ACCEPTED');
CREATE INDEX "TutorSwap_status_createdAt_idx" ON "TutorSwap"("status","createdAt");
CREATE TABLE "BookingEvent" (
 "id" SERIAL PRIMARY KEY,"bookingId" INTEGER NOT NULL REFERENCES "TutoringBooking"("id") ON DELETE RESTRICT,
 "actorId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE RESTRICT,
 "action" VARCHAR(24) NOT NULL,"version" INTEGER NOT NULL,"note" VARCHAR(1000) NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("bookingId","version")
);
CREATE TABLE "SwapEvent" (
 "id" SERIAL PRIMARY KEY,"swapId" INTEGER NOT NULL REFERENCES "TutorSwap"("id") ON DELETE RESTRICT,
 "actorId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE RESTRICT,
 "action" VARCHAR(24) NOT NULL,"version" INTEGER NOT NULL,"note" VARCHAR(1000) NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("swapId","version")
);
CREATE FUNCTION s4_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Scheduling history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "BookingEvent_immutable" BEFORE UPDATE OR DELETE ON "BookingEvent" FOR EACH ROW EXECUTE FUNCTION s4_immutable_history();
CREATE TRIGGER "SwapEvent_immutable" BEFORE UPDATE OR DELETE ON "SwapEvent" FOR EACH ROW EXECUTE FUNCTION s4_immutable_history();
-- Profile revision writes serialize independent booking/allocation writers. Under
-- SERIALIZABLE a stale snapshot conflicts; under READ COMMITTED the next check
-- sees the winner. Sorted locks keep two-party bookings in a consistent order.
CREATE FUNCTION s4_booking_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancel bookings instead of deleting history' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."studentId",NEW."tutorId",NEW."courseId",NEW."termId",NEW."startsAt",NEW."endsAt",NEW."requestKey",NEW."requestHash") IS DISTINCT FROM (OLD."studentId",OLD."tutorId",OLD."courseId",OLD."termId",OLD."startsAt",OLD."endsAt",OLD."requestKey",OLD."requestHash") THEN RAISE EXCEPTION 'Booking identity is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD."status"='CANCELLED' AND NEW."status"<>'CANCELLED' THEN RAISE EXCEPTION 'Cancelled bookings cannot reactivate' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "Profile" WHERE "id"=NEW."studentId" AND "role"='STUDENT') OR NOT EXISTS(SELECT 1 FROM "Profile" WHERE "id"=NEW."tutorId" AND "role"='TUTOR') THEN RAISE EXCEPTION 'Invalid booking roles' USING ERRCODE='23514'; END IF;
 FOR person IN SELECT x FROM unnest(ARRAY[NEW."studentId",NEW."tutorId"]) x ORDER BY x LOOP
  UPDATE "Profile" SET "scheduleRevision"="scheduleRevision"+1 WHERE "id"=person;
 END LOOP;
 IF NEW."status"='CONFIRMED' AND NEW."occurrenceStatus"<>'EXCUSED' THEN
  IF EXISTS(SELECT 1 FROM "TutoringBooking" b WHERE b."id"<>NEW."id" AND b."status"='CONFIRMED' AND b."occurrenceStatus"<>'EXCUSED' AND (b."studentId"=NEW."studentId" OR b."tutorId"=NEW."tutorId") AND b."startsAt"<NEW."endsAt" AND b."endsAt">NEW."startsAt") OR EXISTS(SELECT 1 FROM "Allocation" a WHERE a."tutorId"=NEW."tutorId" AND a."status"='CONFIRMED' AND a."startsAt"<NEW."endsAt" AND a."endsAt">NEW."startsAt" AND NOT EXISTS(SELECT 1 FROM "Excuse" e WHERE e."allocationId"=a."id" AND e."status"='APPROVED' AND e."occurrenceStatus"='EXCUSED')) THEN RAISE EXCEPTION 'Booking interval is no longer free' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "TutoringBooking_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TutoringBooking" FOR EACH ROW EXECUTE FUNCTION s4_booking_guard();
CREATE FUNCTION s4_allocation_booking_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "Profile" SET "scheduleRevision"="scheduleRevision"+1 WHERE "id"=NEW."tutorId";
 IF NEW."status"='CONFIRMED' AND EXISTS(SELECT 1 FROM "TutoringBooking" b WHERE b."tutorId"=NEW."tutorId" AND b."status"='CONFIRMED' AND b."occurrenceStatus"<>'EXCUSED' AND b."startsAt"<NEW."endsAt" AND b."endsAt">NEW."startsAt") AND NOT EXISTS(SELECT 1 FROM "Excuse" e WHERE e."allocationId"=NEW."id" AND e."status"='APPROVED' AND e."occurrenceStatus"='EXCUSED') THEN RAISE EXCEPTION 'Allocation overlaps a tutoring booking' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Allocation_booking_guard" BEFORE INSERT OR UPDATE ON "Allocation" FOR EACH ROW EXECUTE FUNCTION s4_allocation_booking_guard();

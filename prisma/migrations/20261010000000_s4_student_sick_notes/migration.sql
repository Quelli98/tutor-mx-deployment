ALTER TYPE "NotificationType" ADD VALUE 'STUDENT_SICK_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'STUDENT_SICK_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_ATTENDANCE_CHANGED';
CREATE TABLE "StudentSickNote" (
 "id" SERIAL PRIMARY KEY,
 "bookingId" INTEGER NOT NULL REFERENCES "TutoringBooking"("id") ON DELETE RESTRICT,
 "reason" VARCHAR(1000) NOT NULL CHECK (length(trim("reason"))>0),
 "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED')),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 "reviewNote" VARCHAR(1000) NOT NULL DEFAULT '',
 "reviewedById" INTEGER REFERENCES "Profile"("id") ON DELETE RESTRICT,
 "reviewedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("status"='PENDING' AND "reviewedById" IS NULL AND "reviewedAt" IS NULL) OR ("status"<>'PENDING' AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL)),
 CHECK ("status"<>'REJECTED' OR length(trim("reviewNote"))>0)
);
CREATE UNIQUE INDEX "StudentSickNote_one_pending" ON "StudentSickNote"("bookingId") WHERE "status"='PENDING';
CREATE INDEX "StudentSickNote_status_id_idx" ON "StudentSickNote"("status","id");
CREATE FUNCTION s4_sick_note_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "TutoringBooking";
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sick note history is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO b FROM "TutoringBooking" WHERE "id"=NEW."bookingId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF b."status"<>'CONFIRMED' OR b."occurrenceStatus"<>'SCHEDULED' OR NEW."status"<>'PENDING' THEN RAISE EXCEPTION 'Booking is not eligible' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD."status"<>'PENDING' OR NEW."bookingId"<>OLD."bookingId" OR NEW."reason"<>OLD."reason" OR NEW."createdAt"<>OLD."createdAt" OR NEW."status"='PENDING' OR NEW."version"<>OLD."version"+1 THEN RAISE EXCEPTION 'Sick note history is immutable' USING ERRCODE='23514'; END IF;
  IF b."status"<>'CONFIRMED' OR b."occurrenceStatus"<>'SCHEDULED' OR NOT EXISTS (SELECT 1 FROM "Profile" WHERE "id"=NEW."reviewedById" AND "role"='ORGANISER') THEN RAISE EXCEPTION 'Sick note review is unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "StudentSickNote_guard" BEFORE INSERT OR UPDATE OR DELETE ON "StudentSickNote" FOR EACH ROW EXECUTE FUNCTION s4_sick_note_guard();
CREATE FUNCTION s4_booking_pending_absence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."status"<>OLD."status" OR NEW."occurrenceStatus"<>OLD."occurrenceStatus") AND EXISTS (SELECT 1 FROM "StudentSickNote" WHERE "bookingId"=OLD."id" AND "status"='PENDING') THEN RAISE EXCEPTION 'Review the pending sick note first' USING ERRCODE='23514'; END IF;
 IF OLD."occurrenceStatus"<>'SCHEDULED' AND NEW."occurrenceStatus"<>OLD."occurrenceStatus" THEN RAISE EXCEPTION 'Attendance history is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "TutoringBooking_pending_absence" BEFORE UPDATE ON "TutoringBooking" FOR EACH ROW EXECUTE FUNCTION s4_booking_pending_absence_guard();

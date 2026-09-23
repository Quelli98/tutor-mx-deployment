BEGIN;

-- Remove only Tutor Mx demo records so the seed is safe to run repeatedly.
DELETE FROM "VolunteerClaim"
WHERE "studentId" IN (
  SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%'
)
OR "overflowWorkId" IN (
  SELECT ow."id" FROM "OverflowWork" ow
  JOIN "Course" c ON c."id" = ow."courseId"
  WHERE c."code" LIKE 'DEMO%'
);
DELETE FROM "Excuse"
WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%');
-- Correction history, declarations and disputes reference work logs, timesheets
-- and profiles with Restrict keys, so they have to go first or a re-run of this
-- seed fails on the rows a demo walkthrough created.
DELETE FROM "TimesheetRevision"
WHERE "timesheetId" IN (
  SELECT "id" FROM "Timesheet"
  WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%')
)
OR "authorProfileId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%');
DELETE FROM "TimesheetDeclaration"
WHERE "timesheetId" IN (
  SELECT "id" FROM "Timesheet"
  WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%')
);
DELETE FROM "TimesheetDispute"
WHERE "timesheetId" IN (
  SELECT "id" FROM "Timesheet"
  WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%')
)
OR "raisedByProfileId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%')
OR "resolvedByProfileId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%');
DELETE FROM "WorkLog"
WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%');
DELETE FROM "Timesheet"
WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%');
DELETE FROM "OverflowWork"
WHERE "courseId" IN (SELECT "id" FROM "Course" WHERE "code" LIKE 'DEMO%');
DELETE FROM "Allocation"
WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%')
   OR "courseId" IN (SELECT "id" FROM "Course" WHERE "code" LIKE 'DEMO%');
DELETE FROM "TimeSlot"
WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%');
DELETE FROM "TutorMark"
WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%')
   OR "courseId" IN (SELECT "id" FROM "Course" WHERE "code" LIKE 'DEMO%');
DELETE FROM "TutorHourLimit"
WHERE "tutorId" IN (SELECT "id" FROM "Profile" WHERE "auth0Id" LIKE 'demo|%');
DELETE FROM "Profile" WHERE "auth0Id" LIKE 'demo|%';
DELETE FROM "Course" WHERE "code" LIKE 'DEMO%';

INSERT INTO "Profile" ("auth0Id", "email", "fullName", "role") VALUES
  ('demo|organiser', 'organiser@tutormx.example', 'Demo Organiser', 'ORGANISER'),
  ('demo|tutor-pass', 'tutor.pass@tutormx.example', 'Demo Tutor Pass', 'TUTOR'),
  ('demo|tutor-clash', 'tutor.clash@tutormx.example', 'Demo Tutor Clash', 'TUTOR'),
  ('demo|tutor-low-mark', 'tutor.lowmark@tutormx.example', 'Demo Tutor Low Mark', 'TUTOR'),
  ('demo|student', 'student@tutormx.example', 'Demo Student', 'STUDENT'),
  ('demo|student-race', 'student.race@tutormx.example', 'Demo Student Race', 'STUDENT');

INSERT INTO "Course" ("code", "name")
VALUES ('DEMO101', 'Demo Introduction to Tutoring');

-- Academic terms are upserted rather than deleted-and-recreated: they are
-- shared institution reference data, not demo-owned rows, and a term is what
-- bounds an imported timetable. Removing one on every seed would silently
-- strand the schedule entries that were imported against it.
-- Both terms are seeded so the import picker is not a single dead-end option
-- and so a term boundary can be exercised: all demo dates below fall inside
-- 'Demo 2030 Semester 2' and outside 'Demo 2031 Semester 1'.
INSERT INTO "AcademicTerm" ("name", "startsOn", "endsOn", "updatedAt")
VALUES
  ('Demo 2030 Semester 2', DATE '2030-08-26', DATE '2030-11-29', CURRENT_TIMESTAMP),
  ('Demo 2031 Semester 1', DATE '2031-02-17', DATE '2031-06-06', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET
  "startsOn" = EXCLUDED."startsOn",
  "endsOn" = EXCLUDED."endsOn",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "TutorMark" ("tutorId", "courseId", "mark")
SELECT p."id", c."id", marks."mark"
FROM (VALUES
  ('demo|tutor-pass', 78.00::decimal),
  ('demo|tutor-clash', 82.00::decimal),
  ('demo|tutor-low-mark', 45.00::decimal)
) AS marks("auth0Id", "mark")
JOIN "Profile" p ON p."auth0Id" = marks."auth0Id"
CROSS JOIN "Course" c
WHERE c."code" = 'DEMO101';

INSERT INTO "TutorHourLimit" ("tutorId", "weeklyHours")
SELECT "id", 8.00 FROM "Profile" WHERE "auth0Id" LIKE 'demo|tutor-%';

INSERT INTO "TimeSlot" ("tutorId", "type", "startsAt", "endsAt")
SELECT "id", 'BUSY', TIMESTAMP '2030-09-04 13:30:00', TIMESTAMP '2030-09-04 15:30:00'
FROM "Profile" WHERE "auth0Id" = 'demo|tutor-clash';

INSERT INTO "Allocation" (
  "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours", "status"
)
SELECT p."id", c."id", allocation."startsAt", allocation."endsAt", allocation."hours", 'PROPOSED'
FROM (VALUES
  ('demo|tutor-pass', TIMESTAMP '2030-09-02 10:00:00', TIMESTAMP '2030-09-02 12:00:00', 2.00::decimal),
  ('demo|tutor-pass', TIMESTAMP '2030-09-05 09:00:00', TIMESTAMP '2030-09-05 11:00:00', 2.00::decimal),
  ('demo|tutor-clash', TIMESTAMP '2030-09-03 09:00:00', TIMESTAMP '2030-09-03 16:00:00', 7.00::decimal)
) AS allocation("auth0Id", "startsAt", "endsAt", "hours")
JOIN "Profile" p ON p."auth0Id" = allocation."auth0Id"
CROSS JOIN "Course" c
WHERE c."code" = 'DEMO101';

UPDATE "Allocation"
  SET "status" = 'CONFIRMED',
      "reviewedById" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|organiser'),
      "reviewedAt" = CURRENT_TIMESTAMP
  WHERE "courseId" = (SELECT "id" FROM "Course" WHERE "code" = 'DEMO101');

INSERT INTO "Timesheet" ("tutorId", "weekStart")
SELECT "id", DATE '2030-09-02'
FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass';

INSERT INTO "WorkLog" (
  "tutorId", "allocationId", "timesheetId", "workDate", "hours", "description"
)
SELECT p."id", a."id", t."id", DATE '2030-09-02', 2.00, 'Demo tutorial session'
FROM "Profile" p
JOIN "Allocation" a ON a."tutorId" = p."id" AND a."startsAt" = TIMESTAMP '2030-09-02 10:00:00'
JOIN "Timesheet" t ON t."tutorId" = p."id" AND t."weekStart" = DATE '2030-09-02'
WHERE p."auth0Id" = 'demo|tutor-pass';

INSERT INTO "Excuse" ("tutorId", "allocationId", "reason")
SELECT p."id", a."id", 'Demo timetable conflict'
FROM "Profile" p
JOIN "Allocation" a ON a."tutorId" = p."id" AND a."startsAt" = TIMESTAMP '2030-09-05 09:00:00'
WHERE p."auth0Id" = 'demo|tutor-pass';

INSERT INTO "OverflowWork" (
  "courseId", "startsAt", "endsAt", "hours", "status", "closesAt"
)
SELECT "id", TIMESTAMP '2030-09-06 10:00:00', TIMESTAMP '2030-09-06 12:00:00',
  2.00, 'OPEN', TIMESTAMP '2030-09-05 17:00:00'
FROM "Course" WHERE "code" = 'DEMO101';

INSERT INTO "OverflowWork" (
  "courseId", "startsAt", "endsAt", "hours", "status", "closesAt"
)
SELECT "id", TIMESTAMP '2030-09-07 10:00:00', TIMESTAMP '2030-09-07 11:00:00',
  1.00, 'OPEN', TIMESTAMP '2030-09-06 17:00:00'
FROM "Course" WHERE "code" = 'DEMO101';

UPDATE "OverflowWork" SET "status" = 'CLOSED'
WHERE "courseId" = (SELECT "id" FROM "Course" WHERE "code" = 'DEMO101')
  AND "startsAt" = TIMESTAMP '2030-09-07 10:00:00';

INSERT INTO "VolunteerClaim" ("overflowWorkId", "studentId")
SELECT ow."id", p."id"
FROM "OverflowWork" ow
JOIN "Course" c ON c."id" = ow."courseId" AND c."code" = 'DEMO101'
CROSS JOIN "Profile" p
WHERE ow."startsAt" = TIMESTAMP '2030-09-06 10:00:00'
  AND p."auth0Id" = 'demo|student';

-- Sprint 2 seed scenarios: workflow state, approval and race/duplicate fixtures.

-- 1. SUBMITTED timesheet (pending organiser approval).
INSERT INTO "Allocation" (
  "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours", "status"
)
SELECT p."id", c."id", TIMESTAMP '2030-09-09 10:00:00', TIMESTAMP '2030-09-09 12:00:00',
  2.00, 'PROPOSED'
FROM "Profile" p
CROSS JOIN "Course" c
WHERE p."auth0Id" = 'demo|tutor-pass' AND c."code" = 'DEMO101';

UPDATE "Allocation"
  SET "status" = 'CONFIRMED',
      "reviewedById" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|organiser'),
      "reviewedAt" = CURRENT_TIMESTAMP
  WHERE "tutorId" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass')
    AND "startsAt" = TIMESTAMP '2030-09-09 10:00:00';

INSERT INTO "Timesheet" ("tutorId", "weekStart")
SELECT "id", DATE '2030-09-09'
FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass';

INSERT INTO "WorkLog" (
  "tutorId", "allocationId", "timesheetId", "workDate", "hours", "description"
)
SELECT p."id", a."id", t."id", DATE '2030-09-09', 2.00, 'Demo submitted session'
FROM "Profile" p
JOIN "Allocation" a ON a."tutorId" = p."id" AND a."startsAt" = TIMESTAMP '2030-09-09 10:00:00'
JOIN "Timesheet" t ON t."tutorId" = p."id" AND t."weekStart" = DATE '2030-09-09'
WHERE p."auth0Id" = 'demo|tutor-pass';

UPDATE "Timesheet" SET "status" = 'SUBMITTED'
WHERE "tutorId" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass')
  AND "weekStart" = DATE '2030-09-09';

-- 2. RETURNED timesheet with reason.
INSERT INTO "Allocation" (
  "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours", "status"
)
SELECT p."id", c."id", TIMESTAMP '2030-09-16 10:00:00', TIMESTAMP '2030-09-16 12:00:00',
  2.00, 'PROPOSED'
FROM "Profile" p
CROSS JOIN "Course" c
WHERE p."auth0Id" = 'demo|tutor-pass' AND c."code" = 'DEMO101';

UPDATE "Allocation"
  SET "status" = 'CONFIRMED',
      "reviewedById" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|organiser'),
      "reviewedAt" = CURRENT_TIMESTAMP
  WHERE "tutorId" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass')
    AND "startsAt" = TIMESTAMP '2030-09-16 10:00:00';

INSERT INTO "Timesheet" ("tutorId", "weekStart")
SELECT "id", DATE '2030-09-16'
FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass';

INSERT INTO "WorkLog" (
  "tutorId", "allocationId", "timesheetId", "workDate", "hours", "description"
)
SELECT p."id", a."id", t."id", DATE '2030-09-16', 1.50, 'Demo returned session'
FROM "Profile" p
JOIN "Allocation" a ON a."tutorId" = p."id" AND a."startsAt" = TIMESTAMP '2030-09-16 10:00:00'
JOIN "Timesheet" t ON t."tutorId" = p."id" AND t."weekStart" = DATE '2030-09-16'
WHERE p."auth0Id" = 'demo|tutor-pass';

UPDATE "Timesheet" SET "status" = 'SUBMITTED'
WHERE "tutorId" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass')
  AND "weekStart" = DATE '2030-09-16';

-- A returned timesheet must name the review that produced it: the database
-- enforces it, and the tutor's resubmission is declared against that moment, so
-- the fixture has to carry a real review time rather than only a reason.
UPDATE "Timesheet"
  SET "status" = 'RETURNED',
      "reviewReason" = 'Please correct Tuesday hours',
      "reviewedById" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|organiser'),
      "reviewedAt" = CURRENT_TIMESTAMP - INTERVAL '2 days'
WHERE "tutorId" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass')
  AND "weekStart" = DATE '2030-09-16';

-- 3. Overflow work + accepted claim (triggers OverflowWork -> FILLED).
--    No sourceAllocationId: the unique constraint on that column is already
--    used by the existing seed, and this overflow represents organiser-posted work.
INSERT INTO "OverflowWork" (
  "courseId", "startsAt", "endsAt", "hours", "status"
)
SELECT c."id",
  TIMESTAMP '2030-09-09 10:00:00', TIMESTAMP '2030-09-09 12:00:00',
  2.00, 'OPEN'
FROM "Course" c
WHERE c."code" = 'DEMO101';

--    Insert both claims as PENDING first (work is OPEN), then accept the
--    first one so the after-trigger fills the work.
INSERT INTO "VolunteerClaim" ("overflowWorkId", "studentId")
SELECT ow."id", p."id"
FROM "OverflowWork" ow
JOIN "Course" c ON c."id" = ow."courseId" AND c."code" = 'DEMO101'
CROSS JOIN "Profile" p
WHERE ow."startsAt" = TIMESTAMP '2030-09-09 10:00:00'
  AND p."auth0Id" = 'demo|student';

INSERT INTO "VolunteerClaim" ("overflowWorkId", "studentId")
SELECT ow."id", p."id"
FROM "OverflowWork" ow
JOIN "Course" c ON c."id" = ow."courseId" AND c."code" = 'DEMO101'
CROSS JOIN "Profile" p
WHERE ow."startsAt" = TIMESTAMP '2030-09-09 10:00:00'
  AND p."auth0Id" = 'demo|student-race';

--    Accept the first student's claim; the fill_overflow_work_after_accept
--    trigger sets OverflowWork to FILLED automatically.
UPDATE "VolunteerClaim" SET "status" = 'ACCEPTED'
WHERE "overflowWorkId" = (
  SELECT ow."id" FROM "OverflowWork" ow
  JOIN "Course" c ON c."id" = ow."courseId"
  WHERE c."code" = 'DEMO101' AND ow."startsAt" = TIMESTAMP '2030-09-09 10:00:00'
) AND "studentId" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|student');

COMMIT;

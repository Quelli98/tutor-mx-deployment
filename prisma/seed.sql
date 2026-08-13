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
  ('demo|student', 'student@tutormx.example', 'Demo Student', 'STUDENT');

INSERT INTO "Course" ("code", "name")
VALUES ('DEMO101', 'Demo Introduction to Tutoring');

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

UPDATE "Allocation" SET "status" = 'CONFIRMED'
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

COMMIT;

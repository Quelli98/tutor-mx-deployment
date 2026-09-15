import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client.js";
import {
  COURSE_DELETE_REFUSALS,
  deleteCourseAndDependents,
} from "./course-deletion.js";
import { createOrganiserService } from "./organiser-service.js";

const migrationsPath = fileURLToPath(
  new URL("../../prisma/migrations", import.meta.url),
);

const TUTOR = 1;
const ORGANISER = 2;
const STUDENT = 3;
const OTHER_STUDENT = 4;
const COURSE = 10;
const OTHER_COURSE = 20;

let database: PGlite;
let socketServer: PGLiteSocketServer;
let socketDirectory: string;
let pool: pg.Pool;
let prisma: PrismaClient;

async function sql(text: string) {
  await pool.query(text);
}

async function count(text: string): Promise<number> {
  const result = await pool.query<{ count: string }>(text);
  return Number(result.rows[0]!.count);
}

/** Every row that belongs to the course, so a refusal can prove nothing moved. */
async function courseFootprint(courseId: number) {
  return {
    course: await count(`SELECT count(*) FROM "Course" WHERE "id" = ${courseId}`),
    allocations: await count(
      `SELECT count(*) FROM "Allocation" WHERE "courseId" = ${courseId}`,
    ),
    workLogs: await count(
      `SELECT count(*) FROM "WorkLog" w JOIN "Allocation" a ON a."id" = w."allocationId" WHERE a."courseId" = ${courseId}`,
    ),
    excuses: await count(
      `SELECT count(*) FROM "Excuse" e JOIN "Allocation" a ON a."id" = e."allocationId" WHERE a."courseId" = ${courseId}`,
    ),
    overflowWork: await count(
      `SELECT count(*) FROM "OverflowWork" WHERE "courseId" = ${courseId}`,
    ),
    volunteerClaims: await count(
      `SELECT count(*) FROM "VolunteerClaim" v JOIN "OverflowWork" o ON o."id" = v."overflowWorkId" WHERE o."courseId" = ${courseId}`,
    ),
    tutorMarks: await count(
      `SELECT count(*) FROM "TutorMark" WHERE "courseId" = ${courseId}`,
    ),
    timesheets: await count(`SELECT count(*) FROM "Timesheet"`),
  };
}

// Builders go through the same triggers the application does: allocations start
// PROPOSED, work logs and excuses need a CONFIRMED allocation, claims need OPEN
// future work, and timesheets start DRAFT.
async function confirmedAllocation(id: number, courseId: number, day: string) {
  await sql(`
    INSERT INTO "Allocation" ("id","tutorId","courseId","startsAt","endsAt","allocatedHours","updatedAt")
    VALUES (${id}, ${TUTOR}, ${courseId}, '${day} 10:00', '${day} 12:00', 2, now());
    UPDATE "Allocation" SET "status" = 'CONFIRMED', "reviewedById" = ${ORGANISER}, "reviewedAt" = now()
    WHERE "id" = ${id};
  `);
}

async function proposedAllocation(id: number, courseId: number, day: string) {
  await sql(`
    INSERT INTO "Allocation" ("id","tutorId","courseId","startsAt","endsAt","allocatedHours","updatedAt")
    VALUES (${id}, ${TUTOR}, ${courseId}, '${day} 10:00', '${day} 12:00', 2, now());
  `);
}

async function cancelAllocation(id: number) {
  await sql(`UPDATE "Allocation" SET "status" = 'CANCELLED' WHERE "id" = ${id}`);
}

async function draftTimesheet(id: number, day: string) {
  await sql(`
    INSERT INTO "Timesheet" ("id","tutorId","weekStart","updatedAt")
    VALUES (${id}, ${TUTOR}, date_trunc('week', DATE '${day}')::date, now());
  `);
}

async function workLog(
  id: number,
  allocationId: number,
  day: string,
  timesheetId: number | null,
) {
  await sql(`
    INSERT INTO "WorkLog" ("id","tutorId","allocationId","timesheetId","workDate","hours","description","updatedAt")
    VALUES (${id}, ${TUTOR}, ${allocationId}, ${timesheetId ?? "NULL"}, DATE '${day}', 2, 'Tutorial', now());
  `);
}

async function setTimesheetStatus(
  id: number,
  status: "SUBMITTED" | "APPROVED" | "RETURNED",
) {
  if (status !== "SUBMITTED") {
    await sql(`UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = ${id}`);
  }
  await sql(`
    UPDATE "Timesheet"
    SET "status" = '${status}', "reviewedById" = ${status === "SUBMITTED" ? "NULL" : ORGANISER},
        "reviewReason" = ${status === "RETURNED" ? "'Fix the hours'" : "NULL"}
    WHERE "id" = ${id};
  `);
}

async function openOverflowWork(
  id: number,
  courseId: number,
  day: string,
  sourceAllocationId: number | null = null,
) {
  await sql(`
    INSERT INTO "OverflowWork" ("id","courseId","sourceAllocationId","startsAt","endsAt","hours","updatedAt")
    VALUES (${id}, ${courseId}, ${sourceAllocationId ?? "NULL"}, '${day} 10:00', '${day} 12:00', 2, now());
  `);
}

async function pendingClaim(id: number, overflowWorkId: number, studentId: number) {
  await sql(`
    INSERT INTO "VolunteerClaim" ("id","overflowWorkId","studentId","updatedAt")
    VALUES (${id}, ${overflowWorkId}, ${studentId}, now());
  `);
}

async function expectRefusal(courseId: number, message: string) {
  await expect(deleteCourseAndDependents(prisma, courseId)).rejects.toMatchObject({
    status: 409,
    code: "COURSE_CONFLICT",
    message,
  });
}

beforeAll(async () => {
  database = await PGlite.create();
  const directories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const directory of directories) {
    await database.exec(
      await readFile(join(migrationsPath, directory, "migration.sql"), "utf8"),
    );
  }

  // Served over a Unix socket so the real node-postgres driver and Prisma adapter
  // talk to it exactly as they talk to the production database, without claiming
  // a TCP port that a parallel test run could also want.
  socketDirectory = await mkdtemp(join(tmpdir(), "course-deletion-"));
  socketServer = new PGLiteSocketServer({
    db: database,
    path: join(socketDirectory, ".s.PGSQL.5432"),
  });
  await socketServer.start();

  connect();
}, 60_000);

function connect() {
  pool = new pg.Pool({
    host: socketDirectory,
    port: 5432,
    user: "postgres",
    database: "postgres",
    // PGlite is a single connection, so the test and Prisma share one.
    max: 1,
  });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
}

// After Prisma sees a database error, PGlite's socket server drops that connection,
// which real Postgres does not do. It also serves one connection at a time and
// frees the old one asynchronously, so a test that expects a database error opens
// a new connection and waits until it is accepted.
async function reconnect() {
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  for (let attempt = 1; ; attempt += 1) {
    connect();
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      await pool.end().catch(() => undefined);
      if (attempt === 20) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

afterAll(async () => {
  await prisma?.$disconnect();
  await pool?.end();
  await socketServer?.stop();
  await database?.close();
  if (socketDirectory) {
    await rm(socketDirectory, { recursive: true, force: true });
  }
});

describe("deleteCourseAndDependents against Postgres", () => {
  beforeEach(async () => {
    await sql(`
      TRUNCATE "VolunteerClaim", "OverflowWork", "Excuse", "WorkLog", "Timesheet",
        "Allocation", "TimeSlot", "TutorMark", "TutorHourLimit", "Course", "Profile"
        RESTART IDENTITY CASCADE;

      INSERT INTO "Profile" ("id","auth0Id","email","fullName","role","updatedAt") VALUES
        (${TUTOR}, 'auth0|tutor', 'tutor@tutormx.example', 'Tutor', 'TUTOR', now()),
        (${ORGANISER}, 'auth0|organiser', 'organiser@tutormx.example', 'Organiser', 'ORGANISER', now()),
        (${STUDENT}, 'auth0|student', 'student@tutormx.example', 'Student', 'STUDENT', now()),
        (${OTHER_STUDENT}, 'auth0|student-2', 'student2@tutormx.example', 'Student Two', 'STUDENT', now());
      INSERT INTO "TutorHourLimit" ("tutorId","weeklyHours") VALUES (${TUTOR}, 40);
      INSERT INTO "Course" ("id","code","name","updatedAt") VALUES
        (${COURSE}, 'DEL101', 'Course To Delete', now()),
        (${OTHER_COURSE}, 'KEEP101', 'Course To Keep', now());
      INSERT INTO "TutorMark" ("tutorId","courseId","mark") VALUES
        (${TUTOR}, ${COURSE}, 80), (${TUTOR}, ${OTHER_COURSE}, 75);
    `);
  });

  it("deletes the course and everything that depends on it, and nothing else", async () => {
    // A cancelled allocation whose work log sits in a DRAFT timesheet.
    await confirmedAllocation(1001, COURSE, "2030-09-02");
    await draftTimesheet(3001, "2030-09-02");
    await workLog(4001, 1001, "2030-09-02", 3001);
    await cancelAllocation(1001);

    // A cancelled allocation whose work log sits in a RETURNED timesheet that also
    // holds a work log for the other course.
    await confirmedAllocation(1002, COURSE, "2030-09-10");
    await confirmedAllocation(2001, OTHER_COURSE, "2030-09-11");
    await draftTimesheet(3002, "2030-09-10");
    await workLog(4002, 1002, "2030-09-10", 3002);
    await workLog(4003, 2001, "2030-09-11", 3002);
    await setTimesheetStatus(3002, "RETURNED");
    await cancelAllocation(1002);

    // A cancelled allocation with a loose work log, an excuse, and CLOSED overflow
    // work created from it that a student had claimed.
    await confirmedAllocation(1003, COURSE, "2030-09-18");
    await workLog(4004, 1003, "2030-09-18", null);
    await sql(`
      INSERT INTO "Excuse" ("id","tutorId","allocationId","reason","updatedAt")
      VALUES (5001, ${TUTOR}, 1003, 'Unwell', now());
    `);
    await openOverflowWork(6001, COURSE, "2030-09-18", 1003);
    await pendingClaim(7001, 6001, STUDENT);
    await sql(`UPDATE "OverflowWork" SET "status" = 'CLOSED' WHERE "id" = 6001`);
    await cancelAllocation(1003);

    // Overflow work posted directly on the course, FILLED by an accepted claim.
    await openOverflowWork(6002, COURSE, "2030-09-25");
    await pendingClaim(7002, 6002, OTHER_STUDENT);
    await sql(`UPDATE "VolunteerClaim" SET "status" = 'ACCEPTED' WHERE "id" = 7002`);

    // The other course keeps open overflow work with a claim of its own.
    await openOverflowWork(6003, OTHER_COURSE, "2030-09-26");
    await pendingClaim(7003, 6003, STUDENT);

    const otherCourseBefore = await courseFootprint(OTHER_COURSE);
    expect(await courseFootprint(COURSE)).toMatchObject({
      allocations: 3,
      workLogs: 3,
      excuses: 1,
      overflowWork: 2,
      volunteerClaims: 2,
      tutorMarks: 1,
    });

    await expect(deleteCourseAndDependents(prisma, COURSE)).resolves.toBeUndefined();

    expect(await courseFootprint(COURSE)).toEqual({
      course: 0,
      allocations: 0,
      workLogs: 0,
      excuses: 0,
      overflowWork: 0,
      volunteerClaims: 0,
      tutorMarks: 0,
      timesheets: 2,
    });
    // Timesheets stay, including the one this left with no work logs.
    expect(
      await count(`SELECT count(*) FROM "WorkLog" WHERE "timesheetId" = 3001`),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) FROM "WorkLog" WHERE "timesheetId" = 3002`),
    ).toBe(1);
    expect(await courseFootprint(OTHER_COURSE)).toEqual(otherCourseBefore);
    expect(await count(`SELECT count(*) FROM "Profile"`)).toBe(4);
  });

  it("deletes a course that has nothing depending on it", async () => {
    await deleteCourseAndDependents(prisma, OTHER_COURSE);
    expect(await courseFootprint(OTHER_COURSE)).toMatchObject({
      course: 0,
      tutorMarks: 0,
    });
  });

  it("reports a course that does not exist", async () => {
    await expect(deleteCourseAndDependents(prisma, 999)).rejects.toMatchObject({
      status: 404,
      code: "COURSE_NOT_FOUND",
    });
  });

  it.each(["PROPOSED", "CONFIRMED"] as const)(
    "refuses while a %s allocation exists and changes nothing",
    async (status) => {
      await confirmedAllocation(1001, COURSE, "2030-09-02");
      await cancelAllocation(1001);
      if (status === "PROPOSED") {
        await proposedAllocation(1002, COURSE, "2030-09-03");
      } else {
        await confirmedAllocation(1002, COURSE, "2030-09-03");
      }
      const before = await courseFootprint(COURSE);

      await expectRefusal(COURSE, COURSE_DELETE_REFUSALS.activeAllocations);

      expect(await courseFootprint(COURSE)).toEqual(before);
    },
  );

  it.each(["SUBMITTED", "APPROVED"] as const)(
    "refuses while a work log is in a timesheet that is %s and changes nothing",
    async (status) => {
      await confirmedAllocation(1001, COURSE, "2030-09-02");
      await draftTimesheet(3001, "2030-09-02");
      await workLog(4001, 1001, "2030-09-02", 3001);
      await setTimesheetStatus(3001, status);
      await cancelAllocation(1001);
      const before = await courseFootprint(COURSE);

      await expectRefusal(COURSE, COURSE_DELETE_REFUSALS.lockedTimesheetHours);

      expect(await courseFootprint(COURSE)).toEqual(before);
    },
  );

  it.each([
    ["posted on the course", null],
    ["created from a cancelled allocation", 1001],
  ] as const)(
    "refuses while OPEN overflow work %s exists and changes nothing",
    async (_label, sourceAllocationId) => {
      await confirmedAllocation(1001, COURSE, "2030-09-02");
      await openOverflowWork(6001, COURSE, "2030-09-02", sourceAllocationId);
      await pendingClaim(7001, 6001, STUDENT);
      await cancelAllocation(1001);
      const before = await courseFootprint(COURSE);

      await expectRefusal(COURSE, COURSE_DELETE_REFUSALS.openOverflowWork);

      expect(await courseFootprint(COURSE)).toEqual(before);
    },
  );

  describe("a stale page acting on a course that was just deleted", () => {
    beforeEach(async () => {
      await deleteCourseAndDependents(prisma, COURSE);
    });

    it("refuses a new allocation with COURSE_NOT_FOUND", async () => {
      const organiserService = createOrganiserService(prisma);

      await expect(
        organiserService.createAllocation("auth0|organiser", {
          tutorId: TUTOR,
          courseId: COURSE,
          startsAt: new Date("2030-09-02T10:00:00.000Z"),
          endsAt: new Date("2030-09-02T12:00:00.000Z"),
          minimumMark: 50,
          requestedHours: 2,
        }),
      ).rejects.toMatchObject({ status: 404, code: "COURSE_NOT_FOUND" });
      expect(await count(`SELECT count(*) FROM "Allocation"`)).toBe(0);
    });

    it("refuses a new tutor mark with the foreign key error the mark route maps to COURSE_NOT_FOUND", async () => {
      await expect(
        prisma.tutorMark.upsert({
          where: { tutorId_courseId: { tutorId: TUTOR, courseId: COURSE } },
          create: { tutorId: TUTOR, courseId: COURSE, mark: 70 },
          update: { mark: 70 },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
      await reconnect();
      expect(
        await count(`SELECT count(*) FROM "TutorMark" WHERE "courseId" = ${COURSE}`),
      ).toBe(0);
    });
  });
});

describe("deleteCourseAndDependents when another transaction interferes", () => {
  function failingClient(error: unknown) {
    return {
      $transaction: async () => {
        throw error;
      },
    } as unknown as PrismaClient;
  }

  function adapterError(originalCode: string) {
    return {
      code: "P2039",
      meta: { driverAdapterError: { cause: { originalCode } } },
    };
  }

  it.each([
    ["a serialization conflict", { code: "P2034" }],
    ["a deadlock", adapterError("40P01")],
    ["a RESTRICT refusal on the final delete", adapterError("23001")],
    ["a foreign key refusal on the final delete", { code: "P2003" }],
  ])("asks the organiser to retry after %s", async (_label, error) => {
    await expect(
      deleteCourseAndDependents(failingClient(error), COURSE),
    ).rejects.toMatchObject({
      status: 409,
      code: "COURSE_CONFLICT",
      message: COURSE_DELETE_REFUSALS.changedDuringDelete,
    });
  });

  it.each([
    ["an unrelated database error", adapterError("23514")],
    ["a P2039 without driver details", { code: "P2039" }],
    ["a non-Prisma failure", new Error("connection lost")],
  ])("leaves %s to the generic error path", async (_label, error) => {
    await expect(
      deleteCourseAndDependents(failingClient(error), COURSE),
    ).rejects.toBe(error);
  });
});

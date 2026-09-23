import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createReportingService } from "./reporting-service.js";
import type { QueryClient } from "./allocation-queries.js";

const migrationsPath = fileURLToPath(
  new URL("../../prisma/migrations", import.meta.url),
);

const TUTOR = 1;
const OTHER_TUTOR = 2;
const ORGANISER = 3;
const COURSE = 10;
const OTHER_COURSE = 20;

/** Monday 2 September 2030, the week every figure below is measured in. */
const WEEK_START = new Date("2030-09-02T00:00:00.000Z");

let database: PGlite;
let service: ReturnType<typeof createReportingService>;

async function sql(text: string) {
  await database.exec(text);
}

/** A confirmed allocation: hours booked, which is not hours worked. */
async function allocation(
  id: number,
  options: {
    tutorId?: number;
    courseId?: number;
    day: string;
    hours: number;
    status?: "PROPOSED" | "CONFIRMED";
  },
) {
  const { tutorId = TUTOR, courseId = COURSE, day, hours, status = "CONFIRMED" } = options;
  // The window is as long as the hours booked, which the database now insists on.
  const endsAt = `${10 + hours}:00`;
  await sql(`
    INSERT INTO "Allocation" ("id","tutorId","courseId","startsAt","endsAt","allocatedHours","updatedAt")
    VALUES (${id}, ${tutorId}, ${courseId}, '${day} 10:00', '${day} ${endsAt}', ${hours}, now());
  `);
  if (status === "CONFIRMED") {
    await sql(`
      UPDATE "Allocation" SET "status" = 'CONFIRMED', "reviewedById" = ${ORGANISER}, "reviewedAt" = now()
      WHERE "id" = ${id};
    `);
  }
}

/** Work logged against an allocation, on a timesheet of the given status. */
async function workLog(
  id: number,
  options: {
    tutorId?: number;
    allocationId: number;
    timesheetId: number;
    day: string;
    hours: number;
  },
) {
  const { tutorId = TUTOR, allocationId, timesheetId, day, hours } = options;
  await sql(`
    INSERT INTO "WorkLog" ("id","tutorId","allocationId","timesheetId","workDate","hours","description","updatedAt")
    VALUES (${id}, ${tutorId}, ${allocationId}, ${timesheetId}, DATE '${day}', ${hours}, 'Tutorial', now());
  `);
}

async function timesheet(
  id: number,
  options: { tutorId?: number; weekStart: string },
) {
  const { tutorId = TUTOR, weekStart } = options;
  await sql(`
    INSERT INTO "Timesheet" ("id","tutorId","weekStart","updatedAt")
    VALUES (${id}, ${tutorId}, DATE '${weekStart}', now());
  `);
}

/** Called once the timesheet holds work: it cannot be submitted while empty. */
async function setTimesheetStatus(
  id: number,
  status: "DRAFT" | "SUBMITTED" | "APPROVED",
) {
  if (status === "DRAFT") return;
  await sql(`UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = ${id}`);
  if (status === "APPROVED") {
    await sql(`
      UPDATE "Timesheet" SET "status" = 'APPROVED', "reviewedById" = ${ORGANISER}, "reviewedAt" = now()
      WHERE "id" = ${id};
    `);
  }
}

async function report(weeks = 1) {
  return service.workloadReport({ weekStart: WEEK_START, weeks });
}

async function courseRow(weeks = 1) {
  const result = await report(weeks);
  return result.courses.find((row) => row.courseId === COURSE)!;
}

async function tutorRow(weeks = 1) {
  const result = await report(weeks);
  return result.tutors.find((row) => row.tutorId === TUTOR)!;
}

beforeAll(async () => {
  database = new PGlite();
  const directories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const directory of directories) {
    await database.exec(
      await readFile(`${migrationsPath}/${directory}/migration.sql`, "utf8"),
    );
  }
  const queryClient: QueryClient = {
    async query<Row>(text: string, parameters?: unknown[]) {
      const result = await database.query(text, parameters);
      return { rows: result.rows as Row[] };
    },
  };
  service = createReportingService(queryClient);
}, 60_000);

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await sql(`
    TRUNCATE "WorkLog", "Timesheet", "Excuse", "Allocation", "TutorMark",
      "TutorHourLimit", "StaffingRequirement", "Course", "Profile"
      RESTART IDENTITY CASCADE;

    INSERT INTO "Profile" ("id","auth0Id","email","fullName","role","updatedAt") VALUES
      (${TUTOR}, 'auth0|t1', 't1@tutormx.example', 'Ada Tutor', 'TUTOR', now()),
      (${OTHER_TUTOR}, 'auth0|t2', 't2@tutormx.example', 'Ben Tutor', 'TUTOR', now()),
      (${ORGANISER}, 'auth0|org', 'org@tutormx.example', 'Organiser', 'ORGANISER', now());
    INSERT INTO "Course" ("id","code","name","hourlyRate","budget","updatedAt") VALUES
      (${COURSE}, 'COMS3011', 'Software Design Project', 180.00, 5000.00, now()),
      (${OTHER_COURSE}, 'COMS3009', 'Software Engineering', NULL, NULL, now());
    INSERT INTO "TutorHourLimit" ("tutorId","weeklyHours") VALUES (${TUTOR}, 10), (${OTHER_TUTOR}, 20);
  `);
});

describe("the three kinds of hours stay separate", () => {
  it("counts booked hours as allocated and nothing else", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4 });

    const course = await courseRow();
    expect(course.allocatedHours).toBe(4);
    // Booked is not worked: nothing has been done or signed off yet.
    expect(course.approvedWorkedHours).toBe(0);
  });

  it("counts only work on an approved timesheet as approved worked", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 3 });
    await setTimesheetStatus(1, "APPROVED");

    const course = await courseRow();
    expect(course.approvedWorkedHours).toBe(3);
    expect(course.allocatedHours).toBe(4);
  });

  it.each([
    ["a draft timesheet", "DRAFT" as const],
    ["a submitted but unapproved timesheet", "SUBMITTED" as const],
  ])("does not count work on %s", async (_label, status) => {
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 3 });
    await setTimesheetStatus(1, status);

    expect((await courseRow()).approvedWorkedHours).toBe(0);
  });

  it("ignores allocations that are not confirmed", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4, status: "PROPOSED" });

    expect((await courseRow()).allocatedHours).toBe(0);
  });

  it("reports capacity per tutor only, never per course", async () => {
    const result = await report();
    const course = result.courses.find((row) => row.courseId === COURSE)!;

    // A tutor's weekly limit is not divided between courses, so a per-course
    // capacity would count the same hours once for every course they teach.
    expect(course).not.toHaveProperty("capacityHours");
    expect(result.tutors.find((row) => row.tutorId === TUTOR)!.capacityHours).toBe(10);
  });

  it("measures capacity at today's limit, multiplied by the weeks asked for", async () => {
    expect((await tutorRow(1)).capacityHours).toBe(10);
    expect((await tutorRow(4)).capacityHours).toBe(40);
  });

  it("reports no capacity for a tutor whose limit is unset", async () => {
    await sql(`DELETE FROM "TutorHourLimit" WHERE "tutorId" = ${TUTOR}`);

    expect((await tutorRow()).capacityHours).toBeNull();
  });
});

describe("the period is whole weeks", () => {
  it("counts only what falls inside the weeks asked for", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4 });
    // The Monday after the single week being reported.
    await allocation(2, { day: "2030-09-09", hours: 5 });

    expect((await courseRow(1)).allocatedHours).toBe(4);
    expect((await courseRow(2)).allocatedHours).toBe(9);
  });

  it("counts work by the date it was done", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 2 });
    await setTimesheetStatus(1, "APPROVED");
    await allocation(2, { day: "2030-09-09", hours: 4 });
    await timesheet(2, { weekStart: "2030-09-09" });
    await workLog(2, { allocationId: 2, timesheetId: 2, day: "2030-09-09", hours: 2 });
    await setTimesheetStatus(2, "APPROVED");

    expect((await courseRow(1)).approvedWorkedHours).toBe(2);
    expect((await courseRow(2)).approvedWorkedHours).toBe(4);
  });
});

describe("money", () => {
  it("spends approved worked hours and commits allocated hours", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 3 });
    await setTimesheetStatus(1, "APPROVED");

    const course = await courseRow();
    // Spend is money owed for work signed off; committed is booked but not done.
    expect(course.spend).toBe(540);
    expect(course.committed).toBe(720);
    expect(course.budgetRemaining).toBe(4460);
  });

  it("reports no money at all for a course with no rate", async () => {
    await allocation(1, { courseId: OTHER_COURSE, day: "2030-09-03", hours: 4 });

    const result = await report();
    const course = result.courses.find((row) => row.courseId === OTHER_COURSE)!;
    // A zero here would read as "this course was free".
    expect(course.spend).toBeNull();
    expect(course.committed).toBeNull();
    expect(course.budgetRemaining).toBeNull();
    expect(course.allocatedHours).toBe(4);
  });

  it("shows a budget overrun as a negative remainder rather than hiding it", async () => {
    await sql(`UPDATE "Course" SET "budget" = 100 WHERE "id" = ${COURSE}`);
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 3 });
    await setTimesheetStatus(1, "APPROVED");

    expect((await courseRow()).budgetRemaining).toBe(-440);
  });
});

describe("how work is spread across tutors", () => {
  it("gives each tutor's share of the period's allocated hours", async () => {
    await allocation(1, { tutorId: TUTOR, day: "2030-09-03", hours: 3 });
    await allocation(2, { tutorId: OTHER_TUTOR, day: "2030-09-04", hours: 9 });

    const result = await report();
    const ada = result.tutors.find((row) => row.tutorId === TUTOR)!;
    const ben = result.tutors.find((row) => row.tutorId === OTHER_TUTOR)!;

    expect(ada.allocatedHours).toBe(3);
    expect(ben.allocatedHours).toBe(9);
    expect(ada.shareOfAllocatedHours).toBe(0.25);
    expect(ben.shareOfAllocatedHours).toBe(0.75);
  });

  it("lists a tutor with no work rather than leaving them out", async () => {
    const result = await report();

    expect(result.tutors.map((row) => row.tutorId)).toEqual([TUTOR, OTHER_TUTOR]);
    expect(result.tutors.every((row) => row.shareOfAllocatedHours === 0)).toBe(true);
  });

  it("never counts an organiser as a tutor", async () => {
    const result = await report();

    expect(result.tutors.some((row) => row.tutorId === ORGANISER)).toBe(false);
  });
});

describe("reporting changes nothing", () => {
  it("leaves every table exactly as it was", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 3 });
    await setTimesheetStatus(1, "APPROVED");

    const snapshot = async () => {
      const tables = await database.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
      const counts: Record<string, number> = {};
      for (const { table_name } of tables.rows) {
        const rows = await database.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM "${table_name}"`,
        );
        counts[table_name] = rows.rows[0]!.count;
      }
      return counts;
    };

    const before = await snapshot();
    await report(4);
    expect(await snapshot()).toEqual(before);
  });
});

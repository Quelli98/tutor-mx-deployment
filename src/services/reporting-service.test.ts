import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createReportingService } from "./reporting-service.js";
import type { QueryClient } from "./allocation-queries.js";
import type { PayrollExport, PayrollExportRow } from "../app.js";

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
    // Snapshot the course rate onto every work log in this timesheet, matching
    // what the production approval path does.
    await sql(`
      UPDATE "WorkLog" w
      SET "approvedHourlyRate" = c."hourlyRate"
      FROM "Allocation" a, "Course" c
      WHERE a."id" = w."allocationId"
        AND c."id" = a."courseId"
        AND w."timesheetId" = ${id}
        AND w."approvedHourlyRate" IS NULL;
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

describe("approved rate snapshot", () => {
  it("stores the rate on work logs when a timesheet is approved", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 3 });

    // Before approval, the snapshot is null.
    const beforeApproval = await database.query<{ approvedHourlyRate: number | null }>(
      `SELECT "approvedHourlyRate" FROM "WorkLog" WHERE "id" = 1`,
    );
    expect(beforeApproval.rows[0]!.approvedHourlyRate).toBeNull();

    await setTimesheetStatus(1, "APPROVED");

    // After approval, the snapshot matches the course rate at that moment.
    const afterApproval = await database.query<{ approvedHourlyRate: string | null }>(
      `SELECT "approvedHourlyRate" FROM "WorkLog" WHERE "id" = 1`,
    );
    expect(Number(afterApproval.rows[0]!.approvedHourlyRate)).toBe(180);
  });

  it("does not change historical spend when the course rate is later adjusted", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 3 });
    await setTimesheetStatus(1, "APPROVED");

    // Spend at the original rate: 3 hours * 180 = 540.
    expect((await courseRow()).spend).toBe(540);

    // Change the course rate.
    await sql(`UPDATE "Course" SET "hourlyRate" = 250.00 WHERE "id" = ${COURSE}`);

    // Historical spend is unchanged because it was snapshotted at approval time.
    expect((await courseRow()).spend).toBe(540);
    // Committed uses the new rate, since that work has not been approved yet.
    expect((await courseRow()).committed).toBe(1000);
  });

  it("uses the new rate for work approved after the rate change", async () => {
    // First approval at the original rate.
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 2 });
    await setTimesheetStatus(1, "APPROVED");

    // Change the rate.
    await sql(`UPDATE "Course" SET "hourlyRate" = 250.00 WHERE "id" = ${COURSE}`);

    // Second approval at the new rate, using a different tutor to avoid the
    // unique constraint on tutorId+weekStart.
    await allocation(2, { tutorId: OTHER_TUTOR, day: "2030-09-04", hours: 4 });
    await timesheet(2, { tutorId: OTHER_TUTOR, weekStart: "2030-09-02" });
    await workLog(2, { tutorId: OTHER_TUTOR, allocationId: 2, timesheetId: 2, day: "2030-09-04", hours: 3 });
    await setTimesheetStatus(2, "APPROVED");

    // Total spend: (2 * 180) + (3 * 250) = 360 + 750 = 1110.
    expect((await courseRow()).spend).toBe(1110);
  });

  it("reconciles payroll totals with the workload report using snapshot rates", async () => {
    await allocation(1, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-03", hours: 3 });
    await setTimesheetStatus(1, "APPROVED");

    // Change the rate after approval.
    await sql(`UPDATE "Course" SET "hourlyRate" = 300.00 WHERE "id" = ${COURSE}`);

    const workload = await report();
    const payroll = await service.payrollExport({ weekStart: WEEK_START, weeks: 1 });

    // The workload report spend is based on the snapshot, not the current rate.
    const course = workload.courses.find((row) => row.courseId === COURSE)!;
    expect(course.spend).toBe(540); // 3 * 180, not 3 * 300

    // Payroll hours match the workload report.
    expect(payroll.totals.approvedHours).toBe(course.approvedWorkedHours);
  });
});

describe("how work is spread across tutors", () => {
  it("gives each tutor's share of the period's allocated hours", async () => {
    // The helper makes the window as long as the hours, so both stay inside the
    // maximum session length while keeping the 1:3 split the shares assert.
    await allocation(1, { tutorId: TUTOR, day: "2030-09-03", hours: 2 });
    await allocation(2, { tutorId: OTHER_TUTOR, day: "2030-09-04", hours: 6 });

    const result = await report();
    const ada = result.tutors.find((row) => row.tutorId === TUTOR)!;
    const ben = result.tutors.find((row) => row.tutorId === OTHER_TUTOR)!;

    expect(ada.allocatedHours).toBe(2);
    expect(ben.allocatedHours).toBe(6);
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

/**
 * The payroll export is measured against the same approved work as the reports
 * above, so these cases are as much about the two agreeing as about the figures
 * themselves.
 */
describe("payroll export", () => {
  /**
   * A week a tutor worked: a confirmed allocation for the day, a timesheet for
   * that week, the session logged against it, and the sheet left in the state
   * asked for. The window is always the same length here; only the hours logged
   * change, so a figure in a test reads as the work that earned it.
   */
  async function workedWeek(
    id: number,
    options: {
      tutorId?: number;
      courseId?: number;
      weekStart: string;
      day?: string;
      hours?: number;
      status?: "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED";
    },
  ) {
    const tutorId = options.tutorId ?? TUTOR;
    const day = options.day ?? options.weekStart;
    await allocation(id, { tutorId, courseId: options.courseId, day, hours: 4 });
    await timesheet(id, { tutorId, weekStart: options.weekStart });
    await workLog(id, {
      tutorId,
      allocationId: id,
      timesheetId: id,
      day,
      hours: options.hours ?? 2,
    });

    const status = options.status ?? "APPROVED";
    if (status === "RETURNED") {
      await sql(`UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = ${id}`);
      await sql(`
        UPDATE "Timesheet" SET "status" = 'RETURNED', "reviewReason" = 'Hours look too high',
          "reviewedById" = ${ORGANISER}, "reviewedAt" = now()
        WHERE "id" = ${id}
      `);
      return;
    }
    await setTimesheetStatus(id, status);
  }

  /** An objection against a week, still waiting or already answered. */
  async function dispute(
    timesheetId: number,
    tutorId: number,
    status: "OPEN" | "RESOLVED",
  ) {
    await sql(`
      INSERT INTO "TimesheetDispute" ("timesheetId","tutorId","reason","raisedByProfileId")
      VALUES (${timesheetId}, ${tutorId}, 'The session ran the full two hours', ${tutorId})
    `);
    if (status === "RESOLVED") {
      await sql(`
        UPDATE "TimesheetDispute"
        SET "status" = 'RESOLVED', "resolutionReason" = 'Checked against the register',
          "resolvedByProfileId" = ${ORGANISER}, "resolvedAt" = now()
        WHERE "timesheetId" = ${timesheetId} AND "status" = 'OPEN'
      `);
    }
  }

  /** Work the tutor has logged that no timesheet has claimed yet. */
  async function unsubmitted(
    id: number,
    options: { allocationId: number; day: string; hours: number },
  ) {
    await sql(`
      INSERT INTO "WorkLog" ("id","tutorId","allocationId","workDate","hours","description","updatedAt")
      VALUES (${id}, ${TUTOR}, ${options.allocationId}, DATE '${options.day}', ${options.hours}, 'Tutorial', now())
    `);
  }

  /** Everything the export reports for a tutor, paid and held together. */
  function hoursFor(
    result: PayrollExport,
    match: (line: PayrollExportRow) => boolean,
  ): number {
    return [...result.rows, ...result.heldRows]
      .filter(match)
      .reduce((sum, line) => sum + line.hours, 0);
  }

  it("pays work on an approved timesheet and nothing else", async () => {
    await workedWeek(1, { weekStart: "2030-09-02", hours: 3 });
    await workedWeek(2, { weekStart: "2030-09-09", status: "DRAFT" });
    await workedWeek(3, { weekStart: "2030-09-16", status: "SUBMITTED" });
    // Logged, but no sheet has claimed it: it can never be approved, so it can
    // never be paid.
    await allocation(4, { day: "2030-09-23", hours: 4 });
    await unsubmitted(4, { allocationId: 4, day: "2030-09-23", hours: 1 });

    const result = await service.payrollExport({ weekStart: WEEK_START, weeks: 4 });

    expect(result.rows.map((line) => line.periodStart)).toEqual(["2030-09-02"]);
    expect(result.rows.map((line) => line.hours)).toEqual([3]);
    expect(result.heldRows).toEqual([]);
    expect(result.totals).toEqual({ payableHours: 3, heldHours: 0, approvedHours: 3 });
    // The report ignores the same three the same way, which is what keeps the
    // two figures comparable.
    expect((await courseRow(4)).approvedWorkedHours).toBe(3);
  });

  it("never pays a week the organiser sent back", async () => {
    await workedWeek(1, { weekStart: "2030-09-02", status: "RETURNED" });
    await workedWeek(2, { weekStart: "2030-09-09", hours: 3 });

    const result = await service.payrollExport({ weekStart: WEEK_START, weeks: 2 });

    expect(result.rows.map((line) => line.periodStart)).toEqual(["2030-09-09"]);
    expect(result.totals).toEqual({ payableHours: 3, heldHours: 0, approvedHours: 3 });
  });

  it("holds approved work that is under an open objection", async () => {
    await workedWeek(1, { weekStart: "2030-09-02", hours: 4 });
    await dispute(1, TUTOR, "OPEN");

    const result = await service.payrollExport({ weekStart: WEEK_START, weeks: 1 });

    // Signed off, so it is the report's figure, but it is not owed while it is
    // being argued about.
    expect(result.rows).toEqual([]);
    expect(result.heldRows.map((line) => [line.periodStart, line.hours, line.held])).toEqual([
      ["2030-09-02", 4, true],
    ]);
    expect(result.totals).toEqual({ payableHours: 0, heldHours: 4, approvedHours: 4 });
    expect((await tutorRow(1)).approvedWorkedHours).toBe(4);
  });

  it("pays it once the objection is answered", async () => {
    await workedWeek(1, { weekStart: "2030-09-02", hours: 4 });
    await dispute(1, TUTOR, "RESOLVED");

    const result = await service.payrollExport({ weekStart: WEEK_START, weeks: 1 });

    expect(result.heldRows).toEqual([]);
    expect(result.rows.map((line) => line.hours)).toEqual([4]);
    expect(result.totals).toEqual({ payableHours: 4, heldHours: 0, approvedHours: 4 });
  });

  it("adds up to the workload report for the same weeks", async () => {
    await workedWeek(1, { weekStart: "2030-09-02", hours: 3 });
    await workedWeek(2, {
      tutorId: OTHER_TUTOR,
      weekStart: "2030-09-02",
      day: "2030-09-03",
      hours: 2,
    });
    await workedWeek(3, { courseId: OTHER_COURSE, weekStart: "2030-09-09", hours: 2 });
    await workedWeek(4, {
      tutorId: OTHER_TUTOR,
      courseId: OTHER_COURSE,
      weekStart: "2030-09-09",
      day: "2030-09-10",
      hours: 6,
    });
    await workedWeek(5, { weekStart: "2030-09-16", hours: 4 });
    await dispute(5, TUTOR, "OPEN");
    await workedWeek(6, { weekStart: "2030-09-23", status: "DRAFT" });
    await workedWeek(7, {
      tutorId: OTHER_TUTOR,
      weekStart: "2030-09-23",
      day: "2030-09-24",
      status: "RETURNED",
      hours: 3,
    });
    await allocation(8, { day: "2030-09-25", hours: 4 });
    await unsubmitted(8, { allocationId: 8, day: "2030-09-25", hours: 1 });

    const result = await service.payrollExport({ weekStart: WEEK_START, weeks: 4 });
    const workload = await report(4);

    // The figures first, so a rule that broke on both sides at once could not
    // pass this by agreeing with itself.
    expect(result.totals).toEqual({ payableHours: 13, heldHours: 4, approvedHours: 17 });

    // Then the point of the test: every hour the report calls approved is either
    // paid or held, for the period, for each tutor and for each course.
    expect(result.totals.approvedHours).toBe(
      workload.tutors.reduce((sum, row) => sum + row.approvedWorkedHours, 0),
    );
    for (const tutor of workload.tutors) {
      expect(hoursFor(result, (line) => line.tutorId === tutor.tutorId)).toBe(
        tutor.approvedWorkedHours,
      );
    }
    for (const course of workload.courses) {
      expect(hoursFor(result, (line) => line.courseCode === course.courseCode)).toBe(
        course.approvedWorkedHours,
      );
    }
  });

  it("includes the last day of the period and stops at the next Monday", async () => {
    await workedWeek(1, { weekStart: "2030-09-02", day: "2030-09-08", hours: 2 });
    await workedWeek(2, { weekStart: "2030-09-09", day: "2030-09-09", hours: 3 });

    const result = await service.payrollExport({ weekStart: WEEK_START, weeks: 1 });

    expect(
      result.rows.map((line) => [line.periodStart, line.periodEnd]),
    ).toEqual([["2030-09-02", "2030-09-08"]]);
    expect(result.totals).toEqual({ payableHours: 2, heldHours: 0, approvedHours: 2 });
  });

  it("reads down the page the way payroll does", async () => {
    // One tutor, one week, two courses, one sheet: a sheet covers a week rather
    // than a course, so this week earns two lines. Both logs go on before the
    // sheet is approved, because work logs only change while it is a draft.
    await allocation(1, { courseId: OTHER_COURSE, day: "2030-09-02", hours: 4 });
    await allocation(2, { day: "2030-09-03", hours: 4 });
    await timesheet(1, { weekStart: "2030-09-02" });
    await workLog(1, { allocationId: 1, timesheetId: 1, day: "2030-09-02", hours: 2 });
    await workLog(2, { allocationId: 2, timesheetId: 1, day: "2030-09-03", hours: 1 });
    await setTimesheetStatus(1, "APPROVED");

    await workedWeek(3, {
      tutorId: OTHER_TUTOR,
      weekStart: "2030-09-02",
      day: "2030-09-04",
      hours: 3,
    });
    await workedWeek(4, { weekStart: "2030-09-09", hours: 4 });

    const result = await service.payrollExport({ weekStart: WEEK_START, weeks: 2 });

    expect(
      result.rows.map((line) => `${line.periodStart} ${line.tutor} ${line.courseCode}`),
    ).toEqual([
      "2030-09-02 Ada Tutor COMS3009",
      "2030-09-02 Ada Tutor COMS3011",
      "2030-09-02 Ben Tutor COMS3011",
      "2030-09-09 Ada Tutor COMS3011",
    ]);
  });
});

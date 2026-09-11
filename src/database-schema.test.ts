import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findAllocationCandidates,
  listOpenWork,
  type QueryClient,
} from "./services/allocation-queries.js";

const migrationsPath = fileURLToPath(
  new URL("../prisma/migrations", import.meta.url),
);
const seedPath = fileURLToPath(new URL("../prisma/seed.sql", import.meta.url));

async function applyMigrations(database: PGlite): Promise<void> {
  const migrationDirectories = (await readdir(migrationsPath, {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directory of migrationDirectories) {
    const sql = await readFile(
      `${migrationsPath}/${directory}/migration.sql`,
      "utf8",
    );
    await database.exec(sql);
  }
}

async function seed(database: PGlite): Promise<void> {
  await database.exec(await readFile(seedPath, "utf8"));
}

function asQueryClient(database: PGlite): QueryClient {
  return {
    async query<Row>(sql: string, parameters?: unknown[]) {
      const result = await database.query(sql, parameters);
      return { rows: result.rows as Row[] };
    },
  };
}

async function expectDatabaseRejection(
  database: PGlite,
  sql: string,
  parameters: unknown[] = [],
): Promise<void> {
  await expect(database.query(sql, parameters)).rejects.toBeDefined();
}

describe("Basic workflow migrations", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await applyMigrations(database);
    await seed(database);
  }, 30_000);

  afterAll(async () => {
    await database.close();
  });

  it("creates every workflow table from clean migrations", async () => {
    const result = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('WorkLog', 'Timesheet', 'Excuse', 'OverflowWork', 'VolunteerClaim')
      ORDER BY table_name;
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "Excuse",
      "OverflowWork",
      "Timesheet",
      "VolunteerClaim",
      "WorkLog",
    ]);
  });

  it("loads safe, repeatable demo data for all three roles", async () => {
    await seed(database);

    const roles = await database.query<{ role: string; count: number }>(`
      SELECT "role"::text AS role, count(*)::int AS count
      FROM "Profile"
      WHERE "auth0Id" LIKE 'demo|%'
      GROUP BY "role"
      ORDER BY "role";
    `);

    expect(roles.rows).toEqual([
      { role: "ORGANISER", count: 1 },
      { role: "STUDENT", count: 2 },
      { role: "TUTOR", count: 3 },
    ]);
  });

  it("stores only the supported tutor availability recurrence placeholder", async () => {
    const tutor = await database.query<{ id: number }>(`
      SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass';
    `);
    const created = await database.query<{ recurrence: string }>(
      `INSERT INTO "TimeSlot" (
        "tutorId", "type", "startsAt", "endsAt", "recurrence"
      ) VALUES ($1, 'BUSY', '2031-01-06 09:00', '2031-01-06 10:00', 'WEEKLY')
      RETURNING "recurrence"`,
      [tutor.rows[0]!.id],
    );

    expect(created.rows[0]?.recurrence).toBe("WEEKLY");
    await expectDatabaseRejection(
      database,
      `INSERT INTO "TimeSlot" (
        "tutorId", "type", "startsAt", "endsAt", "recurrence"
      ) VALUES ($1, 'BUSY', '2031-01-07 09:00', '2031-01-07 10:00', 'DAILY')`,
      [tutor.rows[0]!.id],
    );
  });

  it("returns correct pass, mark, clash and hour candidate cases", async () => {
    const course = await database.query<{ id: number }>(
      `SELECT "id" FROM "Course" WHERE "code" = 'DEMO101'`,
    );
    const candidates = await findAllocationCandidates(asQueryClient(database), {
      courseId: course.rows[0]!.id,
      startsAt: new Date("2030-09-04T14:00:00.000Z"),
      endsAt: new Date("2030-09-04T16:00:00.000Z"),
      minimumMark: 50,
      requestedHours: 2,
    });

    expect(
      candidates.map(({ fullName, isEligible, reasonCodes }) => ({
        fullName,
        isEligible,
        reasonCodes,
      })),
    ).toEqual([
      { fullName: "Demo Tutor Pass", isEligible: true, reasonCodes: [] },
      {
        fullName: "Demo Tutor Clash",
        isEligible: false,
        reasonCodes: ["schedule-clash", "hour-limit-exceeded"],
      },
      {
        fullName: "Demo Tutor Low Mark",
        isEligible: false,
        reasonCodes: ["insufficient-mark"],
      },
    ]);
  });

  it("returns only open, future, unexpired work", async () => {
    const openWork = await listOpenWork(
      asQueryClient(database),
      new Date("2030-09-01T00:00:00.000Z"),
    );

    expect(openWork).toHaveLength(1);
    expect(openWork[0]).toMatchObject({
      courseCode: "DEMO101",
      hours: 2,
      status: "OPEN",
    });
    expect(openWork[0]).not.toHaveProperty("studentId");
    expect(openWork[0]).not.toHaveProperty("tutorId");
  });

  it("rejects invalid hours and wrong-role relationships", async () => {
    const ids = await database.query<{
      tutor_id: number;
      student_id: number;
      course_id: number;
    }>(`
      SELECT
        (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass') AS tutor_id,
        (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|student') AS student_id,
        (SELECT "id" FROM "Course" WHERE "code" = 'DEMO101') AS course_id;
    `);

    await expectDatabaseRejection(
      database,
      `INSERT INTO "Allocation" (
        "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours"
      ) VALUES ($1, $2, '2030-10-01 10:00', '2030-10-01 11:00', -1)`,
      [ids.rows[0]!.tutor_id, ids.rows[0]!.course_id],
    );
    await expectDatabaseRejection(
      database,
      `INSERT INTO "TutorMark" ("tutorId", "courseId", "mark")
       VALUES ($1, $2, 70)`,
      [ids.rows[0]!.student_id, ids.rows[0]!.course_id],
    );
  });

  it("rejects orphan and duplicate volunteer claims", async () => {
    const ids = await database.query<{ work_id: number; student_id: number }>(`
      SELECT
        (SELECT ow."id" FROM "OverflowWork" ow
          JOIN "Course" c ON c."id" = ow."courseId"
          WHERE c."code" = 'DEMO101' AND ow."status" = 'OPEN') AS work_id,
        (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|student') AS student_id;
    `);

    await expectDatabaseRejection(
      database,
      `INSERT INTO "VolunteerClaim" ("overflowWorkId", "studentId") VALUES (999999, $1)`,
      [ids.rows[0]!.student_id],
    );
    await expectDatabaseRejection(
      database,
      `INSERT INTO "VolunteerClaim" ("overflowWorkId", "studentId") VALUES ($1, $2)`,
      [ids.rows[0]!.work_id, ids.rows[0]!.student_id],
    );
  });

  it("rejects invalid workflow status transitions", async () => {
    const timesheet = await database.query<{ id: number }>(`
      SELECT t."id" FROM "Timesheet" t
      JOIN "Profile" p ON p."id" = t."tutorId"
      WHERE p."auth0Id" = 'demo|tutor-pass';
    `);

    await expectDatabaseRejection(
      database,
      `UPDATE "Timesheet" SET "status" = 'APPROVED' WHERE "id" = $1`,
      [timesheet.rows[0]!.id],
    );
  });

  it("rejects non-PROPOSED allocations without an organiser reviewer", async () => {
    const ids = await database.query<{ tutor_id: number; course_id: number }>(`
      SELECT
        (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass') AS tutor_id,
        (SELECT "id" FROM "Course" WHERE "code" = 'DEMO101') AS course_id;
    `);

    await expectDatabaseRejection(
      database,
      `INSERT INTO "Allocation" (
        "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours",
        "status", "reviewedById"
      ) VALUES ($1, $2, '2030-11-01 10:00', '2030-11-01 12:00', 2.00, 'CONFIRMED', NULL)`,
      [ids.rows[0]!.tutor_id, ids.rows[0]!.course_id],
    );
  });

  it("rejects a non-organiser profile as allocation reviewer", async () => {
    const ids = await database.query<{
      tutor_id: number;
      student_id: number;
      course_id: number;
    }>(`
      SELECT
        (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass') AS tutor_id,
        (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|student') AS student_id,
        (SELECT "id" FROM "Course" WHERE "code" = 'DEMO101') AS course_id;
    `);

    await expectDatabaseRejection(
      database,
      `INSERT INTO "Allocation" (
        "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours",
        "status", "reviewedById"
      ) VALUES ($1, $3, '2030-11-01 10:00', '2030-11-01 12:00', 2.00, 'CONFIRMED', $2)`,
      [ids.rows[0]!.tutor_id, ids.rows[0]!.student_id, ids.rows[0]!.course_id],
    );
  });

  it("seeds Sprint 2 timesheet and volunteer claim workflow states", async () => {
    const timesheets = await database.query<{
      week_start: string;
      status: string;
      review_reason: string | null;
    }>(`
      SELECT t."weekStart"::text AS week_start, t."status"::text AS status, t."reviewReason" AS review_reason
      FROM "Timesheet" t
      JOIN "Profile" p ON p."id" = t."tutorId"
      WHERE p."auth0Id" = 'demo|tutor-pass'
      ORDER BY t."weekStart";
    `);

    expect(timesheets.rows).toEqual([
      { week_start: "2030-09-02", status: "DRAFT", review_reason: null },
      { week_start: "2030-09-09", status: "SUBMITTED", review_reason: null },
      { week_start: "2030-09-16", status: "RETURNED", review_reason: "Please correct Tuesday hours" },
    ]);

    const claims = await database.query<{
      auth0_id: string;
      status: string;
    }>(`
      SELECT p."auth0Id" AS auth0_id, vc."status"::text AS status
      FROM "VolunteerClaim" vc
      JOIN "Profile" p ON p."id" = vc."studentId"
      JOIN "OverflowWork" ow ON ow."id" = vc."overflowWorkId"
      WHERE ow."startsAt" = TIMESTAMP '2030-09-09 10:00:00'
      ORDER BY p."auth0Id";
    `);

    expect(claims.rows).toEqual([
      { auth0_id: "demo|student", status: "ACCEPTED" },
      { auth0_id: "demo|student-race", status: "PENDING" },
    ]);
  });

  it("can recreate and seed a second clean database", async () => {
    const secondDatabase = new PGlite();
    try {
      await applyMigrations(secondDatabase);
      await seed(secondDatabase);
      const result = await secondDatabase.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "Profile" WHERE "auth0Id" LIKE 'demo|%'`,
      );
      expect(result.rows[0]?.count).toBe(6);
    } finally {
      await secondDatabase.close();
    }
  }, 30_000);
});

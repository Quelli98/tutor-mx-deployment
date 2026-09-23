import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

  it("keeps allocated hours inside the session window", async () => {
    const ids = await database.query<{ tutor_id: number; course_id: number }>(`
      SELECT
        (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass') AS tutor_id,
        (SELECT "id" FROM "Course" WHERE "code" = 'DEMO101') AS course_id;
    `);
    const tutorId = ids.rows[0]!.tutor_id;
    const courseId = ids.rows[0]!.course_id;

    const insert = (day: string, hours: string) =>
      database.query(
        `INSERT INTO "Allocation" (
          "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours"
        ) VALUES ($1, $2, '${day} 10:00', '${day} 12:00', ${hours})`,
        [tutorId, courseId],
      );

    // Hours longer than the two-hour window are refused however plausible they
    // look on their own: both the capacity check and the staffing shortage add
    // these up, so an inflated value corrupts them.
    await expect(insert("2031-03-02", "20")).rejects.toBeDefined();
    await expect(insert("2031-03-03", "2.25")).rejects.toBeDefined();

    // Exactly the window, and less than it, both stay allowed: a tutor may work
    // two hours inside a longer block.
    await expect(insert("2031-03-04", "2")).resolves.toBeDefined();
    await expect(insert("2031-03-05", "0.5")).resolves.toBeDefined();
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

describe("Calendar candidate SQL regression", () => {
  let database: PGlite;
  let tutorId: number;
  let courseId: number;
  let organiserId: number;
  const instant = (date: string) => new Date(`${date}:00+02:00`);
  const timestamp = (date: string) => instant(date).toISOString().replace("T", " ").replace("Z", "");

  beforeAll(async () => {
    database = new PGlite();
    await applyMigrations(database);
    await seed(database);
    const ids = await database.query<{ tutor: number; course: number; organiser: number }>(`SELECT
      (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass') AS tutor,
      (SELECT "id" FROM "Course" WHERE "code" = 'DEMO101') AS course,
      (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|organiser') AS organiser`);
    ({ tutor: tutorId, course: courseId, organiser: organiserId } = ids.rows[0]!);
  }, 30_000);
  beforeEach(async () => {
    await database.exec('BEGIN');
    await database.query('UPDATE "TutorHourLimit" SET "weeklyHours" = 15 WHERE "tutorId" = $1', [tutorId]);
  });
  afterEach(async () => { await database.exec('ROLLBACK'); });
  afterAll(async () => { await database.close(); });

  async function busy(start: string, end: string, recurrence: string | null = "WEEKLY", until: string | null = null) {
    await database.query(`INSERT INTO "TimeSlot" ("tutorId", "type", "startsAt", "endsAt", "recurrence", "label", "recurrenceUntil")
      VALUES ($1, 'BUSY', $2, $3, $4, 'COMS3011 Lecture', $5)`,
    [tutorId, timestamp(start), timestamp(end), recurrence, until ? timestamp(until) : null]);
  }

  async function candidate(start = "2026-09-14T08:00", end = "2026-09-14T10:45", excludeAllocationId?: number) {
    const rows = await findAllocationCandidates(asQueryClient(database), {
      courseId, startsAt: instant(start), endsAt: instant(end), minimumMark: 65, requestedHours: 2.75,
      ...(excludeAllocationId === undefined ? {} : { excludeAllocationId }),
    });
    return rows.find((row) => row.tutorId === tutorId);
  }

  it("passes Monday 08:00–10:45 with the exact seven-block busy timetable", async () => {
    for (const [day, start, end] of [
      ['14', '14:15', '17:00'], ['15', '14:15', '17:00'], ['16', '08:00', '09:45'],
      ['17', '08:00', '09:45'], ['17', '10:15', '12:00'], ['18', '10:15', '12:00'], ['18', '12:30', '13:15'],
    ]) await busy(`2026-09-${day}T${start}`, `2026-09-${day}T${end}`);
    expect(await candidate()).toMatchObject({ hasClash: false, isEligible: true, reasonCodes: [], clashDetails: [] });
    expect(await candidate('2026-09-21T08:00', '2026-09-21T10:45')).toMatchObject({ hasClash: false, isEligible: true, reasonCodes: [] });
    expect(await candidate('2026-09-24T08:00', '2026-09-24T09:00')).toMatchObject({
      hasClash: true, isEligible: false, reasonCodes: ['schedule-clash'],
      clashDetails: [{ kind: 'busy', label: 'COMS3011 Lecture', startsAt: '2026-09-24T06:00:00.000Z', endsAt: '2026-09-24T07:45:00.000Z', recurrence: 'WEEKLY' }],
    });
  });

  it.each([
    ['same-day overlap', '2026-09-14T09:00', '2026-09-14T11:00', null, null, true],
    ['touching end', '2026-09-14T10:45', '2026-09-14T12:00', 'WEEKLY', null, false],
    ['touching start', '2026-09-14T07:00', '2026-09-14T08:00', 'WEEKLY', null, false],
    ['different weekday', '2026-09-15T08:00', '2026-09-15T10:00', 'WEEKLY', null, false],
    ['once-off other date', '2026-09-07T08:00', '2026-09-07T10:00', 'ONCE', null, false],
    ['once-off same date', '2026-09-14T08:00', '2026-09-14T10:00', 'ONCE', null, true],
    ['weekly same weekday', '2026-09-07T08:00', '2026-09-07T10:00', 'WEEKLY', null, true],
    ['outside recurrence end', '2026-09-07T08:00', '2026-09-07T10:00', 'WEEKLY', '2026-09-07T08:00', false],
    ['inclusive recurrence end', '2026-09-07T08:00', '2026-09-07T10:00', 'WEEKLY', '2026-09-14T08:00', true],
    ['before recurrence start', '2026-09-21T08:00', '2026-09-21T10:00', 'WEEKLY', null, false],
  ] as const)('%s uses half-open timetable intervals', async (_name, start, end, recurrence, until, clash) => {
    await busy(start, end, recurrence, until);
    expect(await candidate()).toMatchObject({ hasClash: clash, isEligible: !clash, reasonCodes: clash ? ['schedule-clash'] : [] });
  });

  it.each(['PROPOSED', 'CONFIRMED', 'CANCELLED'] as const)('%s allocations only hard-block when confirmed and exclude themselves on edit', async (status) => {
    const inserted = await database.query<{ id: number }>(`INSERT INTO "Allocation" ("tutorId", "courseId", "startsAt", "endsAt", "allocatedHours")
      VALUES ($1, $2, $3, $4, 2.75) RETURNING "id"`, [tutorId, courseId, timestamp('2026-09-14T08:00'), timestamp('2026-09-14T10:45')]);
    const id = inserted.rows[0]!.id;
    if (status !== 'PROPOSED') await database.query(`UPDATE "Allocation" SET "status" = $2::"AllocationStatus", "reviewedAt" = CURRENT_TIMESTAMP, "reviewedById" = $3 WHERE "id" = $1`, [id, status, organiserId]);
    expect(await candidate()).toMatchObject({ hasClash: status === 'CONFIRMED', isEligible: status !== 'CONFIRMED' });
    expect(await candidate('2026-09-14T08:00', '2026-09-14T10:45', id)).toMatchObject({ hasClash: false, isEligible: true, usedHours: 0, reasonCodes: [] });
  });

  it('keeps missing and insufficient marks separate from schedule and capacity', async () => {
    await database.query('UPDATE "TutorMark" SET "mark" = 64 WHERE "tutorId" = $1 AND "courseId" = $2', [tutorId, courseId]);
    expect(await candidate()).toMatchObject({ hasClash: false, isEligible: false, reasonCodes: ['insufficient-mark'] });
    await database.query('DELETE FROM "TutorMark" WHERE "tutorId" = $1 AND "courseId" = $2', [tutorId, courseId]);
    expect(await candidate()).toBeUndefined();
  });

  it('fails capacity independently on a free timetable', async () => {
    await database.query('UPDATE "TutorHourLimit" SET "weeklyHours" = 2 WHERE "tutorId" = $1', [tutorId]);
    expect(await candidate()).toMatchObject({ hasClash: false, isEligible: false, reasonCodes: ['hour-limit-exceeded'] });
  });
});

describe("Sprint 2 stability corrections", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await applyMigrations(database);
    await seed(database);
  }, 30_000);

  afterAll(async () => {
    await database.close();
  });

  async function demoIds(): Promise<{ tutorId: number; courseId: number }> {
    const ids = await database.query<{ tutor_id: number; course_id: number }>(`
      SELECT
        (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass') AS tutor_id,
        (SELECT "id" FROM "Course" WHERE "code" = 'DEMO101') AS course_id;
    `);
    return {
      tutorId: ids.rows[0]!.tutor_id,
      courseId: ids.rows[0]!.course_id,
    };
  }

  it("treats a WEEKLY busy slot as a clash on later-week occurrences only", async () => {
    const { tutorId, courseId } = await demoIds();
    // A WEEKLY busy slot whose first occurrence is a fortnight before the query.
    await database.query(
      `INSERT INTO "TimeSlot" ("tutorId", "type", "startsAt", "endsAt", "recurrence")
       VALUES ($1, 'BUSY', '2030-10-02 14:00', '2030-10-02 16:00', 'WEEKLY')`,
      [tutorId],
    );

    const clashing = await findAllocationCandidates(asQueryClient(database), {
      courseId,
      startsAt: new Date("2030-10-16T14:00:00.000Z"),
      endsAt: new Date("2030-10-16T16:00:00.000Z"),
      minimumMark: 50,
      requestedHours: 2,
    });
    expect(
      clashing.find((c) => c.fullName === "Demo Tutor Pass")?.reasonCodes,
    ).toContain("schedule-clash");

    // The same weekday two weeks on, but a non-overlapping time, must not clash.
    const clear = await findAllocationCandidates(asQueryClient(database), {
      courseId,
      startsAt: new Date("2030-10-16T16:00:00.000Z"),
      endsAt: new Date("2030-10-16T18:00:00.000Z"),
      minimumMark: 50,
      requestedHours: 2,
    });
    expect(
      clear.find((c) => c.fullName === "Demo Tutor Pass")?.reasonCodes,
    ).not.toContain("schedule-clash");
  });

  it("keys the decided-allocation audit on reviewedAt so a reviewer link can be cleared", async () => {
    const { tutorId, courseId } = await demoIds();
    const organiser = await database.query<{ id: number }>(
      `SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|organiser'`,
    );
    const organiserId = organiser.rows[0]!.id;

    // Allocations must start PROPOSED, then transition to CONFIRMED.
    const inserted = await database.query<{ id: number }>(
      `INSERT INTO "Allocation" (
         "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours", "status"
       ) VALUES ($1, $2, '2030-12-01 10:00', '2030-12-01 12:00', 2.00, 'PROPOSED')
       RETURNING "id"`,
      [tutorId, courseId],
    );
    const allocationId = inserted.rows[0]!.id;
    await database.query(
      `UPDATE "Allocation"
         SET "status" = 'CONFIRMED', "reviewedById" = $2, "reviewedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [allocationId, organiserId],
    );

    // Simulate the FK ON DELETE SET NULL clearing the reviewer link: the
    // decision timestamp survives, so the audit invariant still holds and the
    // update succeeds (the old reviewedById-based CHECK would have failed here).
    await expect(
      database.query(
        `UPDATE "Allocation" SET "reviewedById" = NULL WHERE "id" = $1`,
        [allocationId],
      ),
    ).resolves.toBeDefined();

    // Clearing the decision timestamp on a decided allocation is still rejected.
    await expectDatabaseRejection(
      database,
      `UPDATE "Allocation" SET "reviewedAt" = NULL WHERE "id" = $1`,
      [allocationId],
    );
  });

  it("refreshes submittedAt on resubmission but honours an explicit value", async () => {
    const timesheet = await database.query<{ id: number }>(`
      SELECT t."id" FROM "Timesheet" t
      JOIN "Profile" p ON p."id" = t."tutorId"
      WHERE p."auth0Id" = 'demo|tutor-pass' AND t."weekStart" = DATE '2030-09-16';
    `);
    const id = timesheet.rows[0]!.id;

    // Pin an obviously stale submission time without changing status so the
    // transition branch of the trigger does not fire.
    await database.query(
      `UPDATE "Timesheet" SET "submittedAt" = TIMESTAMP '2020-01-01 00:00:00' WHERE "id" = $1`,
      [id],
    );
    await database.query(
      `UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = $1`,
      [id],
    );
    const refreshed = await database.query<{ submittedAt: string | Date }>(
      `SELECT "submittedAt" FROM "Timesheet" WHERE "id" = $1`,
      [id],
    );
    expect(
      new Date(refreshed.rows[0]!.submittedAt).getUTCFullYear(),
    ).toBeGreaterThan(2020);

    // Return it, then resubmit supplying a deliberate timestamp: it must win.
    await database.query(
      `UPDATE "Timesheet" SET "status" = 'RETURNED', "reviewReason" = 'again' WHERE "id" = $1`,
      [id],
    );
    await database.query(
      `UPDATE "Timesheet" SET "status" = 'SUBMITTED', "submittedAt" = TIMESTAMP '2035-06-01 09:00:00' WHERE "id" = $1`,
      [id],
    );
    const explicit = await database.query<{ submittedAt: string | Date }>(
      `SELECT "submittedAt" FROM "Timesheet" WHERE "id" = $1`,
      [id],
    );
    expect(new Date(explicit.rows[0]!.submittedAt).getUTCFullYear()).toBe(2035);
  });

  it("safely deletes a course whose only dependants are disposable setup data", async () => {
    const { tutorId } = await demoIds();
    const created = await database.query<{ id: number }>(
      `INSERT INTO "Course" ("code", "name") VALUES ('DELSAFE1', 'Disposable Course') RETURNING "id"`,
    );
    const courseId = created.rows[0]!.id;
    await database.query(
      `INSERT INTO "TutorMark" ("tutorId", "courseId", "mark") VALUES ($1, $2, 70.00)`,
      [tutorId, courseId],
    );
    await database.query(
      `INSERT INTO "Allocation" ("tutorId", "courseId", "startsAt", "endsAt", "allocatedHours", "status")
       VALUES ($1, $2, '2031-01-05 10:00', '2031-01-05 12:00', 2.00, 'PROPOSED')`,
      [tutorId, courseId],
    );
    await database.query(
      `INSERT INTO "OverflowWork" ("courseId", "startsAt", "endsAt", "hours", "status")
       VALUES ($1, '2031-01-06 10:00', '2031-01-06 12:00', 2.00, 'OPEN')`,
      [courseId],
    );

    // Delete disposable children in the same order the service uses, then the
    // course itself: every ON DELETE Restrict foreign key stays satisfied.
    await database.query(`DELETE FROM "OverflowWork" WHERE "courseId" = $1`, [
      courseId,
    ]);
    await database.query(`DELETE FROM "Allocation" WHERE "courseId" = $1`, [
      courseId,
    ]);
    await database.query(`DELETE FROM "TutorMark" WHERE "courseId" = $1`, [
      courseId,
    ]);
    await expect(
      database.query(`DELETE FROM "Course" WHERE "id" = $1`, [courseId]),
    ).resolves.toBeDefined();

    const remaining = await database.query(
      `SELECT "id" FROM "Course" WHERE "id" = $1`,
      [courseId],
    );
    expect(remaining.rows).toHaveLength(0);
  });

  it("protects logged work with a Restrict foreign key so course history cannot be dropped", async () => {
    const { tutorId } = await demoIds();
    const created = await database.query<{ id: number }>(
      `INSERT INTO "Course" ("code", "name") VALUES ('DELHIST1', 'Historical Course') RETURNING "id"`,
    );
    const courseId = created.rows[0]!.id;
    const organiser = await database.query<{ id: number }>(
      `SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|organiser'`,
    );
    const organiserId = organiser.rows[0]!.id;
    const allocation = await database.query<{ id: number }>(
      `INSERT INTO "Allocation" ("tutorId", "courseId", "startsAt", "endsAt", "allocatedHours", "status")
       VALUES ($1, $2, '2031-02-05 10:00', '2031-02-05 12:00', 2.00, 'PROPOSED') RETURNING "id"`,
      [tutorId, courseId],
    );
    const allocationId = allocation.rows[0]!.id;
    // A work log is auditable history and may only attach to a confirmed
    // allocation owned by the tutor, so confirm it before recording work.
    await database.query(
      `UPDATE "Allocation"
         SET "status" = 'CONFIRMED', "reviewedById" = $2, "reviewedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [allocationId, organiserId],
    );
    await database.query(
      `INSERT INTO "WorkLog" ("tutorId", "allocationId", "workDate", "hours", "description")
       VALUES ($1, $2, '2031-02-05', 2.00, 'Recorded tutorial')`,
      [tutorId, allocationId],
    );

    // The database itself refuses to drop the allocation (and therefore the
    // course) while a work log references it, which is why the service inspects
    // and blocks instead of leaning on a raw foreign-key error.
    await expectDatabaseRejection(
      database,
      `DELETE FROM "Allocation" WHERE "id" = $1`,
      [allocationId],
    );
    await expectDatabaseRejection(
      database,
      `DELETE FROM "Course" WHERE "id" = $1`,
      [courseId],
    );

    const stillThere = await database.query(
      `SELECT "id" FROM "Course" WHERE "id" = $1`,
      [courseId],
    );
    expect(stillThere.rows).toHaveLength(1);
  });
});

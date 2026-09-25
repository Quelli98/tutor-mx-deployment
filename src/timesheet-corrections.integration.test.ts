import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * S3-M3-2 against the real engine.
 *
 * The service tests prove what the code decides; these prove what PostgreSQL
 * enforces, because the rules a correction has to obey are enforced by
 * migrations and triggers rather than by the service that usually calls them.
 * Every case here goes around the service on purpose.
 */

const migrationsPath = fileURLToPath(
  new URL("../prisma/migrations", import.meta.url),
);
const seedPath = fileURLToPath(new URL("../prisma/seed.sql", import.meta.url));

async function applyMigrations(database: PGlite): Promise<void> {
  const migrationDirectories = (
    await readdir(migrationsPath, { withFileTypes: true })
  )
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

const ORGANISER = "demo|organiser";
const TUTOR = "demo|tutor-pass";
const OTHER_TUTOR = "demo|tutor-clash";

async function profileId(database: PGlite, auth0Id: string): Promise<number> {
  const result = await database.query<{ id: number }>(
    `SELECT "id" FROM "Profile" WHERE "auth0Id" = $1`,
    [auth0Id],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`No seeded profile for ${auth0Id}`);
  }
  return id;
}

interface SheetFixture {
  timesheetId: number;
  workLogId: number;
  allocationId: number;
}

/**
 * Builds the smallest legal week for a tutor: a confirmed allocation, a draft
 * timesheet for that week, and the work log that session produced. Each test
 * uses its own week so the fixtures cannot interfere with each other.
 */
async function createSheet(
  database: PGlite,
  options: {
    tutorId: number;
    weekStart: string;
    workDate?: string;
    hours?: number;
    description?: string;
  },
): Promise<SheetFixture> {
  const workDate = options.workDate ?? options.weekStart;
  const allocation = await database.query<{ id: number }>(
    `INSERT INTO "Allocation" (
       "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours", "status"
     )
     SELECT $1, c."id",
            ($2::date + TIME '10:00')::timestamp,
            ($2::date + TIME '12:00')::timestamp,
            2.00, 'PROPOSED'
     FROM "Course" c
     WHERE c."code" = 'DEMO101'
     RETURNING "id"`,
    [options.tutorId, workDate],
  );
  const allocationId = allocation.rows[0]!.id;
  await database.query(
    `UPDATE "Allocation"
       SET "status" = 'CONFIRMED',
           "reviewedById" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = $2),
           "reviewedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [allocationId, ORGANISER],
  );

  const sheet = await database.query<{ id: number }>(
    `INSERT INTO "Timesheet" ("tutorId", "weekStart")
     VALUES ($1, $2::date)
     RETURNING "id"`,
    [options.tutorId, options.weekStart],
  );
  const timesheetId = sheet.rows[0]!.id;

  const workLog = await database.query<{ id: number }>(
    `INSERT INTO "WorkLog" (
       "tutorId", "allocationId", "timesheetId", "workDate", "hours", "description"
     ) VALUES ($1, $2, $3, $4::date, $5::decimal, $6)
     RETURNING "id"`,
    [
      options.tutorId,
      allocationId,
      timesheetId,
      workDate,
      options.hours ?? 2,
      options.description ?? "Demo tutorial session",
    ],
  );

  return { timesheetId, workLogId: workLog.rows[0]!.id, allocationId };
}

async function submitTimesheet(
  database: PGlite,
  timesheetId: number,
): Promise<void> {
  await database.query(
    `UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = $1`,
    [timesheetId],
  );
}

// The declaration gate compares moments rather than dates, so a case that has
// to sit before or after another row places itself a known number of minutes
// away from the real clock instead of naming a date that the calendar could
// overtake. Negative values land in the future.
async function returnTimesheet(
  database: PGlite,
  timesheetId: number,
  reason = "Please correct Tuesday hours",
  minutes = 0,
): Promise<void> {
  await database.query(
    `UPDATE "Timesheet"
       SET "status" = 'RETURNED',
           "reviewReason" = $2,
           "reviewedById" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = $3),
           "reviewedAt" = CURRENT_TIMESTAMP - make_interval(mins => $4::int)
     WHERE "id" = $1`,
    [timesheetId, reason, ORGANISER, minutes],
  );
}

async function declare(
  database: PGlite,
  timesheetId: number,
  tutorId: number,
  minutes = 0,
): Promise<void> {
  await database.query(
    `INSERT INTO "TimesheetDeclaration" (
       "timesheetId", "tutorId", "statementVersion", "declaredAt"
     ) VALUES ($1, $2, 's3-m3-v1', CURRENT_TIMESTAMP - make_interval(mins => $3::int))`,
    [timesheetId, tutorId, minutes],
  );
}

async function countRevisions(
  database: PGlite,
  timesheetId: number,
  kind: "RETURN" | "CORRECTION",
): Promise<number> {
  const result = await database.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM "TimesheetRevision"
     WHERE "timesheetId" = $1 AND "kind" = $2::"TimesheetRevisionKind"`,
    [timesheetId, kind],
  );
  return result.rows[0]?.count ?? 0;
}

describe("timesheet corrections against the real schema", () => {
  let database: PGlite;
  let tutorId: number;
  let otherTutorId: number;

  beforeAll(async () => {
    database = new PGlite();
    await applyMigrations(database);
    await database.exec(await readFile(seedPath, "utf8"));
    tutorId = await profileId(database, TUTOR);
    otherTutorId = await profileId(database, OTHER_TUTOR);
  });

  afterAll(async () => {
    await database.close();
  });

  it("creates the correction history, declaration and dispute tables", async () => {
    const result = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'TimesheetRevision', 'TimesheetDeclaration', 'TimesheetDispute'
        )
      ORDER BY table_name;
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "TimesheetDeclaration",
      "TimesheetDispute",
      "TimesheetRevision",
    ]);
  });

  it("refuses to change the work log of a submitted timesheet", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-10-07",
    });
    await submitTimesheet(database, sheet.timesheetId);

    await expect(
      database.query(
        `UPDATE "WorkLog" SET "hours" = 1.50 WHERE "id" = $1`,
        [sheet.workLogId],
      ),
    ).rejects.toThrow(/work logs can only change on draft or returned timesheets/);
  });

  it("allows the correction a return asked for, and keeps both figures", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-10-14",
    });
    await submitTimesheet(database, sheet.timesheetId);
    await returnTimesheet(database, sheet.timesheetId);

    await database.query(
      `UPDATE "WorkLog" SET "hours" = 1.50, "description" = 'Shortened session'
       WHERE "id" = $1`,
      [sheet.workLogId],
    );
    // The edit is refused on its own: the history has to be written beside it,
    // with the values it replaced, or the correction is not allowed to stand.
    await expect(
      database.query(
        `INSERT INTO "TimesheetRevision" (
           "timesheetId", "tutorId", "kind", "workLogId", "authorProfileId",
           "reason", "previousHours", "previousDescription",
           "newHours", "newDescription"
         ) VALUES ($1, $2, 'CORRECTION', $3, $2, 'Please correct Tuesday hours',
                   2.00, 'Demo tutorial session', 1.50, 'Shortened session')`,
        [sheet.timesheetId, tutorId, sheet.workLogId],
      ),
    ).resolves.toBeDefined();

    const revision = await database.query<{
      previous_hours: string;
      new_hours: string;
      previous_description: string;
      new_description: string;
      work_log_hours: string;
    }>(
      `SELECT r."previousHours"::text AS previous_hours,
              r."newHours"::text AS new_hours,
              r."previousDescription" AS previous_description,
              r."newDescription" AS new_description,
              w."hours"::text AS work_log_hours
       FROM "TimesheetRevision" r
       JOIN "WorkLog" w ON w."id" = r."workLogId"
       WHERE r."timesheetId" = $1 AND r."kind" = 'CORRECTION'`,
      [sheet.timesheetId],
    );

    // The work log moved on; the record of what it used to say did not.
    expect(revision.rows[0]).toEqual({
      previous_hours: "2.00",
      new_hours: "1.50",
      previous_description: "Demo tutorial session",
      new_description: "Shortened session",
      work_log_hours: "1.50",
    });
  });

  it("refuses a correction that dropped the values it replaced", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-10-21",
    });
    await submitTimesheet(database, sheet.timesheetId);
    await returnTimesheet(database, sheet.timesheetId);

    await expect(
      database.query(
        `INSERT INTO "TimesheetRevision" (
           "timesheetId", "tutorId", "kind", "workLogId", "authorProfileId",
           "reason", "newHours", "newDescription"
         ) VALUES ($1, $2, 'CORRECTION', $3, $2, 'Please correct Tuesday hours',
                   1.50, 'Shortened session')`,
        [sheet.timesheetId, tutorId, sheet.workLogId],
      ),
    ).rejects.toThrow(/TimesheetRevision_correction_shape/);
  });

  it("refuses a return with no reason to read", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-10-28",
    });
    await submitTimesheet(database, sheet.timesheetId);
    await returnTimesheet(database, sheet.timesheetId);

    await expect(
      database.query(
        `INSERT INTO "TimesheetRevision" (
           "timesheetId", "tutorId", "kind", "authorProfileId", "reason"
         ) VALUES ($1, $2, 'RETURN', (SELECT "id" FROM "Profile" WHERE "auth0Id" = $3), '   ')`,
        [sheet.timesheetId, tutorId, ORGANISER],
      ),
    ).rejects.toThrow(/TimesheetRevision_return_reason/);
  });

  it("will not let a returned timesheet exist without a review moment", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-11-04",
    });
    await submitTimesheet(database, sheet.timesheetId);

    await expect(
      database.query(
        `UPDATE "Timesheet"
           SET "status" = 'RETURNED', "reviewReason" = 'Incomplete'
         WHERE "id" = $1`,
        [sheet.timesheetId],
      ),
    ).rejects.toThrow(/Timesheet_returned_when_reviewed/);
  });

  it("refuses a resubmission with no declaration at all", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-11-11",
    });
    await submitTimesheet(database, sheet.timesheetId);
    await returnTimesheet(database, sheet.timesheetId);

    await expect(
      database.query(
        `UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = $1`,
        [sheet.timesheetId],
      ),
    ).rejects.toThrow(/a returned timesheet needs a declaration/);
  });

  it("refuses a declaration that predates the return it answers", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-11-18",
    });
    // Declared an hour before the return: the acknowledgement covers what was
    // sent the first time, not the figures the return asked for.
    await declare(database, sheet.timesheetId, tutorId, 60);
    await submitTimesheet(database, sheet.timesheetId);
    await returnTimesheet(database, sheet.timesheetId);

    await expect(
      database.query(
        `UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = $1`,
        [sheet.timesheetId],
      ),
    ).rejects.toThrow(/a returned timesheet needs a declaration/);
  });

  it("refuses a resubmission of figures corrected after the declaration", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-11-25",
    });
    await submitTimesheet(database, sheet.timesheetId);
    // Returned ten minutes ago, acknowledged five minutes ago: the ordering is
    // what the gate reads, so the offsets are explicit rather than implied.
    await returnTimesheet(
      database,
      sheet.timesheetId,
      "Please correct Tuesday hours",
      10,
    );
    await declare(database, sheet.timesheetId, tutorId, 5);
    // The tutor declares, then keeps editing: the acknowledgement no longer
    // covers what would be sent, so the resubmission has to be refused.
    await database.query(
      `INSERT INTO "TimesheetRevision" (
         "timesheetId", "tutorId", "kind", "workLogId", "authorProfileId",
         "reason", "previousHours", "previousDescription",
         "newHours", "newDescription", "createdAt"
       ) VALUES ($1, $2, 'CORRECTION', $3, $2, 'Please correct Tuesday hours',
                 2.00, 'Demo tutorial session', 1.50, 'Shortened session',
                 CURRENT_TIMESTAMP - INTERVAL '1 minute')`,
      [sheet.timesheetId, tutorId, sheet.workLogId],
    );

    await expect(
      database.query(
        `UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = $1`,
        [sheet.timesheetId],
      ),
    ).rejects.toThrow(/a returned timesheet needs a declaration/);

    // Declaring again after the correction clears the objection.
    await declare(database, sheet.timesheetId, tutorId);
    await expect(
      database.query(
        `UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = $1`,
        [sheet.timesheetId],
      ),
    ).resolves.toBeDefined();
  });

  it("survives several return cycles and keeps every reason", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-12-02",
    });
    await submitTimesheet(database, sheet.timesheetId);

    // First cycle: returned ten minutes ago, acknowledged five minutes ago.
    await returnTimesheet(
      database,
      sheet.timesheetId,
      "Hours look too high",
      10,
    );
    // The return trigger records history atomically.
    await declare(database, sheet.timesheetId, tutorId, 5);
    // Mirrors the workflow service on the way back, which clears the reviewer's
    // fields so the sheet reads as freshly submitted.
    await database.query(
      `UPDATE "Timesheet"
         SET "status" = 'SUBMITTED',
             "submittedAt" = CURRENT_TIMESTAMP,
             "reviewedAt" = NULL,
             "reviewedById" = NULL,
             "reviewReason" = NULL
       WHERE "id" = $1`,
      [sheet.timesheetId],
    );

    // The sheet no longer carries the reason, so the revision is all that is
    // left of it.
    const cleared = await database.query<{ review_reason: string | null }>(
      `SELECT "reviewReason" AS review_reason FROM "Timesheet" WHERE "id" = $1`,
      [sheet.timesheetId],
    );
    expect(cleared.rows[0]?.review_reason).toBeNull();
    const kept = await database.query<{ reason: string }>(
      `SELECT "reason" FROM "TimesheetRevision"
       WHERE "timesheetId" = $1 AND "kind" = 'RETURN' ORDER BY "id"`,
      [sheet.timesheetId],
    );
    expect(kept.rows.map((row) => row.reason)).toEqual([
      "Hours look too high",
    ]);

    // Second cycle, returned just now.
    await returnTimesheet(database, sheet.timesheetId, "Still not right");
    // The return trigger records history atomically.

    const reasons = await database.query<{ reason: string }>(
      `SELECT "reason" FROM "TimesheetRevision"
       WHERE "timesheetId" = $1 AND "kind" = 'RETURN'
       ORDER BY "id"`,
      [sheet.timesheetId],
    );
    expect(reasons.rows.map((row) => row.reason)).toEqual([
      "Hours look too high",
      "Still not right",
    ]);
    expect(await countRevisions(database, sheet.timesheetId, "RETURN")).toBe(2);

    // The acknowledgement from the first cycle is older than this return, so it
    // does not authorise the second resubmission.
    await expect(
      database.query(
        `UPDATE "Timesheet" SET "status" = 'SUBMITTED' WHERE "id" = $1`,
        [sheet.timesheetId],
      ),
    ).rejects.toThrow(/a returned timesheet needs a declaration/);
  });

  it("refuses to delete the work log a correction points at", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-12-09",
    });
    await submitTimesheet(database, sheet.timesheetId);
    await returnTimesheet(database, sheet.timesheetId);
    await database.query(
      `INSERT INTO "TimesheetRevision" (
         "timesheetId", "tutorId", "kind", "workLogId", "authorProfileId",
         "reason", "previousHours", "previousDescription",
         "newHours", "newDescription"
       ) VALUES ($1, $2, 'CORRECTION', $3, $2, 'Please correct Tuesday hours',
                 2.00, 'Demo tutorial session', 1.50, 'Shortened session')`,
      [sheet.timesheetId, tutorId, sheet.workLogId],
    );

    // The revision is the record of what the work log used to say, so the work
    // log cannot be removed while that record stands.
    await expect(
      database.query(`DELETE FROM "WorkLog" WHERE "id" = $1`, [
        sheet.workLogId,
      ]),
    ).rejects.toThrow(/TimesheetRevision_workLogId_fkey/);
  });

  it("refuses to delete a timesheet that still has history", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2031-01-20",
    });
    await submitTimesheet(database, sheet.timesheetId);
    await returnTimesheet(database, sheet.timesheetId);
    await database.query(
      `INSERT INTO "TimesheetRevision" (
         "timesheetId", "tutorId", "kind", "authorProfileId", "reason"
       ) VALUES ($1, $2, 'RETURN', (SELECT "id" FROM "Profile" WHERE "auth0Id" = $3), 'Please correct Tuesday hours')`,
      [sheet.timesheetId, tutorId, ORGANISER],
    );
    // A return revision names the sheet rather than a work log, so the work log
    // goes first and leaves the sheet itself as the only thing on the line.
    await database.query(`DELETE FROM "WorkLog" WHERE "id" = $1`, [
      sheet.workLogId,
    ]);

    await expect(
      database.query(`DELETE FROM "Timesheet" WHERE "id" = $1`, [
        sheet.timesheetId,
      ]),
    ).rejects.toThrow(/TimesheetRevision_timesheetId_tutorId_fkey/);
  });

  it("refuses a work log that belongs to another tutor's allocation", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-12-16",
    });
    const foreign = await database.query<{ id: number }>(
      `SELECT "id" FROM "Allocation" WHERE "tutorId" = $1 LIMIT 1`,
      [otherTutorId],
    );

    await expect(
      database.query(
        `UPDATE "WorkLog" SET "allocationId" = $2 WHERE "id" = $1`,
        [sheet.workLogId, foreign.rows[0]!.id],
      ),
    ).rejects.toThrow(/work logs require a confirmed allocation owned by the tutor/);
  });

  it("refuses a correction that breaks the weekly hours limit", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-12-23",
    });
    await submitTimesheet(database, sheet.timesheetId);
    await returnTimesheet(database, sheet.timesheetId);

    // The seeded tutor limit is 8.00 hours, so the database has the last word
    // even when the figure reaches the update without being checked.
    await expect(
      database.query(`UPDATE "WorkLog" SET "hours" = 9.00 WHERE "id" = $1`, [
        sheet.workLogId,
      ]),
    ).rejects.toThrow(/weekly work log hours exceed the tutor limit/);
  });

  it("allows only one open objection per timesheet", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2030-12-30",
    });
    await submitTimesheet(database, sheet.timesheetId);

    await database.query(
      `INSERT INTO "TimesheetDispute" (
         "timesheetId", "tutorId", "reason", "raisedByProfileId"
       ) VALUES ($1, $2, 'The first objection', $2)`,
      [sheet.timesheetId, tutorId],
    );

    await expect(
      database.query(
        `INSERT INTO "TimesheetDispute" (
           "timesheetId", "tutorId", "reason", "raisedByProfileId"
         ) VALUES ($1, $2, 'A second objection', $2)`,
        [sheet.timesheetId, tutorId],
      ),
    ).rejects.toThrow(/TimesheetDispute_one_open_per_sheet/);

    // Once it is answered, the tutor may object again: the history of the first
    // one is kept rather than replaced.
    await database.query(
      `UPDATE "TimesheetDispute"
         SET "status" = 'RESOLVED',
             "resolutionReason" = 'Agreed with the tutor',
             "resolvedByProfileId" = (SELECT "id" FROM "Profile" WHERE "auth0Id" = $2),
             "resolvedAt" = CURRENT_TIMESTAMP
       WHERE "timesheetId" = $1`,
      [sheet.timesheetId, ORGANISER],
    );
    await expect(
      database.query(
        `INSERT INTO "TimesheetDispute" (
           "timesheetId", "tutorId", "reason", "raisedByProfileId"
         ) VALUES ($1, $2, 'A second objection', $2)`,
        [sheet.timesheetId, tutorId],
      ),
    ).resolves.toBeDefined();

    const disputes = await database.query<{ status: string }>(
      `SELECT "status"::text AS status FROM "TimesheetDispute"
       WHERE "timesheetId" = $1 ORDER BY "id"`,
      [sheet.timesheetId],
    );
    expect(disputes.rows.map((row) => row.status)).toEqual([
      "RESOLVED",
      "OPEN",
    ]);
  });

  it("refuses a closed dispute with no answer on it", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2031-01-06",
    });
    await submitTimesheet(database, sheet.timesheetId);

    await expect(
      database.query(
        `INSERT INTO "TimesheetDispute" (
           "timesheetId", "tutorId", "reason", "status", "raisedByProfileId"
         ) VALUES ($1, $2, 'Objection', 'RESOLVED', $2)`,
        [sheet.timesheetId, tutorId],
      ),
    ).rejects.toThrow(/TimesheetDispute_resolution/);
  });

  it("keeps the parent's tutor on a correction, so ownership cannot drift", async () => {
    const sheet = await createSheet(database, {
      tutorId,
      weekStart: "2031-01-13",
    });
    await submitTimesheet(database, sheet.timesheetId);
    await returnTimesheet(database, sheet.timesheetId);

    await expect(
      database.query(
        `INSERT INTO "TimesheetRevision" (
           "timesheetId", "tutorId", "kind", "authorProfileId", "reason"
         ) VALUES ($1, $2, 'RETURN', (SELECT "id" FROM "Profile" WHERE "auth0Id" = $3), 'Wrong owner')`,
        [sheet.timesheetId, otherTutorId, ORGANISER],
      ),
    ).rejects.toThrow(/TimesheetRevision_timesheetId_tutorId_fkey/);
  });
  it("rolls back the return decision and its automatic history together", async () => {
    const sheet = await createSheet(database, { tutorId, weekStart: "2032-01-05" });
    await submitTimesheet(database, sheet.timesheetId);
    await expect(database.transaction(async (tx) => {
      await tx.query(`UPDATE "Timesheet" SET "status"='RETURNED', "reviewReason"='Review hours', "reviewedAt"=now(), "reviewedById"=(SELECT "id" FROM "Profile" WHERE "auth0Id"=$2) WHERE "id"=$1`, [sheet.timesheetId, ORGANISER]);
      expect((await tx.query(`SELECT * FROM "TimesheetRevision" WHERE "timesheetId"=$1 AND "kind"='RETURN'`, [sheet.timesheetId])).rows).toHaveLength(1);
      throw new Error("injected failure after return");
    })).rejects.toThrow("injected failure");
    expect((await database.query<{status:string}>(`SELECT "status" FROM "Timesheet" WHERE "id"=$1`, [sheet.timesheetId])).rows[0]?.status).toBe('SUBMITTED');
    expect(await countRevisions(database, sheet.timesheetId, 'RETURN')).toBe(0);
  });

});

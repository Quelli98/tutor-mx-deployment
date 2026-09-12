import "dotenv/config";
import assert from "node:assert/strict";
import pg from "pg";
import {
  findAllocationCandidates,
  listOpenWork,
  type QueryClient,
} from "../src/services/allocation-queries.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const pool = new pg.Pool({ connectionString, max: 1 });
const connection = await pool.connect();
const client: QueryClient = {
  async query<Row>(sql: string, parameters?: unknown[]) {
    const result = await connection.query(sql, parameters);
    return { rows: result.rows as Row[] };
  },
};

async function expectRejected(sql: string, parameters: unknown[] = []) {
  await connection.query("SAVEPOINT expected_failure");
  try {
    await connection.query(sql, parameters);
    throw new Error("Expected database statement to be rejected");
  } catch (error) {
    if (error instanceof Error && error.message === "Expected database statement to be rejected") {
      throw error;
    }
  } finally {
    await connection.query("ROLLBACK TO SAVEPOINT expected_failure");
  }
}

try {
  await connection.query("BEGIN");

  const course = await connection.query<{ id: number }>(
    `SELECT "id" FROM "Course" WHERE "code" = 'DEMO101'`,
  );
  assert.equal(course.rowCount, 1, "safe seed course is missing");

  const candidates = await findAllocationCandidates(client, {
    courseId: course.rows[0]!.id,
    startsAt: new Date("2030-09-04T14:00:00.000Z"),
    endsAt: new Date("2030-09-04T16:00:00.000Z"),
    minimumMark: 50,
    requestedHours: 2,
  });
  assert.equal(candidates.filter((candidate) => candidate.isEligible).length, 1);
  assert.equal(candidates.length, 3);

  const openWork = await listOpenWork(client, new Date("2030-09-01T00:00:00.000Z"));
  assert.equal(openWork.length, 1);

  const ids = await connection.query<{ tutor_id: number; course_id: number; sheet_id: number }>(`
    SELECT
      (SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass') AS tutor_id,
      (SELECT "id" FROM "Course" WHERE "code" = 'DEMO101') AS course_id,
      (SELECT t."id" FROM "Timesheet" t JOIN "Profile" p ON p."id" = t."tutorId"
        WHERE p."auth0Id" = 'demo|tutor-pass' AND t."weekStart" = DATE '2030-09-02') AS sheet_id;
  `);

  await expectRejected(
    `INSERT INTO "Allocation" (
      "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours"
    ) VALUES ($1, $2, '2030-10-01 10:00', '2030-10-01 11:00', -1)`,
    [ids.rows[0]!.tutor_id, ids.rows[0]!.course_id],
  );
  await expectRejected(
    `UPDATE "Timesheet" SET "status" = 'APPROVED' WHERE "id" = $1`,
    [ids.rows[0]!.sheet_id],
  );

  console.log("Database migrations, seed data, constraints and allocation queries verified.");
} finally {
  await connection.query("ROLLBACK").catch(() => undefined);
  connection.release();
  await pool.end();
}

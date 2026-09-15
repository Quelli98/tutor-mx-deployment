// Pin the process to a non-UTC zone before anything reads it. node-postgres
// serialises a Date using the host's local time, so on a UTC CI runner a
// timezone-shift bug is invisible. Forcing an offset here makes the regression
// test below deterministic wherever it runs.
process.env.TZ = "Africa/Johannesburg";

import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clashExistsSql,
  findAllocationCandidates,
  timeRangesOverlap,
  toNaiveUtcText,
  type QueryClient,
} from "./allocation-queries.js";

// The real node-postgres serialiser, so the test reproduces what actually reaches
// Postgres rather than a restatement of what we believe it does. Reached through
// createRequire because pg ships no types for its internals.
const pgUtils = createRequire(import.meta.url)("pg/lib/utils.js") as {
  prepareValue(value: unknown): unknown;
};

const migrationsPath = fileURLToPath(
  new URL("../../prisma/migrations", import.meta.url),
);

const TUTOR_ID = 9001;
const COURSE_ID = 9002;
const SCENARIO_ALLOCATION_ID = 9003;
const ORGANISER_ID = 9004;

/** The window every scenario is checked against: 14:00-16:00 UTC. */
const WINDOW_START = new Date("2030-09-04T14:00:00.000Z");
const WINDOW_END = new Date("2030-09-04T16:00:00.000Z");

interface ClashScenario {
  name: string;
  source: "BUSY" | "CONFIRMED";
  startsAt: string;
  endsAt: string;
  expected: boolean;
}

/**
 * One table of cases, run through both implementations of the clash rule. The
 * SQL fragment serves the candidate board and the JS predicate serves the
 * in-transaction save path; they cannot share an implementation, so this pins
 * them to the same verdicts instead.
 */
const scenarios: ClashScenario[] = [
  {
    name: "a confirmed allocation at exactly the same time",
    source: "CONFIRMED",
    startsAt: "2030-09-04 14:00:00",
    endsAt: "2030-09-04 16:00:00",
    expected: true,
  },
  {
    name: "a busy slot at exactly the same time",
    source: "BUSY",
    startsAt: "2030-09-04 14:00:00",
    endsAt: "2030-09-04 16:00:00",
    expected: true,
  },
  {
    name: "an interval touching the start",
    source: "CONFIRMED",
    startsAt: "2030-09-04 12:00:00",
    endsAt: "2030-09-04 14:00:00",
    expected: false,
  },
  {
    name: "an interval touching the end",
    source: "CONFIRMED",
    startsAt: "2030-09-04 16:00:00",
    endsAt: "2030-09-04 18:00:00",
    expected: false,
  },
  {
    name: "an interval overlapping the start",
    source: "BUSY",
    startsAt: "2030-09-04 13:00:00",
    endsAt: "2030-09-04 15:00:00",
    expected: true,
  },
  {
    name: "an interval overlapping the end",
    source: "CONFIRMED",
    startsAt: "2030-09-04 15:00:00",
    endsAt: "2030-09-04 17:00:00",
    expected: true,
  },
  {
    name: "an interval contained within the window",
    source: "BUSY",
    startsAt: "2030-09-04 14:30:00",
    endsAt: "2030-09-04 15:30:00",
    expected: true,
  },
  {
    name: "an interval containing the window",
    source: "CONFIRMED",
    startsAt: "2030-09-04 10:00:00",
    endsAt: "2030-09-04 20:00:00",
    expected: true,
  },
  {
    name: "an interval on another day",
    source: "BUSY",
    startsAt: "2030-09-05 14:00:00",
    endsAt: "2030-09-05 16:00:00",
    expected: false,
  },
];

async function applyMigrations(database: PGlite): Promise<void> {
  const directories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directory of directories) {
    await database.exec(
      await readFile(`${migrationsPath}/${directory}/migration.sql`, "utf8"),
    );
  }
}

/**
 * A client that serialises parameters exactly as node-postgres puts them on the
 * wire. The production client is a raw `pg.Pool`, so a test that hands PGlite
 * its own values would not reproduce how parameters actually reach Postgres.
 */
function nodePgLikeClient(database: PGlite): QueryClient {
  return {
    async query<Row>(sql: string, parameters: unknown[] = []) {
      const onTheWire = parameters.map((value) => pgUtils.prepareValue(value));
      const result = await database.query(sql, onTheWire);
      return { rows: result.rows as Row[] };
    },
  };
}

async function seedFixtures(database: PGlite): Promise<void> {
  await database.exec(`
    INSERT INTO "Profile" ("id", "auth0Id", "email", "fullName", "role", "updatedAt")
    VALUES
      (${TUTOR_ID}, 'clash|tutor', 'clash-tutor@tutormx.example', 'Clash Tutor', 'TUTOR', CURRENT_TIMESTAMP),
      (${ORGANISER_ID}, 'clash|organiser', 'clash-organiser@tutormx.example', 'Clash Organiser', 'ORGANISER', CURRENT_TIMESTAMP);

    INSERT INTO "Course" ("id", "code", "name", "updatedAt")
    VALUES (${COURSE_ID}, 'CLASH101', 'Clash Course', CURRENT_TIMESTAMP);

    INSERT INTO "TutorMark" ("tutorId", "courseId", "mark")
    VALUES (${TUTOR_ID}, ${COURSE_ID}, 90);

    INSERT INTO "TutorHourLimit" ("tutorId", "weeklyHours")
    VALUES (${TUTOR_ID}, 20);
  `);
}

async function clearIntervals(database: PGlite): Promise<void> {
  await database.exec(`
    DELETE FROM "Allocation" WHERE "tutorId" = ${TUTOR_ID};
    DELETE FROM "TimeSlot" WHERE "tutorId" = ${TUTOR_ID};
  `);
}

async function insertInterval(
  database: PGlite,
  scenario: ClashScenario,
): Promise<void> {
  if (scenario.source === "BUSY") {
    await database.exec(`
      INSERT INTO "TimeSlot" ("tutorId", "type", "startsAt", "endsAt")
      VALUES (${TUTOR_ID}, 'BUSY', '${scenario.startsAt}', '${scenario.endsAt}');
    `);
    return;
  }

  // A database trigger requires every allocation to be inserted as PROPOSED and
  // promoted afterwards, which is what createAllocation does too.
  await database.exec(`
    INSERT INTO "Allocation" (
      "id", "tutorId", "courseId", "startsAt", "endsAt", "allocatedHours", "updatedAt"
    ) VALUES (
      ${SCENARIO_ALLOCATION_ID}, ${TUTOR_ID}, ${COURSE_ID},
      '${scenario.startsAt}', '${scenario.endsAt}', 1, CURRENT_TIMESTAMP
    );

    UPDATE "Allocation"
    SET "status" = 'CONFIRMED',
        "reviewedById" = ${ORGANISER_ID},
        "reviewedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${SCENARIO_ALLOCATION_ID};
  `);
}

/** Evaluate the shared SQL fragment on its own, for one tutor. */
async function clashViaSql(
  database: PGlite,
  client: QueryClient,
  excludeAllocationId: number | null = null,
): Promise<boolean> {
  void database;
  // The fragment keeps the candidate query's parameter positions ($2, $3 and $6),
  // so $4 and $5 are bound too and given a type Postgres cannot infer on its own.
  const result = await client.query<{ hasClash: boolean }>(
    `SELECT ${clashExistsSql} AS "hasClash",
       $4::double precision AS "unusedMinimumMark",
       $5::double precision AS "unusedRequestedHours"
     FROM "Profile" p WHERE p."id" = $1`,
    [
      TUTOR_ID,
      toNaiveUtcText(WINDOW_START),
      toNaiveUtcText(WINDOW_END),
      null,
      null,
      excludeAllocationId,
    ],
  );
  return result.rows[0]!.hasClash;
}

/** The predicate the in-transaction save path applies to each fetched row. */
function clashViaJs(scenario: ClashScenario): boolean {
  return (
    timeRangesOverlap(
      WINDOW_START,
      WINDOW_END,
      new Date(`${scenario.startsAt.replace(" ", "T")}.000Z`),
      new Date(`${scenario.endsAt.replace(" ", "T")}.000Z`),
    ) !== false
  );
}

describe("allocation clash rule", () => {
  let database: PGlite;
  let client: QueryClient;

  beforeAll(async () => {
    database = new PGlite();
    await applyMigrations(database);
    await seedFixtures(database);
    client = nodePgLikeClient(database);
  }, 30_000);

  afterAll(async () => {
    await database.close();
  });

  it("keeps the process pinned to a non-UTC zone so a shift is observable", () => {
    expect(new Date().getTimezoneOffset()).not.toBe(0);
  });

  it.each(scenarios)(
    "agrees between the candidate query and the save path for $name",
    async (scenario) => {
      await clearIntervals(database);
      await insertInterval(database, scenario);

      const sqlVerdict = await clashViaSql(database, client);
      const jsVerdict = clashViaJs(scenario);

      expect(sqlVerdict).toBe(scenario.expected);
      expect(jsVerdict).toBe(scenario.expected);
      expect(sqlVerdict).toBe(jsVerdict);
    },
  );

  it("reports a clash on the candidate board for an exactly overlapping confirmed allocation", async () => {
    await clearIntervals(database);
    await insertInterval(database, scenarios[0]!);

    const candidates = await findAllocationCandidates(client, {
      courseId: COURSE_ID,
      startsAt: WINDOW_START,
      endsAt: WINDOW_END,
      minimumMark: 65,
      requestedHours: 2,
    });

    const candidate = candidates.find((row) => row.tutorId === TUTOR_ID);
    expect(candidate).toBeDefined();
    expect(candidate!.hasClash).toBe(true);
    expect(candidate!.reasonCodes).toContain("schedule-clash");
    expect(candidate!.isEligible).toBe(false);
  });

  it("does not report the allocation being edited as clashing with itself", async () => {
    await clearIntervals(database);
    await insertInterval(database, scenarios[0]!);

    expect(await clashViaSql(database, client)).toBe(true);
    expect(await clashViaSql(database, client, SCENARIO_ALLOCATION_ID)).toBe(false);

    const candidates = await findAllocationCandidates(client, {
      courseId: COURSE_ID,
      startsAt: WINDOW_START,
      endsAt: WINDOW_END,
      minimumMark: 65,
      requestedHours: 2,
      excludeAllocationId: SCENARIO_ALLOCATION_ID,
    });

    const candidate = candidates.find((row) => row.tutorId === TUTOR_ID);
    expect(candidate!.hasClash).toBe(false);
    expect(candidate!.reasonCodes).not.toContain("schedule-clash");
  });

  it("leaves the board clear when nothing overlaps the window", async () => {
    await clearIntervals(database);
    await insertInterval(database, scenarios[3]!);

    const candidates = await findAllocationCandidates(client, {
      courseId: COURSE_ID,
      startsAt: WINDOW_START,
      endsAt: WINDOW_END,
      minimumMark: 65,
      requestedHours: 2,
    });

    const candidate = candidates.find((row) => row.tutorId === TUTOR_ID);
    expect(candidate!.hasClash).toBe(false);
    expect(candidate!.reasonCodes).not.toContain("schedule-clash");
    expect(candidate!.isEligible).toBe(true);
  });
});

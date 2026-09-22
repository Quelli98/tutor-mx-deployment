import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getAssignedHoursForRequirements,
  timeRangesOverlap,
  type QueryClient,
} from "./allocation-queries.js";

const migrationsPath = fileURLToPath(
  new URL("../../prisma/migrations", import.meta.url),
);

const TUTOR = 1;
const OTHER_TUTOR = 2;
const ORGANISER = 3;
const COURSE = 10;
const OTHER_COURSE = 20;
const REQUIREMENT = 100;

/** Every scenario is measured against this requirement window. */
const WINDOW_START = "2030-09-04 10:00";
const WINDOW_END = "2030-09-04 14:00";

let database: PGlite;
let client: QueryClient;

async function sql(text: string) {
  await database.exec(text);
}

/**
 * Allocations start PROPOSED and are promoted, exactly as createAllocation does,
 * so the triggers see the same sequence the application produces.
 */
async function allocation(
  id: number,
  options: {
    courseId?: number;
    tutorId?: number;
    startsAt: string;
    endsAt: string;
    hours: number;
    status?: "PROPOSED" | "CONFIRMED" | "CANCELLED";
  },
) {
  const {
    courseId = COURSE,
    tutorId = TUTOR,
    startsAt,
    endsAt,
    hours,
    status = "CONFIRMED",
  } = options;

  await sql(`
    INSERT INTO "Allocation" ("id","tutorId","courseId","startsAt","endsAt","allocatedHours","updatedAt")
    VALUES (${id}, ${tutorId}, ${courseId}, '${startsAt}', '${endsAt}', ${hours}, now());
  `);
  if (status !== "PROPOSED") {
    await sql(`
      UPDATE "Allocation" SET "status" = 'CONFIRMED', "reviewedById" = ${ORGANISER}, "reviewedAt" = now()
      WHERE "id" = ${id};
    `);
  }
  if (status === "CANCELLED") {
    await sql(`UPDATE "Allocation" SET "status" = 'CANCELLED' WHERE "id" = ${id}`);
  }
}

async function assignedHours(requirementId = REQUIREMENT): Promise<number> {
  const result = await getAssignedHoursForRequirements(client, [requirementId]);
  return result.get(requirementId) ?? 0;
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
  client = {
    async query<Row>(text: string, parameters?: unknown[]) {
      const result = await database.query(text, parameters);
      return { rows: result.rows as Row[] };
    },
  };
}, 60_000);

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await sql(`
    TRUNCATE "StaffingRequirement", "Allocation", "TutorMark", "TutorHourLimit",
      "Course", "Profile" RESTART IDENTITY CASCADE;

    INSERT INTO "Profile" ("id","auth0Id","email","fullName","role","updatedAt") VALUES
      (${TUTOR}, 'auth0|tutor', 'tutor@tutormx.example', 'Tutor', 'TUTOR', now()),
      (${OTHER_TUTOR}, 'auth0|tutor-2', 'tutor2@tutormx.example', 'Other Tutor', 'TUTOR', now()),
      (${ORGANISER}, 'auth0|organiser', 'organiser@tutormx.example', 'Organiser', 'ORGANISER', now());
    INSERT INTO "Course" ("id","code","name","updatedAt") VALUES
      (${COURSE}, 'COMS3011', 'Software Design Project', now()),
      (${OTHER_COURSE}, 'COMS3009', 'Software Engineering', now());
    INSERT INTO "StaffingRequirement"
      ("id","courseId","startsAt","endsAt","tutorsNeeded","createdById","updatedAt")
    VALUES (${REQUIREMENT}, ${COURSE}, '${WINDOW_START}', '${WINDOW_END}', 2, ${ORGANISER}, now());
  `);
});

describe("assigned hours for a staffing requirement", () => {
  it("counts nothing when no allocation exists", async () => {
    await expect(assignedHours()).resolves.toBe(0);
  });

  it("counts a booking that sits entirely inside the window", async () => {
    await allocation(1, {
      startsAt: "2030-09-04 10:00",
      endsAt: "2030-09-04 12:00",
      hours: 2,
    });
    await expect(assignedHours()).resolves.toBe(2);
  });

  it("counts only the overlapping part of a booking that runs past the window", async () => {
    // The worked example: 13:00-17:00, four hours, against a 10:00-14:00
    // requirement. One of its four hours falls inside, so one hour counts.
    await allocation(1, {
      startsAt: "2030-09-04 13:00",
      endsAt: "2030-09-04 17:00",
      hours: 4,
    });
    await expect(assignedHours()).resolves.toBe(1);
  });

  it("counts the overlapping share when a booking starts before the window", async () => {
    // 08:00-12:00, four hours: two of them fall inside.
    await allocation(1, {
      startsAt: "2030-09-04 08:00",
      endsAt: "2030-09-04 12:00",
      hours: 4,
    });
    await expect(assignedHours()).resolves.toBe(2);
  });

  it("counts the share in proportion when hours differ from the booked window", async () => {
    // Two hours of work booked across a four-hour block, half of which overlaps,
    // so one hour counts rather than the full two.
    await allocation(1, {
      startsAt: "2030-09-04 12:00",
      endsAt: "2030-09-04 16:00",
      hours: 2,
    });
    await expect(assignedHours()).resolves.toBe(1);
  });

  it("never counts more than the booking itself", async () => {
    await allocation(1, {
      startsAt: "2030-09-04 10:00",
      endsAt: "2030-09-04 14:00",
      hours: 1,
    });
    await expect(assignedHours()).resolves.toBe(1);
  });

  it.each([
    ["touching the start", "2030-09-04 08:00", "2030-09-04 10:00"],
    ["touching the end", "2030-09-04 14:00", "2030-09-04 16:00"],
    ["on another day", "2030-09-05 10:00", "2030-09-05 14:00"],
  ])("ignores a booking %s", async (_label, startsAt, endsAt) => {
    await allocation(1, { startsAt, endsAt, hours: 4 });
    await expect(assignedHours()).resolves.toBe(0);
  });

  it.each([
    ["PROPOSED", "PROPOSED" as const],
    ["CANCELLED", "CANCELLED" as const],
  ])("ignores a %s allocation, matching the capacity rule", async (_label, status) => {
    await allocation(1, {
      startsAt: "2030-09-04 10:00",
      endsAt: "2030-09-04 12:00",
      hours: 2,
      status,
    });
    await expect(assignedHours()).resolves.toBe(0);
  });

  it("ignores a booking for another course", async () => {
    await allocation(1, {
      courseId: OTHER_COURSE,
      startsAt: "2030-09-04 10:00",
      endsAt: "2030-09-04 12:00",
      hours: 2,
    });
    await expect(assignedHours()).resolves.toBe(0);
  });

  it("adds up several bookings, including different tutors", async () => {
    await allocation(1, {
      startsAt: "2030-09-04 10:00",
      endsAt: "2030-09-04 12:00",
      hours: 2,
    });
    await allocation(2, {
      tutorId: OTHER_TUTOR,
      startsAt: "2030-09-04 12:00",
      endsAt: "2030-09-04 14:00",
      hours: 2,
    });
    await expect(assignedHours()).resolves.toBe(4);
  });

  it("answers for many requirements in a single query", async () => {
    await sql(`
      INSERT INTO "StaffingRequirement"
        ("id","courseId","startsAt","endsAt","tutorsNeeded","createdById","updatedAt")
      VALUES
        (101, ${COURSE}, '2030-09-05 10:00', '2030-09-05 14:00', 1, ${ORGANISER}, now()),
        (102, ${OTHER_COURSE}, '${WINDOW_START}', '${WINDOW_END}', 1, ${ORGANISER}, now());
    `);
    await allocation(1, {
      startsAt: "2030-09-04 10:00",
      endsAt: "2030-09-04 12:00",
      hours: 2,
    });
    await allocation(2, {
      startsAt: "2030-09-05 10:00",
      endsAt: "2030-09-05 11:00",
      hours: 1,
    });

    let queries = 0;
    const countingClient: QueryClient = {
      async query<Row>(text: string, parameters?: unknown[]) {
        queries += 1;
        return client.query<Row>(text, parameters);
      },
    };

    const result = await getAssignedHoursForRequirements(
      countingClient,
      [REQUIREMENT, 101, 102],
    );

    expect(result.get(REQUIREMENT)).toBe(2);
    expect(result.get(101)).toBe(1);
    expect(result.get(102)).toBe(0);
    // Three requirements, one round trip.
    expect(queries).toBe(1);
  });

  it("asks the database nothing when there are no requirements", async () => {
    let queries = 0;
    const countingClient: QueryClient = {
      async query<Row>(text: string, parameters?: unknown[]) {
        queries += 1;
        return client.query<Row>(text, parameters);
      },
    };

    await expect(
      getAssignedHoursForRequirements(countingClient, []),
    ).resolves.toEqual(new Map());
    expect(queries).toBe(0);
  });

  it("rejects identifiers that are not positive whole numbers", async () => {
    await expect(
      getAssignedHoursForRequirements(client, [0]),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

/**
 * The SQL join and {@link timeRangesOverlap} are two statements of the same
 * half-open rule. This table runs both over the same cases so they cannot drift.
 */
describe("the shortage query agrees with timeRangesOverlap", () => {
  const windowStart = new Date("2030-09-04T10:00:00.000Z");
  const windowEnd = new Date("2030-09-04T14:00:00.000Z");

  it.each([
    ["identical", "2030-09-04 10:00", "2030-09-04 14:00", true],
    ["contained", "2030-09-04 11:00", "2030-09-04 12:00", true],
    ["containing", "2030-09-04 08:00", "2030-09-04 18:00", true],
    ["overlapping the start", "2030-09-04 08:00", "2030-09-04 11:00", true],
    ["overlapping the end", "2030-09-04 13:00", "2030-09-04 16:00", true],
    ["touching the start", "2030-09-04 08:00", "2030-09-04 10:00", false],
    ["touching the end", "2030-09-04 14:00", "2030-09-04 16:00", false],
    ["entirely before", "2030-09-04 06:00", "2030-09-04 08:00", false],
    ["entirely after", "2030-09-04 16:00", "2030-09-04 18:00", false],
  ])("agrees for a booking %s", async (_label, startsAt, endsAt, expected) => {
    await allocation(1, { startsAt, endsAt, hours: 4 });

    const countedBySql = (await assignedHours()) > 0;
    const overlapsInJs = timeRangesOverlap(
      new Date(`${startsAt.replace(" ", "T")}:00.000Z`),
      new Date(`${endsAt.replace(" ", "T")}:00.000Z`),
      windowStart,
      windowEnd,
    );

    expect(countedBySql).toBe(expected);
    expect(overlapsInJs).toBe(expected);
  });
});

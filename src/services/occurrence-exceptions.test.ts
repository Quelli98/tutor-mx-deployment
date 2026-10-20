import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findAllocationCandidates, type QueryClient } from "./allocation-queries.js";
import {
  occurrenceOn,
  removeOccurrenceException,
  saveOccurrenceException,
} from "./occurrence-exceptions.js";

const migrationsPath = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const seedPath = fileURLToPath(new URL("../../prisma/seed.sql", import.meta.url));

function asQueryClient(database: PGlite): QueryClient {
  return {
    async query<Row>(sql: string, parameters?: unknown[]) {
      const result = await database.query(sql, parameters);
      return { rows: result.rows as Row[] };
    },
  };
}

describe("occurrenceOn", () => {
  // Tuesday 2031-02-04 10:00 SAST, an hour and a half long.
  const weekly = {
    startsAt: new Date("2031-02-04T08:00:00.000Z"),
    endsAt: new Date("2031-02-04T09:30:00.000Z"),
    recurrence: "WEEKLY",
    recurrenceUntil: null,
  };

  it("finds the same wall-clock time a whole number of periods later", () => {
    expect(occurrenceOn(weekly, "2031-02-04")).toEqual({ startsAt: weekly.startsAt, endsAt: weekly.endsAt });
    expect(occurrenceOn(weekly, "2031-02-18")).toEqual({
      startsAt: new Date("2031-02-18T08:00:00.000Z"),
      endsAt: new Date("2031-02-18T09:30:00.000Z"),
    });
    expect(occurrenceOn({ ...weekly, recurrence: "FORTNIGHTLY" }, "2031-02-18")).not.toBeNull();
  });

  it.each([
    ["off the weekly day", weekly, "2031-02-05"],
    ["the off-week of a fortnightly entry", { ...weekly, recurrence: "FORTNIGHTLY" }, "2031-02-11"],
    ["before the first occurrence", weekly, "2031-01-28"],
    ["after the repeat-until date", { ...weekly, recurrenceUntil: new Date("2031-02-12T00:00:00.000Z") }, "2031-02-18"],
    ["a one-off entry", { ...weekly, recurrence: null }, "2031-02-04"],
  ])("has no occurrence %s", (_name, entry, date) => {
    expect(occurrenceOn(entry, date)).toBeNull();
  });

  it("names a late-evening UTC start by its Johannesburg date", () => {
    // 22:30 UTC Monday is 00:30 SAST Tuesday, the key the calendar and clash SQL use.
    const lateNight = { ...weekly, startsAt: new Date("2031-02-03T22:30:00.000Z"), endsAt: new Date("2031-02-03T23:30:00.000Z") };
    expect(occurrenceOn(lateNight, "2031-02-03")).toBeNull();
    expect(occurrenceOn(lateNight, "2031-02-11")).toMatchObject({ startsAt: new Date("2031-02-10T22:30:00.000Z") });
  });
});

describe("occurrence exceptions in the database", () => {
  let database: PGlite;
  let client: QueryClient;
  let tutorId: number;
  let studentId: number;
  let courseId: number;
  let entryId: number;

  beforeAll(async () => {
    database = new PGlite();
    for (const name of (await readdir(migrationsPath)).sort()) {
      if (name !== "migration_lock.toml") {
        await database.exec(await readFile(`${migrationsPath}/${name}/migration.sql`, "utf8"));
      }
    }
    await database.exec(await readFile(seedPath, "utf8"));
    client = asQueryClient(database);
    const ids = await database.query<{ auth0Id: string; id: number }>(
      `SELECT "auth0Id", "id" FROM "Profile" WHERE "auth0Id" IN ('demo|tutor-pass', 'demo|student')`,
    );
    tutorId = ids.rows.find((row) => row.auth0Id === "demo|tutor-pass")!.id;
    studentId = ids.rows.find((row) => row.auth0Id === "demo|student")!.id;
    courseId = (await database.query<{ id: number }>(`SELECT "id" FROM "Course" WHERE "code" = 'DEMO101'`)).rows[0]!.id;
  });

  afterAll(async () => { await database.close(); });

  beforeEach(async () => {
    await database.query(`DELETE FROM "TimeSlot" WHERE "startsAt" >= '2031-01-01'`);
    entryId = (await database.query<{ id: number }>(
      `INSERT INTO "TimeSlot" ("tutorId", "type", "startsAt", "endsAt", "recurrence", "category", "label")
       VALUES ($1, 'BUSY', '2031-02-04 08:00', '2031-02-04 09:30', 'WEEKLY', 'CLASS', 'Lecture') RETURNING "id"`,
      [tutorId],
    )).rows[0]!.id;
  });

  async function exceptions() {
    return (await database.query<{ exceptionType: string; occurrenceDate: string; newStartsAt: string | null }>(
      `SELECT "exceptionType", to_char("occurrenceDate", 'YYYY-MM-DD') AS "occurrenceDate",
              to_char("newStartsAt", 'YYYY-MM-DD HH24:MI') AS "newStartsAt"
         FROM "OccurrenceException" WHERE "timeSlotId" = $1`,
      [entryId],
    )).rows;
  }

  async function clashAt(startsAt: string, endsAt: string) {
    const rows = await findAllocationCandidates(client, {
      courseId, startsAt: new Date(startsAt), endsAt: new Date(endsAt), minimumMark: 0, requestedHours: 1,
    });
    return rows.find((row) => row.tutorId === tutorId)!.hasClash;
  }

  it("skips one week so it stops blocking an allocation, and only that week", async () => {
    expect(await clashAt("2031-02-11T08:30:00.000Z", "2031-02-11T09:00:00.000Z")).toBe(true);

    await saveOccurrenceException(client, tutorId, entryId, "2031-02-11", { exceptionType: "CANCELLED" });

    expect(await exceptions()).toEqual([{ exceptionType: "CANCELLED", occurrenceDate: "2031-02-11", newStartsAt: null }]);
    expect(await clashAt("2031-02-11T08:30:00.000Z", "2031-02-11T09:00:00.000Z")).toBe(false);
    expect(await clashAt("2031-02-18T08:30:00.000Z", "2031-02-18T09:00:00.000Z")).toBe(true);
  });

  it("moves one week so the busy time follows it", async () => {
    await saveOccurrenceException(client, tutorId, entryId, "2031-02-11", {
      exceptionType: "MOVED",
      newStartsAt: new Date("2031-02-12T12:00:00.000Z"),
      newEndsAt: new Date("2031-02-12T13:30:00.000Z"),
    });

    expect(await clashAt("2031-02-11T08:30:00.000Z", "2031-02-11T09:00:00.000Z")).toBe(false);
    expect(await clashAt("2031-02-12T12:30:00.000Z", "2031-02-12T13:00:00.000Z")).toBe(true);
  });

  it("replaces an earlier change to the same week instead of stacking a second row", async () => {
    await saveOccurrenceException(client, tutorId, entryId, "2031-02-11", { exceptionType: "CANCELLED" });
    await saveOccurrenceException(client, tutorId, entryId, "2031-02-11", {
      exceptionType: "MOVED",
      newStartsAt: new Date("2031-02-12T12:00:00.000Z"),
      newEndsAt: new Date("2031-02-12T13:30:00.000Z"),
    });

    expect(await exceptions()).toEqual([{ exceptionType: "MOVED", occurrenceDate: "2031-02-11", newStartsAt: "2031-02-12 12:00" }]);
  });

  it("restores a week to its usual time", async () => {
    await saveOccurrenceException(client, tutorId, entryId, "2031-02-11", { exceptionType: "CANCELLED" });
    await removeOccurrenceException(client, tutorId, entryId, "2031-02-11");

    expect(await exceptions()).toEqual([]);
    expect(await clashAt("2031-02-11T08:30:00.000Z", "2031-02-11T09:00:00.000Z")).toBe(true);
    await expect(removeOccurrenceException(client, tutorId, entryId, "2031-02-11"))
      .rejects.toMatchObject({ status: 404, code: "OCCURRENCE_NOT_FOUND" });
  });

  it("only changes the caller's own repeating entry on a real occurrence date", async () => {
    await expect(saveOccurrenceException(client, studentId, entryId, "2031-02-11", { exceptionType: "CANCELLED" }))
      .rejects.toMatchObject({ status: 404, code: "TIME_SLOT_NOT_FOUND" });
    await expect(saveOccurrenceException(client, tutorId, entryId, "2031-02-12", { exceptionType: "CANCELLED" }))
      .rejects.toMatchObject({ status: 404, code: "OCCURRENCE_NOT_FOUND" });
    await expect(saveOccurrenceException(client, tutorId, entryId, "2031-02-11", {
      exceptionType: "MOVED", newStartsAt: new Date("2031-02-12T12:00:00.000Z"), newEndsAt: new Date("2031-02-20T12:00:00.000Z"),
    })).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });

    const oneOff = (await database.query<{ id: number }>(
      `INSERT INTO "TimeSlot" ("tutorId", "type", "startsAt", "endsAt") VALUES ($1, 'BUSY', '2031-03-01 08:00', '2031-03-01 09:00') RETURNING "id"`,
      [tutorId],
    )).rows[0]!.id;
    await expect(saveOccurrenceException(client, tutorId, oneOff, "2031-03-01", { exceptionType: "CANCELLED" }))
      .rejects.toMatchObject({ status: 409, code: "TIME_SLOT_NOT_REPEATING" });
    expect(await exceptions()).toEqual([]);
  });

  it("works the same way on a Student's timetable", async () => {
    const studentEntry = (await database.query<{ id: number }>(
      `INSERT INTO "TimeSlot" ("tutorId", "type", "startsAt", "endsAt", "recurrence", "category")
       VALUES ($1, 'BUSY', '2031-02-05 08:00', '2031-02-05 09:00', 'FORTNIGHTLY', 'CLASS') RETURNING "id"`,
      [studentId],
    )).rows[0]!.id;

    await saveOccurrenceException(client, studentId, studentEntry, "2031-02-19", { exceptionType: "CANCELLED" });
    await expect(saveOccurrenceException(client, tutorId, studentEntry, "2031-02-19", { exceptionType: "CANCELLED" }))
      .rejects.toMatchObject({ status: 404, code: "TIME_SLOT_NOT_FOUND" });
  });

  it("refuses a malformed exception written straight to the table", async () => {
    await expect(database.query(
      `INSERT INTO "OccurrenceException" ("timeSlotId", "occurrenceDate", "exceptionType", "newStartsAt", "newEndsAt")
       VALUES ($1, '2031-02-11', 'CANCELLED', '2031-02-12 12:00', '2031-02-12 13:00')`,
      [entryId],
    )).rejects.toBeDefined();
    await expect(database.query(
      `INSERT INTO "OccurrenceException" ("timeSlotId", "occurrenceDate", "exceptionType")
       VALUES ($1, '2031-02-11', 'MOVED')`,
      [entryId],
    )).rejects.toBeDefined();
  });
});

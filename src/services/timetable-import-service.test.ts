import { requestFingerprint } from "../http/idempotency.js";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  busySlotClashes,
  findAllocationCandidates,
  toNaiveUtcText,
  type QueryClient,
} from "./allocation-queries.js";
import {
  createTimetableImportService,
  type TimetableImportPrismaClient,
  type TimetableImportTransaction,
} from "./timetable-import-service.js";
import type { TimetableImportRequest } from "./timetable-import.js";

/**
 * S3-M3-1 integration tests for the timetable import.
 *
 * This suite runs the importer against the REAL schema — every migration in
 * prisma/migrations plus the real seed — inside PGlite, then asks the REAL
 * allocation clash query what it thinks of the result. That is what makes the
 * card's central claim testable rather than asserted: an imported entry and a
 * hand-written entry must be indistinguishable to the allocation logic, because
 * they are the same kind of row.
 *
 * Prisma treats a `timestamp` column as a UTC wall clock. PGlite's own driver
 * would instead read a naive timestamp in the process timezone, so the adapter
 * below writes naive UTC text and reads it back through to_char with a literal
 * Z. Without that, these tests would pass in UTC and silently shift by the
 * offset anywhere else.
 */

const migrationsPath = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const seedPath = fileURLToPath(new URL("../../prisma/seed.sql", import.meta.url));

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

const utcText = (column: string): string =>
  `to_char(${column},'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

class FailAfterInserts extends Error {}

/**
 * A Prisma-shaped adapter over PGlite covering only what the import service
 * calls. `failAfter` lets a test break the batch part-way through so the
 * rollback can be observed rather than assumed.
 */
function createImportClient(database: PGlite, failAfter = Number.POSITIVE_INFINITY) {
  let inserts = 0;

  const timeSlot = (executor: PGlite | Transaction) => ({
    async findMany(args: {
      where: { tutorId: number; type: "BUSY"; startsAt: { gte: Date; lte: Date } };
    }) {
      const result = await executor.query<{
        startsAt: string;
        endsAt: string;
        recurrence: string | null;
        label: string | null;
        category: string;
      }>(
        `SELECT ${utcText('"startsAt"')} AS "startsAt",
                ${utcText('"endsAt"')} AS "endsAt",
                "recurrence","label",COALESCE("category",'UNAVAILABLE') AS "category"
         FROM "TimeSlot"
         WHERE "tutorId" = $1 AND "type" = 'BUSY'
           AND "startsAt" >= $2 AND "startsAt" <= $3`,
        [
          args.where.tutorId,
          toNaiveUtcText(args.where.startsAt.gte),
          toNaiveUtcText(args.where.startsAt.lte),
        ],
      );
      return result.rows.map((row) => ({
        startsAt: new Date(row.startsAt),
        endsAt: new Date(row.endsAt),
        recurrence: row.recurrence,
        label: row.label,
        category: row.category,
      }));
    },

    async create(args: {
      data: {
        tutorId: number;
        type: "BUSY";
        startsAt: Date;
        endsAt: Date;
        recurrence: string | null;
        label: string | null;
        recurrenceUntil: Date | null;
        category: string;
        seriesId: string | null;
        termId: number | null;
      };
    }) {
      inserts += 1;
      if (inserts > failAfter) {
        throw new FailAfterInserts(`Forced failure on insert ${inserts}`);
      }
      const { data } = args;
      const result = await executor.query<{ id: number }>(
        `INSERT INTO "TimeSlot"
           ("tutorId","type","startsAt","endsAt","recurrence","label","recurrenceUntil","category","seriesId","termId")
         VALUES ($1,'BUSY',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING "id"`,
        [
          data.tutorId,
          toNaiveUtcText(data.startsAt),
          toNaiveUtcText(data.endsAt),
          data.recurrence,
          data.label,
          data.recurrenceUntil ? toNaiveUtcText(data.recurrenceUntil) : null,
          data.category,
          data.seriesId,
          data.termId,
        ],
      );
      return { id: result.rows[0]!.id };
    },
  });

  const client: TimetableImportPrismaClient = {
    profile: {
      async findUnique(args: { where: { auth0Id: string } }) {
        const result = await database.query<{ id: number; role: string }>(
          `SELECT "id","role" FROM "Profile" WHERE "auth0Id" = $1`,
          [args.where.auth0Id],
        );
        return result.rows[0] ?? null;
      },
    },

    academicTerm: {
      async findUnique(args: { where: { id: number } }) {
        const result = await database.query<{
          id: number;
          name: string;
          startsOn: Date;
          endsOn: Date;
        }>(
          `SELECT "id","name","startsOn","endsOn" FROM "AcademicTerm" WHERE "id" = $1`,
          [args.where.id],
        );
        return result.rows[0] ?? null;
      },
    },

    timeSlot: timeSlot(database),

    // The isolation level is part of the interface the service asks for; this
    // adapter runs the whole callback in one PGlite transaction, whose isolation
    // is already serializable for a single connection.
    async $transaction<Result>(
      operation: (transaction: TimetableImportTransaction) => Promise<Result>,
    ): Promise<Result> {
      // PGlite's transaction() rolls back when the callback throws, which is the
      // behaviour the service relies on for its all-or-nothing commit.
      return database.transaction(async (transaction) =>
        operation({ timeSlot: timeSlot(transaction), async $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T> {
          return (await transaction.query(sql, values)).rows as T;
        } }),
      );
    },
  };

  return client;
}

function asQueryClient(database: PGlite): QueryClient {
  return {
    async query<Row>(sql: string, parameters?: unknown[]) {
      const result = await database.query(sql, parameters);
      return { rows: result.rows as Row[] };
    },
  };
}

const TUTOR = "demo|tutor-pass";

describe("timetable import service", () => {
  let database: PGlite;
  let tutorId: number;
  let courseId: number;
  let termId: number;

  beforeAll(async () => {
    database = new PGlite();
    await applyMigrations(database);
    await database.exec(await readFile(seedPath, "utf8"));

    const tutor = await database.query<{ id: number }>(
      `SELECT "id" FROM "Profile" WHERE "auth0Id" = $1`,
      [TUTOR],
    );
    tutorId = tutor.rows[0]!.id;

    const course = await database.query<{ id: number }>(
      `SELECT "id" FROM "Course" WHERE "code" = 'DEMO101'`,
    );
    courseId = course.rows[0]!.id;

    // The seed ships this term; it covers all the 2030 dates used below.
    const term = await database.query<{ id: number }>(
      `SELECT "id" FROM "AcademicTerm" WHERE "name" = 'Demo 2030 Semester 2'`,
    );
    termId = term.rows[0]!.id;
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "TimeSlot" WHERE "tutorId" = $1`, [tutorId]);
  });

  function service(failAfter = Number.POSITIVE_INFINITY) {
    return createTimetableImportService(createImportClient(database, failAfter));
  }

  function request(
    text: string,
    overrides: Partial<TimetableImportRequest> = {},
  ): TimetableImportRequest {
    return { source: "CSV", text, timeZone: "UTC", termId, ...overrides };
  }

  /** Inserts a row the way the manual schedule form does. */
  async function manualSlot(input: {
    startsAt: Date;
    endsAt: Date;
    recurrence?: string | null;
    label?: string | null;
    recurrenceUntil?: Date | null;
  }): Promise<number> {
    const result = await database.query<{ id: number }>(
      `INSERT INTO "TimeSlot"
         ("tutorId","type","startsAt","endsAt","recurrence","label","recurrenceUntil")
       VALUES ($1,'BUSY',$2,$3,$4,$5,$6) RETURNING "id"`,
      [
        tutorId,
        toNaiveUtcText(input.startsAt),
        toNaiveUtcText(input.endsAt),
        input.recurrence ?? null,
        input.label ?? null,
        input.recurrenceUntil ? toNaiveUtcText(input.recurrenceUntil) : null,
      ],
    );
    return result.rows[0]!.id;
  }

  async function storedSlots() {
    const result = await database.query<{
      id: number;
      startsAt: string;
      endsAt: string;
      recurrence: string | null;
      label: string | null;
      recurrenceUntil: string | null;
    }>(
      `SELECT "id", ${utcText('"startsAt"')} AS "startsAt", ${utcText('"endsAt"')} AS "endsAt",
              "recurrence","label", ${utcText('"recurrenceUntil"')} AS "recurrenceUntil"
       FROM "TimeSlot" WHERE "tutorId" = $1 ORDER BY "startsAt"`,
      [tutorId],
    );
    return result.rows;
  }

  describe("Member 5 durable retry and transaction evidence", () => {
    const csv = "date,start,end,label,repeat\n2030-09-02,09:00,11:00,Maths,weekly";
    it("returns the original result for a replayed key without inserting duplicates", async () => {
      const input = request(csv);
      const first = await service().commit(TUTOR, input, "m5-replay-001");
      const second = await service().commit(TUTOR, input, "m5-replay-001");
      expect(second).toEqual(first);
      expect(await storedSlots()).toHaveLength(1);
    });
    it("rejects a key reused with different validated content", async () => {
      await service().commit(TUTOR, request(csv), "m5-conflict-001");
      await expect(service().commit(TUTOR, request(csv.replace("Maths", "Physics")), "m5-conflict-001"))
        .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
      expect(await storedSlots()).toHaveLength(1);
    });
    it("rolls back both receipt and all imported rows on an injected second-row failure", async () => {
      const input = request(csv + "\n2030-09-03,09:00,11:00,Physics,weekly");
      await expect(service(1).commit(TUTOR, input, "m5-rollback-001")).rejects.toMatchObject({ status: 409 });
      expect(await storedSlots()).toHaveLength(0);
      expect((await database.query(`SELECT * FROM "ApiWriteReceipt" WHERE "key" = $1`, [requestFingerprint({ scope: "timetable-import", key: "m5-rollback-001" })])).rows).toHaveLength(0);
      expect((await service().commit(TUTOR, input, "m5-rollback-001")).created).toBe(2);
    });
    it("simultaneous keyed requests return one durable import", async () => {
      const input = request(csv);
      const results = await Promise.all([service().commit(TUTOR, input, "m5-concurrent-001"), service().commit(TUTOR, input, "m5-concurrent-001")]);
      expect(results[0]).toEqual(results[1]);
      expect(await storedSlots()).toHaveLength(1);
    });
    it("simultaneous unkeyed requests cannot duplicate schedule rows", async () => {
      const results = await Promise.allSettled([service().commit(TUTOR, request(csv)), service().commit(TUTOR, request(csv))]);
      expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
      expect(await storedSlots()).toHaveLength(1);
    });
  });

  describe("preview", () => {
    it("reports a valid row without writing anything", async () => {
      const preview = await service().preview(
        TUTOR,
        request(["date,start,end,label,repeat", "2030-09-02,09:00,11:00,Maths,weekly"].join("\n")),
      );

      expect(preview.validCount).toBe(1);
      expect(preview.invalidCount).toBe(0);
      expect(preview.duplicateCount).toBe(0);
      expect(preview.term.name).toBe("Demo 2030 Semester 2");
      // Preview is read-only: the schedule is untouched.
      expect(await storedSlots()).toEqual([]);
    });

    it("marks a row that is already in the schedule as a duplicate", async () => {
      await manualSlot({
        startsAt: new Date("2030-09-02T09:00:00.000Z"),
        endsAt: new Date("2030-09-02T11:00:00.000Z"),
        recurrence: "WEEKLY",
        label: "Maths",
        recurrenceUntil: new Date("2030-11-29T23:59:59.999Z"),
      });

      const preview = await service().preview(
        TUTOR,
        request(["date,start,end,label,repeat", "2030-09-02,09:00,11:00,Maths,weekly"].join("\n")),
      );

      expect(preview.duplicateCount).toBe(1);
      expect(preview.validCount).toBe(0);
      expect(preview.rows[0]!.duplicate).toBe(true);
      expect(preview.rows[0]!.errors).toContain("This entry is already in your schedule.");
    });

    it("marks a row repeated inside the same file as a duplicate", async () => {
      const preview = await service().preview(
        TUTOR,
        request(
          [
            "date,start,end,label",
            "2030-09-02,09:00,11:00,Maths",
            "2030-09-02,09:00,11:00,Maths",
          ].join("\n"),
        ),
      );

      expect(preview.validCount).toBe(1);
      expect(preview.duplicateCount).toBe(1);
      expect(preview.rows[1]!.duplicate).toBe(true);
    });

    it("refuses an account with no tutor profile", async () => {
      await expect(
        service().preview("demo|student", request("date,start,end\n2030-09-02,09:00,10:00")),
      ).rejects.toMatchObject({ status: 404, code: "TUTOR_PROFILE_NOT_FOUND" });
    });

    it("refuses an unknown term", async () => {
      await expect(
        service().preview(TUTOR, request("date,start,end\n2030-09-02,09:00,10:00", { termId: 99999 })),
      ).rejects.toMatchObject({ status: 404, code: "ACADEMIC_TERM_NOT_FOUND" });
    });

    it("reports an unreadable file as a request-level error, not a row error", async () => {
      await expect(service().preview(TUTOR, request("not a timetable"))).rejects.toMatchObject({
        status: 400,
        code: "TIMETABLE_IMPORT_INVALID",
      });
    });
  });

  describe("commit", () => {
    it("writes an imported entry as an ordinary TimeSlot row", async () => {
      const result = await service().commit(
        TUTOR,
        request(["date,start,end,label,repeat", "2030-09-02,09:00,11:00,Maths tutorial,weekly"].join("\n")),
      );

      expect(result.created).toBe(1);
      expect(result.invalidCount).toBe(0);
      expect(result.duplicateCount).toBe(0);

      // Nothing import-specific: the same columns the manual form fills.
      expect(await storedSlots()).toEqual([
        {
          id: result.createdIds[0],
          startsAt: "2030-09-02T09:00:00.000Z",
          endsAt: "2030-09-02T11:00:00.000Z",
          recurrence: "WEEKLY",
          label: "Maths tutorial",
          recurrenceUntil: "2030-11-29T23:59:59.999Z",
        },
      ]);
    });

    it("writes nothing at all when the same timetable is imported twice", async () => {
      const text = ["date,start,end,label", "2030-09-02,09:00,11:00,Maths", "2030-09-03,09:00,10:00,Physics"].join("\n");

      const first = await service().commit(TUTOR, request(text));
      expect(first.created).toBe(2);

      const second = await service().commit(TUTOR, request(text));
      expect(second.created).toBe(0);
      expect(second.createdIds).toEqual([]);
      expect(second.duplicateCount).toBe(2);
      expect(second.skipped).toHaveLength(2);
      // The schedule still holds exactly the two original rows.
      expect(await storedSlots()).toHaveLength(2);
    });

    it("writes the valid rows, reports the invalid one, and never writes it partially", async () => {
      const result = await service().commit(
        TUTOR,
        request(
          [
            "date,start,end,label,repeat",
            "2030-09-02,09:00,11:00,Good one,weekly",
            "2030-13-40,09:00,11:00,Bad date,weekly",
            "2030-09-04,09:00,10:00,Good two,once",
          ].join("\n"),
        ),
      );

      expect(result.created).toBe(2);
      expect(result.invalidCount).toBe(1);
      expect(result.skipped).toEqual([
        {
          sourceRow: 3,
          duplicate: false,
          errors: ['"2030-13-40" is not a valid date. Use YYYY-MM-DD.'],
        },
      ]);

      // The bad row left no trace of any kind: no partial row for its date, its
      // times, or its label.
      const slots = await storedSlots();
      expect(slots.map((slot) => slot.label)).toEqual(["Good one", "Good two"]);
      expect(slots.map((slot) => slot.startsAt)).toEqual([
        "2030-09-02T09:00:00.000Z",
        "2030-09-04T09:00:00.000Z",
      ]);
    });

    it("rolls the whole batch back when one insert fails", async () => {
      // Let the first row land, then break the transaction on the second.
      const result = service(1).commit(
        TUTOR,
        request(
          [
            "date,start,end,label",
            "2030-09-02,09:00,11:00,First",
            "2030-09-03,09:00,11:00,Second",
            "2030-09-04,09:00,11:00,Third",
          ].join("\n"),
        ),
      );

      await expect(result).rejects.toMatchObject({ status: 409, code: "TIMETABLE_IMPORT_CONFLICT" });
      // The first insert was issued and must have been rolled back.
      expect(await storedSlots()).toEqual([]);
    });

    it("keeps another tutor's schedule out of the duplicate check and out of the writes", async () => {
      await manualSlot({
        startsAt: new Date("2030-09-02T09:00:00.000Z"),
        endsAt: new Date("2030-09-02T11:00:00.000Z"),
        recurrence: "WEEKLY",
        label: "Maths",
        recurrenceUntil: new Date("2030-11-29T23:59:59.999Z"),
      });

      const result = await service().commit(
        TUTOR,
        request(["date,start,end,label,repeat", "2030-09-06,09:00,11:00,Other day,weekly"].join("\n")),
      );

      expect(result.created).toBe(1);
      const others = await database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "TimeSlot" WHERE "tutorId" <> $1`,
        [tutorId],
      );
      // Only the seed's own pre-existing row for the other tutor remains.
      expect(others.rows[0]!.count).toBe(1);
      // And it was never considered a duplicate of this tutor's import.
      expect(result.duplicateCount).toBe(0);
    });
  });

  describe("term bounds and local time", () => {
    it("stores the tutor's wall clock as the matching instant", async () => {
      const result = await service().commit(
        TUTOR,
        request(["date,start,end,label", "2030-09-02,09:00,11:00,Morning"].join("\n"), {
          timeZone: "Africa/Johannesburg",
        }),
      );

      expect(result.created).toBe(1);
      // 09:00 in UTC+2 is 07:00Z.
      expect((await storedSlots())[0]!.startsAt).toBe("2030-09-02T07:00:00.000Z");
    });

    it("stops a weekly repeat at the last instant of the term's final day", async () => {
      // No repeat-until in the file: the term alone must bound the recurrence.
      const result = await service().commit(
        TUTOR,
        request(["date,start,end,repeat", "2030-09-02,09:00,10:00,weekly"].join("\n")),
      );

      expect(result.created).toBe(1);
      expect((await storedSlots())[0]!.recurrenceUntil).toBe("2030-11-29T23:59:59.999Z");
    });

    it("bounds the recurrence by the term's final day in the row's own zone", async () => {
      const result = await service().commit(
        TUTOR,
        request(["date,start,end,repeat", "2030-09-02,09:00,10:00,weekly"].join("\n"), {
          timeZone: "Africa/Johannesburg",
        }),
      );

      expect(result.created).toBe(1);
      // End of 2030-11-29 in UTC+2.
      expect((await storedSlots())[0]!.recurrenceUntil).toBe("2030-11-29T21:59:59.999Z");
    });

    it("refuses a hand-written repeat-until that outlives the term without writing it", async () => {
      // A repeat-until past the term is a ROW problem, not a file problem: the
      // commit still succeeds, it simply writes nothing for that row. Rejecting
      // the whole request here would contradict the card's "row-level errors,
      // not a whole-file rejection".
      const result = await service().commit(
        TUTOR,
        request(
          ["date,start,end,repeat,until", "2030-09-02,09:00,10:00,weekly,2031-01-01"].join("\n"),
        ),
      );

      expect(result.created).toBe(0);
      expect(result.createdIds).toEqual([]);
      expect(result.invalidCount).toBe(1);
      expect(result.skipped).toEqual([
        {
          sourceRow: 2,
          duplicate: false,
          errors: [
            "The weekly repeat cannot run past Demo 2030 Semester 2, which ends on 2030-11-29.",
          ],
        },
      ]);
      expect(await storedSlots()).toEqual([]);
    });

    it("bounds a repeat by the stored term, not by whatever the caller asked for", async () => {
      // Two terms exist in the seed. Importing into the SECOND one must bound the
      // recurrence to that term's end, which is what proves the service reloads
      // the term from the database instead of trusting the request.
      const second = await database.query<{ id: number }>(
        `SELECT "id" FROM "AcademicTerm" WHERE "name" = 'Demo 2031 Semester 1'`,
      );
      const secondTermId = second.rows[0]!.id;

      const preview = await service().preview(
        TUTOR,
        request(["date,start,end,repeat", "2031-03-03,09:00,10:00,weekly"].join("\n"), {
          termId: secondTermId,
        }),
      );

      // The term echoed back is the stored one, with the stored dates.
      expect(preview.term).toEqual({
        id: secondTermId,
        name: "Demo 2031 Semester 1",
        startsOn: "2031-02-17",
        endsOn: "2031-06-06",
      });
      expect(preview.rows[0]!.localRecurrenceUntil).toBe("2031-06-06");
    });

    it("reports a row outside the chosen term as a row error the tutor can fix", async () => {
      const second = await database.query<{ id: number }>(
        `SELECT "id" FROM "AcademicTerm" WHERE "name" = 'Demo 2031 Semester 1'`,
      );

      const preview = await service().preview(
        TUTOR,
        request(["date,start,end,repeat", "2030-09-02,09:00,10:00,weekly"].join("\n"), {
          termId: second.rows[0]!.id,
        }),
      );

      expect(preview.validCount).toBe(0);
      expect(preview.invalidCount).toBe(1);
      expect(preview.rows[0]!.errors).toEqual([
        "This falls before Demo 2031 Semester 1 starts on 2031-02-17.",
      ]);
    });
  });

  describe("clash parity with manually created entries", () => {
    async function clashFor(startsAt: string, endsAt: string) {
      const candidates = await findAllocationCandidates(asQueryClient(database), {
        courseId,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        minimumMark: 50,
        requestedHours: 2,
      });
      return candidates.find((candidate) => candidate.tutorId === tutorId);
    }

    it("makes an imported weekly entry clash exactly where a hand-written one does", async () => {
      // The same block written both ways. If importing invented its own storage
      // the two would diverge here.
      await service().commit(
        TUTOR,
        request(["date,start,end,label,repeat", "2030-09-02,09:00,11:00,Imported,weekly"].join("\n")),
      );
      const importedOnly = await clashFor("2030-09-16T09:30:00.000Z", "2030-09-16T10:30:00.000Z");
      expect(importedOnly?.hasClash).toBe(true);
      expect(importedOnly?.reasonCodes).toContain("schedule-clash");

      const importedDetails = importedOnly?.clashDetails.map((detail) => detail.label);

      // Clear the schedule and write the identical entry by hand instead.
      await database.query(`DELETE FROM "TimeSlot" WHERE "tutorId" = $1`, [tutorId]);
      await manualSlot({
        startsAt: new Date("2030-09-02T09:00:00.000Z"),
        endsAt: new Date("2030-09-02T11:00:00.000Z"),
        recurrence: "WEEKLY",
        label: "Imported",
        recurrenceUntil: new Date("2030-11-29T23:59:59.999Z"),
      });

      const manualOnly = await clashFor("2030-09-16T09:30:00.000Z", "2030-09-16T10:30:00.000Z");
      expect(manualOnly?.hasClash).toBe(true);
      expect(manualOnly?.reasonCodes).toContain("schedule-clash");

      // Identical verdict, identical evidence.
      expect(manualOnly?.clashDetails.map((detail) => detail.label)).toEqual(importedDetails);
    });

    it("clashes inside the term and stops clashing after it", async () => {
      await service().commit(
        TUTOR,
        request(["date,start,end,label,repeat", "2030-09-02,09:00,11:00,Weekly block,weekly"].join("\n")),
      );

      // 2030-09-02 is a Monday, so the same weekday inside the term clashes.
      const insideTerm = await clashFor("2030-11-25T09:30:00.000Z", "2030-11-25T10:30:00.000Z");
      expect(insideTerm?.hasClash).toBe(true);

      // A week after the term closed, the same weekday window must be clear.
      const afterTerm = await clashFor("2030-12-02T09:30:00.000Z", "2030-12-02T10:30:00.000Z");
      expect(afterTerm?.hasClash).toBe(false);
      expect(afterTerm?.clashDetails).toEqual([]);
    });

    it("agrees with the in-process clash helper on where the term ends", async () => {
      // The SQL expansion and the TypeScript twin must not drift; the week that
      // follows the term is the boundary both must agree on.
      const occurrence = new Date("2030-11-25T09:00:00.000Z");
      const endsAt = new Date("2030-11-29T23:59:59.999Z");

      expect(
        busySlotClashes(
          occurrence,
          new Date("2030-11-25T11:00:00.000Z"),
          "WEEKLY",
          new Date("2030-11-25T09:30:00.000Z"),
          new Date("2030-11-25T10:30:00.000Z"),
          endsAt,
        ),
      ).toBe(true);

      // The next occurrence starts after the bound, so the helper refuses it.
      expect(
        busySlotClashes(
          occurrence,
          new Date("2030-11-25T11:00:00.000Z"),
          "WEEKLY",
          new Date("2030-12-02T09:30:00.000Z"),
          new Date("2030-12-02T10:30:00.000Z"),
          endsAt,
        ),
      ).toBe(false);
    });
  });
});

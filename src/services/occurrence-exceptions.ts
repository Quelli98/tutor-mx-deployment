import { createRouteError } from "../http/errors.js";
import { toNaiveUtcText, type QueryClient } from "./allocation-queries.js";
import { sessionDay } from "./session-attendance.js";

/**
 * Skip or move one occurrence of a repeating timetable entry: the brief's
 * "set recurring exceptions". The allocation clash query and the weekly
 * calendar already read OccurrenceException rows; this is the write side.
 *
 * An occurrence is named by the Johannesburg date it starts on, the same key
 * both readers match on, so a skipped week disappears from the calendar and
 * stops blocking allocations at the same moment. Tutors and Students share it
 * because they share the TimeSlot engine.
 */

export type OccurrenceExceptionInput =
  | { exceptionType: "CANCELLED" }
  | { exceptionType: "MOVED"; newStartsAt: Date; newEndsAt: Date };

interface RepeatingEntry {
  startsAt: Date;
  endsAt: Date;
  recurrence: string | null;
  recurrenceUntil: Date | null;
}

const DAY_MS = 86_400_000;

function periodDays(recurrence: string | null): number {
  if (recurrence === "WEEKLY") return 7;
  if (recurrence === "FORTNIGHTLY") return 14;
  return 0;
}

/**
 * The occurrence of `entry` that starts on `occurrenceDate`, or null when the
 * series has none that day. Johannesburg has no daylight saving, so a whole
 * number of days later is the same wall-clock time, exactly as the SQL
 * expansion (`+ k * interval '7 days'`) computes it.
 */
export function occurrenceOn(
  entry: RepeatingEntry,
  occurrenceDate: string,
): { startsAt: Date; endsAt: Date } | null {
  const period = periodDays(entry.recurrence);
  if (period === 0) return null;
  const days =
    (Date.parse(`${occurrenceDate}T00:00:00Z`) -
      Date.parse(`${sessionDay(entry.startsAt)}T00:00:00Z`)) /
    DAY_MS;
  if (!Number.isInteger(days) || days < 0 || days % period !== 0) return null;
  const startsAt = new Date(entry.startsAt.valueOf() + days * DAY_MS);
  if (entry.recurrenceUntil && startsAt > entry.recurrenceUntil) return null;
  return { startsAt, endsAt: new Date(entry.endsAt.valueOf() + days * DAY_MS) };
}

const utc = (column: string) =>
  `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

async function findOwnRepeatingEntry(
  client: QueryClient,
  ownerId: number,
  timeSlotId: number,
): Promise<RepeatingEntry> {
  const result = await client.query<{
    startsAt: string;
    endsAt: string;
    recurrence: string | null;
    recurrenceUntil: string | null;
  }>(
    `SELECT ${utc('"startsAt"')} AS "startsAt", ${utc('"endsAt"')} AS "endsAt",
            "recurrence", ${utc('"recurrenceUntil"')} AS "recurrenceUntil"
       FROM "TimeSlot"
      WHERE "id" = $1 AND "tutorId" = $2 AND "type" = 'BUSY'`,
    [timeSlotId, ownerId],
  );
  const row = result.rows[0];
  if (!row) {
    throw createRouteError(
      404,
      "TIME_SLOT_NOT_FOUND",
      "The requested time slot could not be found.",
    );
  }
  const entry = {
    startsAt: new Date(row.startsAt),
    endsAt: new Date(row.endsAt),
    recurrence: row.recurrence,
    recurrenceUntil: row.recurrenceUntil ? new Date(row.recurrenceUntil) : null,
  };
  if (periodDays(entry.recurrence) === 0) {
    throw createRouteError(
      409,
      "TIME_SLOT_NOT_REPEATING",
      "Only a repeating entry has a single week to skip or move. Edit a one-off entry instead.",
    );
  }
  return entry;
}

function occurrenceNotFound() {
  return createRouteError(
    404,
    "OCCURRENCE_NOT_FOUND",
    "This entry does not happen on that date.",
  );
}

/** Skips or moves one occurrence. Saving again for the same date replaces it. */
export async function saveOccurrenceException(
  client: QueryClient,
  ownerId: number,
  timeSlotId: number,
  occurrenceDate: string,
  input: OccurrenceExceptionInput,
): Promise<void> {
  const entry = await findOwnRepeatingEntry(client, ownerId, timeSlotId);
  if (!occurrenceOn(entry, occurrenceDate)) throw occurrenceNotFound();

  if (input.exceptionType === "MOVED") {
    const length = input.newEndsAt.valueOf() - input.newStartsAt.valueOf();
    if (length <= 0 || length > periodDays(entry.recurrence) * DAY_MS) {
      throw createRouteError(
        400,
        "VALIDATION_ERROR",
        "The moved time must end after it starts and be no longer than the repeat period.",
      );
    }
  }

  try {
    // One row per occurrence (unique index), so a second change to the same
    // week replaces the first instead of stacking a contradiction.
    await client.query(
      `INSERT INTO "OccurrenceException" ("timeSlotId", "occurrenceDate", "exceptionType", "newStartsAt", "newEndsAt")
       VALUES ($1, $2::date, $3, $4::timestamp, $5::timestamp)
       ON CONFLICT ("timeSlotId", "occurrenceDate") DO UPDATE
         SET "exceptionType" = EXCLUDED."exceptionType",
             "newStartsAt" = EXCLUDED."newStartsAt",
             "newEndsAt" = EXCLUDED."newEndsAt",
             "createdAt" = now()`,
      [
        timeSlotId,
        occurrenceDate,
        input.exceptionType,
        input.exceptionType === "MOVED" ? toNaiveUtcText(input.newStartsAt) : null,
        input.exceptionType === "MOVED" ? toNaiveUtcText(input.newEndsAt) : null,
      ],
    );
  } catch (error) {
    // The entry was deleted between the ownership read and this write.
    if (typeof error === "object" && error && "code" in error && error.code === "23503") {
      throw createRouteError(404, "TIME_SLOT_NOT_FOUND", "The requested time slot could not be found.");
    }
    throw error;
  }
}

/** Puts one occurrence back to its usual time. */
export async function removeOccurrenceException(
  client: QueryClient,
  ownerId: number,
  timeSlotId: number,
  occurrenceDate: string,
): Promise<void> {
  await findOwnRepeatingEntry(client, ownerId, timeSlotId);
  const removed = await client.query<{ id: number }>(
    `DELETE FROM "OccurrenceException"
      WHERE "timeSlotId" = $1 AND "occurrenceDate" = $2::date
      RETURNING "id"`,
    [timeSlotId, occurrenceDate],
  );
  if (removed.rows.length === 0) throw occurrenceNotFound();
}

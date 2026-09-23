/**
 * Persistence for the timetable import (Sprint 3, card S3-M3-1).
 *
 * Two guarantees shape this module:
 *
 * 1. A commit is all-or-nothing. Every saveable row is inserted inside one
 *    transaction. If any insert fails, the whole commit is rolled back and the
 *    tutor is told, so a half-imported timetable can never exist.
 * 2. Nothing is written silently. Rows that carry an error, and rows that
 *    duplicate an entry already in the schedule, are reported back individually
 *    and skipped. Nothing is dropped without a reason the tutor can read.
 *
 * Imported rows are written as ordinary "TimeSlot" rows through the same
 * columns the manual form uses, so the allocation clash queries cannot tell an
 * imported entry from a hand-entered one.
 */

import { toDateOnly } from "./academic-terms.js";
import {
  parseTimetableImport,
  timeSlotDedupeKey,
  type TimetableImportPreview,
  type TimetableImportRequest,
  type TimetableImportRow,
} from "./timetable-import.js";

export interface TimetableImportSkippedRow {
  sourceRow: number;
  duplicate: boolean;
  errors: string[];
}

export interface TimetableImportCommitResult {
  created: number;
  createdIds: number[];
  skipped: TimetableImportSkippedRow[];
  invalidCount: number;
  duplicateCount: number;
}

export interface TimetableImportService {
  preview(
    auth0Id: string,
    request: TimetableImportRequest,
  ): Promise<TimetableImportPreview>;
  commit(
    auth0Id: string,
    request: TimetableImportRequest,
  ): Promise<TimetableImportCommitResult>;
}

interface TutorRow {
  id: number;
  role: string;
}

interface TermRow {
  id: number;
  name: string;
  startsOn: Date;
  endsOn: Date;
}

interface ExistingSlotRow {
  startsAt: Date;
  endsAt: Date;
  recurrence: string | null;
  label: string | null;
}

interface ProfileDelegate {
  findUnique(args: {
    where: { auth0Id: string };
    select: { id: true; role: true };
  }): Promise<TutorRow | null>;
}

interface AcademicTermDelegate {
  findUnique(args: {
    where: { id: number };
    select: { id: true; name: true; startsOn: true; endsOn: true };
  }): Promise<TermRow | null>;
}

interface TimeSlotDelegate {
  findMany(args: {
    where: {
      tutorId: number;
      type: "BUSY";
      startsAt: { gte: Date; lte: Date };
    };
    select: {
      startsAt: true;
      endsAt: true;
      recurrence: true;
      label: true;
    };
  }): Promise<ExistingSlotRow[]>;
  create(args: {
    data: {
      tutorId: number;
      type: "BUSY";
      startsAt: Date;
      endsAt: Date;
      recurrence: string | null;
      label: string | null;
      recurrenceUntil: Date | null;
    };
    select: { id: true };
  }): Promise<{ id: number }>;
}

export interface TimetableImportTransaction {
  timeSlot: TimeSlotDelegate;
}

export interface TimetableImportPrismaClient
  extends TimetableImportTransaction {
  profile: ProfileDelegate;
  academicTerm: AcademicTermDelegate;
  $transaction<Result>(
    operation: (transaction: TimetableImportTransaction) => Promise<Result>,
    options: { isolationLevel: "Serializable" },
  ): Promise<Result>;
}

export interface TimetableImportError extends Error {
  status: 400 | 404 | 409;
  code:
    | "TUTOR_PROFILE_NOT_FOUND"
    | "ACADEMIC_TERM_NOT_FOUND"
    | "TIMETABLE_IMPORT_INVALID"
    | "TIMETABLE_IMPORT_CONFLICT";
}

function importError(
  status: 400 | 404 | 409,
  code: TimetableImportError["code"],
  message: string,
): TimetableImportError {
  const error = new Error(message) as TimetableImportError;
  error.status = status;
  error.code = code;
  return error;
}

function isImportError(value: unknown): value is TimetableImportError {
  return (
    value instanceof Error &&
    "status" in value &&
    "code" in value &&
    typeof (value as TimetableImportError).status === "number" &&
    typeof (value as TimetableImportError).code === "string"
  );
}

/** The file itself could not be read. Row problems are reported per row instead. */
function importInvalid(message: string): TimetableImportError {
  return importError(400, "TIMETABLE_IMPORT_INVALID", message);
}

function tutorNotFound(): TimetableImportError {
  return importError(
    404,
    "TUTOR_PROFILE_NOT_FOUND",
    "No tutor profile is linked to this account.",
  );
}

function termNotFound(): TimetableImportError {
  return importError(
    404,
    "ACADEMIC_TERM_NOT_FOUND",
    "The selected academic term could not be found.",
  );
}

function importConflict(): TimetableImportError {
  return importError(
    409,
    "TIMETABLE_IMPORT_CONFLICT",
    "The timetable could not be saved and nothing was changed. Check your schedule and try again.",
  );
}

function prismaErrorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("code" in value)) {
    return null;
  }
  return typeof value.code === "string" ? value.code : null;
}

async function resolveTutor(
  client: { profile: ProfileDelegate },
  auth0Id: string,
): Promise<TutorRow> {
  const profile = await client.profile.findUnique({
    where: { auth0Id },
    select: { id: true, role: true },
  });
  if (profile?.role !== "TUTOR") {
    throw tutorNotFound();
  }
  return profile;
}

function toTermBounds(term: TermRow) {
  return {
    id: term.id,
    name: term.name,
    startsOn: toDateOnly(term.startsOn),
    endsOn: toDateOnly(term.endsOn),
  };
}

/** Bounds the duplicate lookup to the span the file actually covers. */
function coverageWindow(rows: TimetableImportRow[]): {
  gte: Date;
  lte: Date;
} | null {
  let minimum: number | null = null;
  let maximum: number | null = null;
  for (const row of rows) {
    for (const value of [row.slot?.startsAt, row.slot?.endsAt]) {
      if (!value) {
        continue;
      }
      const instant = new Date(value).valueOf();
      minimum = minimum === null ? instant : Math.min(minimum, instant);
      maximum = maximum === null ? instant : Math.max(maximum, instant);
    }
  }
  if (minimum === null || maximum === null) {
    return null;
  }
  return { gte: new Date(minimum), lte: new Date(maximum) };
}

/**
 * Marks rows that are already in the schedule, and rows that repeat an earlier
 * row in the same file. Existing entries are read once, bounded to the window
 * the file covers, using the same values the manual form writes.
 */
async function markDuplicates(
  client: TimetableImportTransaction,
  tutorId: number,
  rows: TimetableImportRow[],
): Promise<TimetableImportPreview["rows"]> {
  const window = coverageWindow(rows);
  const seen = new Set<string>();

  if (window) {
    const existing = await client.timeSlot.findMany({
      where: { tutorId, type: "BUSY", startsAt: window },
      select: { startsAt: true, endsAt: true, recurrence: true, label: true },
    });
    for (const slot of existing) {
      seen.add(
        timeSlotDedupeKey({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          recurrence: slot.recurrence,
          label: slot.label,
        }),
      );
    }
  }

  return rows.map((row) => {
    if (!row.slot || row.errors.length > 0) {
      return row;
    }
    const key = timeSlotDedupeKey(row.slot);
    if (seen.has(key)) {
      return {
        ...row,
        duplicate: true,
        errors: [...row.errors, "This entry is already in your schedule."],
      };
    }
    seen.add(key);
    return row;
  });
}

function summarize(rows: TimetableImportPreview["rows"]) {
  return {
    validCount: rows.filter((row) => row.slot !== null && !row.duplicate).length,
    invalidCount: rows.filter((row) => row.slot === null).length,
    duplicateCount: rows.filter((row) => row.duplicate).length,
  };
}

export function createTimetableImportService(
  prismaClient: TimetableImportPrismaClient,
): TimetableImportService {
  async function prepare(auth0Id: string, request: TimetableImportRequest) {
    const tutor = await resolveTutor(prismaClient, auth0Id);
    const term = await prismaClient.academicTerm.findUnique({
      where: { id: request.termId },
      select: { id: true, name: true, startsOn: true, endsOn: true },
    });
    if (!term) {
      throw termNotFound();
    }

    // The term is reloaded from the database rather than trusted from the
    // caller, so a stale or hand-crafted repeat-until cannot outlive the term.
    const bounds = toTermBounds(term);
    const parsed = parseTimetableImport({
      source: request.source,
      text: request.text,
      timeZone: request.timeZone,
      term: bounds,
    });
    if ("error" in parsed) {
      return { tutor, error: parsed.error as string, preview: null };
    }
    const rows = await markDuplicates(prismaClient, tutor.id, parsed.rows);
    const preview: TimetableImportPreview = {
      ...parsed,
      rows,
      ...summarize(rows),
    };
    return { tutor, error: null, preview };
  }

  return {
    async preview(auth0Id, request) {
      const { error, preview } = await prepare(auth0Id, request);
      if (error || !preview) {
        throw importInvalid(error ?? "The timetable could not be read.");
      }
      return preview;
    },

    async commit(auth0Id, request) {
      const { tutor, error, preview } = await prepare(auth0Id, request);
      if (error || !preview) {
        throw importInvalid(error ?? "The timetable could not be read.");
      }

      const saveable = preview.rows.filter(
        (row) => row.slot !== null && !row.duplicate,
      );
      const skipped: TimetableImportSkippedRow[] = preview.rows
        .filter((row) => row.slot === null || row.duplicate)
        .map((row) => ({
          sourceRow: row.sourceRow,
          duplicate: row.duplicate,
          errors: row.errors,
        }));

      if (saveable.length === 0) {
        return {
          created: 0,
          createdIds: [],
          skipped,
          invalidCount: preview.invalidCount,
          duplicateCount: preview.duplicateCount,
        };
      }

      try {
        const createdIds = await prismaClient.$transaction(
          async (transaction) => {
            // Re-read inside the transaction so two commits racing each other
            // cannot both insert the same rows.
            const insideRows = await markDuplicates(
              transaction,
              tutor.id,
              saveable.map((row) => ({ ...row, duplicate: false })),
            );
            const writable = insideRows.filter(
              (row) => row.slot !== null && !row.duplicate,
            );
            if (writable.length !== saveable.length) {
              throw importConflict();
            }

            const ids: number[] = [];
            for (const row of writable) {
              const slot = row.slot!;
              const created = await transaction.timeSlot.create({
                data: {
                  tutorId: tutor.id,
                  type: slot.type,
                  startsAt: new Date(slot.startsAt),
                  endsAt: new Date(slot.endsAt),
                  recurrence: slot.recurrence ?? null,
                  label: slot.label,
                  recurrenceUntil: slot.recurrenceUntil
                    ? new Date(slot.recurrenceUntil)
                    : null,
                },
                select: { id: true },
              });
              ids.push(created.id);
            }
            return ids;
          },
          { isolationLevel: "Serializable" },
        );

        return {
          created: createdIds.length,
          createdIds,
          skipped,
          invalidCount: preview.invalidCount,
          duplicateCount: preview.duplicateCount,
        };
      } catch (value) {
        if (isImportError(value)) {
          throw value;
        }
        const code = prismaErrorCode(value);
        if (
          code === "P2002" ||
          code === "P2003" ||
          code === "P2004" ||
          code === "P2034"
        ) {
          throw importConflict();
        }
        throw importConflict();
      }
    },
  };
}

import { createRouteError } from "../http/errors.js";
/**
 * Academic terms (Sprint 3, card S3-M3-1; shared timetable extension).
 *
 * A term exists for one reason: it bounds how far a recurring schedule entry
 * may repeat. Without it, a weekly import row whose repeat-until date was
 * mistyped or omitted would create an open-ended block that silently suppresses
 * allocation forever.
 *
 * Terms are institutional reference data, not per-tutor settings, so there is
 * no owner column and no per-user visibility rule: every signed-in user may
 * read them, and only an organiser may create, update or delete one.
 *
 * The shared timetable adds year/termNumber for structured identification,
 * published for visibility control, and teachingBreaks for holiday awareness.
 */

export interface TeachingBreak {
  startsOn: string;
  endsOn: string;
  label?: string;
}

export interface AcademicTermSummary {
  id: number;
  name: string;
  /** Inclusive first day, YYYY-MM-DD. */
  startsOn: string;
  /** Inclusive last day, YYYY-MM-DD. */
  endsOn: string;
  year: number | null;
  termNumber: number | null;
  published: boolean;
  teachingBreaks: TeachingBreak[];
}

export interface AcademicTermInput {
  name: string;
  startsOn: string;
  endsOn: string;
  year?: number | null;
  termNumber?: number | null;
  published?: boolean;
  teachingBreaks?: TeachingBreak[];
}

export const MAX_ACADEMIC_TERM_NAME_LENGTH = 120;

export interface AcademicTermService {
  list(): Promise<AcademicTermSummary[]>;
  listPublished(): Promise<AcademicTermSummary[]>;
  create(input: AcademicTermInput): Promise<AcademicTermSummary>;
  update(id: number, input: AcademicTermInput): Promise<AcademicTermSummary>;
  remove(id: number): Promise<void>;
}

interface AcademicTermRow {
  id: number;
  name: string;
  startsOn: Date;
  endsOn: Date;
  year: number | null;
  termNumber: number | null;
  published: boolean;
  teachingBreaks: unknown;
}

interface AcademicTermDelegate {
  findMany(args: {
    orderBy: { startsOn: "desc" };
    select: {
      id: true; name: true; startsOn: true; endsOn: true;
      year: true; termNumber: true; published: true; teachingBreaks: true;
    };
  }): Promise<AcademicTermRow[]>;
  findUnique(args: {
    where: { id: number };
    select: {
      id: true; name: true; startsOn: true; endsOn: true;
      year: true; termNumber: true; published: true; teachingBreaks: true;
    };
  }): Promise<AcademicTermRow | null>;
  findFirst(args: {
    where: Record<string, unknown>;
    select: { id: true };
  }): Promise<{ id: number } | null>;
  create(args: {
    data: Record<string, unknown>;
    select: {
      id: true; name: true; startsOn: true; endsOn: true;
      year: true; termNumber: true; published: true; teachingBreaks: true;
    };
  }): Promise<AcademicTermRow>;
  update(args: {
    where: { id: number };
    data: Record<string, unknown>;
    select: {
      id: true; name: true; startsOn: true; endsOn: true;
      year: true; termNumber: true; published: true; teachingBreaks: true;
    };
  }): Promise<AcademicTermRow>;
  delete(args: { where: { id: number } }): Promise<unknown>;
}

export interface AcademicTermPrismaClient {
  academicTerm: AcademicTermDelegate;
}

const termSelection = {
  id: true,
  name: true,
  startsOn: true,
  endsOn: true,
  year: true,
  termNumber: true,
  published: true,
  teachingBreaks: true,
} as const;

/** DATE columns come back as midnight UTC, so the calendar day is read in UTC. */
export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseTeachingBreaks(raw: unknown): TeachingBreak[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is TeachingBreak =>
      typeof item === "object" && item !== null &&
      typeof (item as Record<string, unknown>).startsOn === "string" &&
      typeof (item as Record<string, unknown>).endsOn === "string",
  ).map((item) => ({
    startsOn: (item as TeachingBreak).startsOn,
    endsOn: (item as TeachingBreak).endsOn,
    ...((item as TeachingBreak).label ? { label: (item as TeachingBreak).label } : {}),
  }));
}

function toSummary(row: AcademicTermRow): AcademicTermSummary {
  return {
    id: row.id,
    name: row.name,
    startsOn: toDateOnly(row.startsOn),
    endsOn: toDateOnly(row.endsOn),
    year: row.year,
    termNumber: row.termNumber,
    published: row.published,
    teachingBreaks: parseTeachingBreaks(row.teachingBreaks),
  };
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const probe = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return (
    probe.getUTCFullYear() === Number(match[1]) &&
    probe.getUTCMonth() === Number(match[2]) - 1 &&
    probe.getUTCDate() === Number(match[3])
  );
}

function parseTeachingBreakInput(raw: unknown): { error: string } | { value: TeachingBreak[] } {
  if (raw === undefined) return { value: [] };
  if (!Array.isArray(raw)) return { error: "Teaching breaks must be a list." };
  const breaks: TeachingBreak[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      return { error: "Each teaching break must have startsOn and endsOn." };
    }
    const entry = item as Record<string, unknown>;
    if (!isCalendarDate(entry.startsOn) || !isCalendarDate(entry.endsOn)) {
      return { error: "Teaching break dates must be YYYY-MM-DD." };
    }
    if ((entry.endsOn as string) < (entry.startsOn as string)) {
      return { error: "A teaching break must end on or after its start." };
    }
    breaks.push({
      startsOn: entry.startsOn as string,
      endsOn: entry.endsOn as string,
      ...(typeof entry.label === "string" && entry.label.trim()
        ? { label: (entry.label as string).trim() }
        : {}),
    });
  }
  return { value: breaks };
}

export function parseAcademicTermInput(
  body: unknown,
): { error: string } | { value: AcademicTermInput } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Provide the term name, start date and end date." };
  }
  const payload = body as Record<string, unknown>;
  const allowed = ["name", "startsOn", "endsOn", "year", "termNumber", "published", "teachingBreaks"];
  if (!Object.keys(payload).every((key) => allowed.includes(key))) {
    return { error: "Provide only recognised term fields." };
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name || name.length > MAX_ACADEMIC_TERM_NAME_LENGTH) {
    return {
      error: `Enter a term name of ${MAX_ACADEMIC_TERM_NAME_LENGTH} characters or fewer.`,
    };
  }
  if (!isCalendarDate(payload.startsOn) || !isCalendarDate(payload.endsOn)) {
    return { error: "Enter the term start and end dates as YYYY-MM-DD." };
  }
  if (payload.endsOn < payload.startsOn) {
    return { error: "The term end date must be on or after its start date." };
  }

  const year = payload.year;
  if (year !== undefined && year !== null && (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100)) {
    return { error: "Year must be a four-digit number." };
  }
  const termNumber = payload.termNumber;
  if (termNumber !== undefined && termNumber !== null && (typeof termNumber !== "number" || !Number.isInteger(termNumber) || termNumber < 1 || termNumber > 4)) {
    return { error: "Term number must be 1, 2, 3 or 4." };
  }
  if ((year === null || year === undefined) !== (termNumber === null || termNumber === undefined)) {
    return { error: "Year and term number must both be set or both be empty." };
  }

  const published = payload.published;
  if (published !== undefined && typeof published !== "boolean") {
    return { error: "Published must be true or false." };
  }

  const breaks = parseTeachingBreakInput(payload.teachingBreaks);
  if ("error" in breaks) return breaks;

  return {
    value: {
      name,
      startsOn: payload.startsOn as string,
      endsOn: payload.endsOn as string,
      ...(year !== undefined ? { year: year as number | null } : {}),
      ...(termNumber !== undefined ? { termNumber: termNumber as number | null } : {}),
      ...(published !== undefined ? { published: published as boolean } : {}),
      ...(payload.teachingBreaks !== undefined ? { teachingBreaks: breaks.value } : {}),
    },
  };
}

function parseDateOnlyUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toCreateData(input: AcademicTermInput): Record<string, unknown> {
  return {
    name: input.name,
    startsOn: parseDateOnlyUtc(input.startsOn),
    endsOn: parseDateOnlyUtc(input.endsOn),
    ...(input.year !== undefined ? { year: input.year } : {}),
    ...(input.termNumber !== undefined ? { termNumber: input.termNumber } : {}),
    published: input.published ?? false,
    teachingBreaks: input.teachingBreaks ?? [],
  };
}

export function createAcademicTermService(
  prismaClient: AcademicTermPrismaClient,
): AcademicTermService {
  async function checkOverlap(
    startsOn: string,
    endsOn: string,
    excludeId?: number,
  ): Promise<string | null> {
    const newStart = parseDateOnlyUtc(startsOn);
    const newEnd = parseDateOnlyUtc(endsOn);
    const overlapping = await prismaClient.academicTerm.findFirst({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startsOn: { lte: newEnd },
        endsOn: { gte: newStart },
      },
      select: { id: true },
    });
    if (overlapping) {
      return "Another term already covers those dates. Terms may not overlap.";
    }
    return null;
  }

  async function checkYearTermUnique(
    year: number | null | undefined,
    termNumber: number | null | undefined,
    excludeId?: number,
  ): Promise<string | null> {
    if (year == null || termNumber == null) return null;
    const existing = await prismaClient.academicTerm.findFirst({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        year,
        termNumber,
      },
      select: { id: true },
    });
    if (existing) {
      return `Year ${year} term ${termNumber} is already assigned to another term.`;
    }
    return null;
  }

  return {
    async list() {
      const rows = await prismaClient.academicTerm.findMany({
        orderBy: { startsOn: "desc" },
        select: termSelection,
      });
      return rows.map(toSummary);
    },

    async listPublished() {
      const all = await prismaClient.academicTerm.findMany({
        orderBy: { startsOn: "desc" },
        select: termSelection,
      });
      return all.filter((row) => row.published).map(toSummary);
    },

    async create(input) {
      const overlap = await checkOverlap(input.startsOn, input.endsOn);
      if (overlap) throw createRouteError(409, "ACADEMIC_TERM_CONFLICT", overlap);
      const unique = await checkYearTermUnique(input.year, input.termNumber);
      if (unique) throw createRouteError(409, "ACADEMIC_TERM_CONFLICT", unique);

      const row = await prismaClient.academicTerm.create({
        data: toCreateData(input),
        select: termSelection,
      });
      return toSummary(row);
    },

    async update(id, input) {
      const existing = await prismaClient.academicTerm.findUnique({
        where: { id },
        select: termSelection,
      });
      if (!existing) throw createRouteError(404, "ACADEMIC_TERM_NOT_FOUND", "Term not found.");

      const overlap = await checkOverlap(input.startsOn, input.endsOn, id);
      if (overlap) throw createRouteError(409, "ACADEMIC_TERM_CONFLICT", overlap);
      const unique = await checkYearTermUnique(
        input.year === undefined ? existing.year : input.year,
        input.termNumber === undefined ? existing.termNumber : input.termNumber,
        id,
      );
      if (unique) throw createRouteError(409, "ACADEMIC_TERM_CONFLICT", unique);

      const row = await prismaClient.academicTerm.update({
        where: { id },
        data: {
          name: input.name,
          startsOn: parseDateOnlyUtc(input.startsOn),
          endsOn: parseDateOnlyUtc(input.endsOn),
          ...(input.year !== undefined ? { year: input.year } : {}),
          ...(input.termNumber !== undefined ? { termNumber: input.termNumber } : {}),
          ...(input.published !== undefined ? { published: input.published } : {}),
          ...(input.teachingBreaks !== undefined ? { teachingBreaks: input.teachingBreaks } : {}),
        },
        select: termSelection,
      });
      return toSummary(row);
    },

    async remove(id) {
      await prismaClient.academicTerm.delete({ where: { id } });
    },
  };
}

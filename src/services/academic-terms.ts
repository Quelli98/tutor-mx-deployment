/**
 * Academic terms (Sprint 3, card S3-M3-1).
 *
 * A term exists for one reason: it bounds how far a recurring schedule entry
 * may repeat. Without it, a weekly import row whose repeat-until date was
 * mistyped or omitted would create an open-ended block that silently suppresses
 * allocation forever.
 *
 * Terms are institutional reference data, not per-tutor settings, so there is
 * no owner column and no per-user visibility rule: every signed-in user may
 * read them, and only an organiser may create one.
 */

export interface AcademicTermSummary {
  id: number;
  name: string;
  /** Inclusive first day, YYYY-MM-DD. */
  startsOn: string;
  /** Inclusive last day, YYYY-MM-DD. */
  endsOn: string;
}

export interface AcademicTermInput {
  name: string;
  startsOn: string;
  endsOn: string;
}

export const MAX_ACADEMIC_TERM_NAME_LENGTH = 120;

export interface AcademicTermService {
  list(): Promise<AcademicTermSummary[]>;
  create(input: AcademicTermInput): Promise<AcademicTermSummary>;
}

interface AcademicTermRow {
  id: number;
  name: string;
  startsOn: Date;
  endsOn: Date;
}

interface AcademicTermDelegate {
  findMany(args: {
    orderBy: { startsOn: "desc" };
    select: { id: true; name: true; startsOn: true; endsOn: true };
  }): Promise<AcademicTermRow[]>;
  create(args: {
    data: { name: string; startsOn: Date; endsOn: Date };
    select: { id: true; name: true; startsOn: true; endsOn: true };
  }): Promise<AcademicTermRow>;
}

export interface AcademicTermPrismaClient {
  academicTerm: AcademicTermDelegate;
}

const termSelection = {
  id: true,
  name: true,
  startsOn: true,
  endsOn: true,
} as const;

/** DATE columns come back as midnight UTC, so the calendar day is read in UTC. */
export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toSummary(row: AcademicTermRow): AcademicTermSummary {
  return {
    id: row.id,
    name: row.name,
    startsOn: toDateOnly(row.startsOn),
    endsOn: toDateOnly(row.endsOn),
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

export function parseAcademicTermInput(
  body: unknown,
): { error: string } | { value: AcademicTermInput } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Provide the term name, start date and end date." };
  }
  const payload = body as Record<string, unknown>;
  const allowed = ["name", "startsOn", "endsOn"];
  if (!Object.keys(payload).every((key) => allowed.includes(key))) {
    return { error: "Provide only the term name, start date and end date." };
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

  return {
    value: { name, startsOn: payload.startsOn, endsOn: payload.endsOn },
  };
}

function parseDateOnlyUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function createAcademicTermService(
  prismaClient: AcademicTermPrismaClient,
): AcademicTermService {
  return {
    async list() {
      const rows = await prismaClient.academicTerm.findMany({
        orderBy: { startsOn: "desc" },
        select: termSelection,
      });
      return rows.map(toSummary);
    },

    async create(input) {
      const row = await prismaClient.academicTerm.create({
        data: {
          name: input.name,
          startsOn: parseDateOnlyUtc(input.startsOn),
          endsOn: parseDateOnlyUtc(input.endsOn),
        },
        select: termSelection,
      });
      return toSummary(row);
    },
  };
}

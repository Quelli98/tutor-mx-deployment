export interface QueryResult<Row> {
  rows: Row[];
}

export interface QueryClient {
  query<Row>(sql: string, parameters?: unknown[]): Promise<QueryResult<Row>>;
}

export type CandidateReasonCode =
  | "insufficient-mark"
  | "schedule-clash"
  | "hour-limit-exceeded";

export interface AllocationRuleCheck {
  mark: number | null | undefined;
  minimumMark: number | null | undefined;
  hasClash: boolean | null | undefined;
  remainingHours: number | null | undefined;
  requestedHours: number | null | undefined;
}

export interface ClashDetail {
  kind: "busy" | "allocation";
  label: string | null;
  startsAt: string;
  endsAt: string;
  recurrence: "WEEKLY" | "ONCE" | null;
}

interface CandidateRow {
  tutorId: number;
  fullName: string;
  mark: number | null;
  weeklyLimit: number;
  usedHours: number;
  remainingHours: number;
  hasClash: boolean;
  isEligible: boolean;
  clashDetails: ClashDetail[];
}

export interface AllocationCandidate extends CandidateRow {
  reasonCodes: CandidateReasonCode[];
}

export interface CandidateQuery {
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  minimumMark: number;
  requestedHours: number;
  excludeAllocationId?: number;
}

export interface TutorHourSummary {
  tutorId: number;
  weeklyLimit: number;
  usedHours: number;
  remainingHours: number;
}

export interface OpenWorkItem {
  id: number;
  courseCode: string;
  courseName: string;
  startsAt: Date;
  endsAt: Date;
  hours: number;
  status: "OPEN";
  closesAt: Date | null;
}

export function meetsMinimumMark(
  mark: number | null | undefined,
  minimumMark: number | null | undefined,
): boolean | null {
  if (
    !Number.isFinite(mark) ||
    !Number.isFinite(minimumMark) ||
    mark! < 0 ||
    mark! > 100 ||
    minimumMark! < 0 ||
    minimumMark! > 100
  ) {
    return null;
  }

  return mark! >= minimumMark!;
}

export function timeRangesOverlap(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
  otherStartsAt: Date | null | undefined,
  otherEndsAt: Date | null | undefined,
): boolean | null {
  const timestamps = [startsAt, endsAt, otherStartsAt, otherEndsAt].map(
    (value) => (value instanceof Date ? value.valueOf() : Number.NaN),
  );
  if (
    timestamps.some((value) => !Number.isFinite(value)) ||
    timestamps[1]! <= timestamps[0]! ||
    timestamps[3]! <= timestamps[2]!
  ) {
    return null;
  }

  return timestamps[0]! < timestamps[3]! && timestamps[2]! < timestamps[1]!;
}

export function hasEnoughRemainingHours(
  remainingHours: number | null | undefined,
  requestedHours: number | null | undefined,
): boolean | null {
  if (
    !Number.isFinite(remainingHours) ||
    !Number.isFinite(requestedHours) ||
    remainingHours! < 0 ||
    requestedHours! <= 0
  ) {
    return null;
  }

  return remainingHours! >= requestedHours!;
}

export function toNaiveUtcText(value: Date): string {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a tutor BUSY interval clashes with a requested allocation window.
 *
 * A non-recurring slot clashes only on its own absolute window, using the same
 * half-open rule as {@link timeRangesOverlap} (touching intervals do not clash).
 * A WEEKLY slot repeats every seven days from its first occurrence, so it
 * clashes when any occurrence on or after that first week overlaps the window.
 * Occurrences before the slot's own start are never counted, which is what
 * stops a recurring slot from flagging a false clash for a session that
 * predates it. This is the in-process twin of the WEEKLY branch in
 * {@link candidateQuerySql}; both are pinned to identical verdicts by test.
 */
export function busySlotClashes(
  slotStartsAt: Date | null | undefined,
  slotEndsAt: Date | null | undefined,
  recurrence: string | null | undefined,
  windowStartsAt: Date | null | undefined,
  windowEndsAt: Date | null | undefined,
  recurrenceUntil?: Date | null,
): boolean {
  const values = [slotStartsAt, slotEndsAt, windowStartsAt, windowEndsAt].map(
    (value) => (value instanceof Date ? value.valueOf() : Number.NaN),
  );
  const slotStart = values[0]!;
  const slotEnd = values[1]!;
  const windowStart = values[2]!;
  const windowEnd = values[3]!;
  if (
    values.some((value) => !Number.isFinite(value)) ||
    slotEnd <= slotStart ||
    windowEnd <= windowStart
  ) {
    return false;
  }

  if (recurrence !== "WEEKLY") {
    return slotStart < windowEnd && slotEnd > windowStart;
  }

  const k = Math.max(0, Math.floor((windowStart - slotEnd) / WEEK_MS) + 1);
  const occurrenceStart = slotStart + k * WEEK_MS;
  return occurrenceStart < windowEnd &&
    slotEnd + k * WEEK_MS > windowStart &&
    (recurrenceUntil == null || occurrenceStart <= recurrenceUntil.valueOf());
}

function tutorHoursSql(weekParameter: string, excludeParameter = "NULL") {
  return `
    SELECT p."id" AS "tutorId", thl."weeklyHours" AS "weeklyLimit",
      COALESCE(SUM(a."allocatedHours"), 0) AS "usedHours",
      CASE WHEN thl."weeklyHours" IS NULL THEN NULL
        ELSE GREATEST(thl."weeklyHours" - COALESCE(SUM(a."allocatedHours"), 0), 0)
      END AS "remainingHours"
    FROM "Profile" p
    LEFT JOIN "TutorHourLimit" thl ON thl."tutorId" = p."id"
    LEFT JOIN "Allocation" a ON a."tutorId" = p."id"
      AND a."status" = 'CONFIRMED'
      AND a."startsAt" >= date_trunc('week', ${weekParameter}::timestamp)
      AND a."startsAt" < date_trunc('week', ${weekParameter}::timestamp) + interval '7 days'
      AND (${excludeParameter}::integer IS NULL OR a."id" <> ${excludeParameter})
    WHERE p."role" = 'TUTOR'
    GROUP BY p."id", thl."weeklyHours"
  `;
}

export const candidateQuerySql = `
WITH tutor_hours AS (${tutorHoursSql("$2", "$6")}), candidate_data AS (
  SELECT p."id" AS "tutorId", p."fullName",
    tm."mark"::double precision AS "mark",
    COALESCE(th."weeklyLimit", 0)::double precision AS "weeklyLimit",
    th."usedHours"::double precision AS "usedHours",
    COALESCE(th."remainingHours", 0)::double precision AS "remainingHours",
    conflicts.details IS NOT NULL AS "hasClash",
    COALESCE(conflicts.details, '[]'::jsonb) AS "clashDetails"
  FROM "Profile" p
  JOIN "TutorMark" tm ON tm."tutorId" = p."id" AND tm."courseId" = $1
  JOIN tutor_hours th ON th."tutorId" = p."id"
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'kind', c.kind, 'label', c.label,
      'startsAt', to_char(c.starts_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endsAt', to_char(c.ends_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'recurrence', c.recurrence
    ) ORDER BY c.starts_at, c.kind, c.label) AS details
    FROM (
      SELECT 'busy' AS kind, ts."label" AS label,
        occurrence.starts_at, occurrence.ends_at, ts."recurrence" AS recurrence
      FROM "TimeSlot" ts
      CROSS JOIN LATERAL (
        SELECT ts."startsAt" AS starts_at, ts."endsAt" AS ends_at
        WHERE ts."recurrence" IS DISTINCT FROM 'WEEKLY'
        UNION ALL
        SELECT ts."startsAt" + k * interval '7 days', ts."endsAt" + k * interval '7 days'
        FROM LATERAL (
          SELECT GREATEST(0, floor(extract(epoch FROM ($2::timestamp - ts."endsAt")) / 604800) + 1)::bigint AS k
        ) projected
        WHERE ts."recurrence" = 'WEEKLY'
          AND (ts."recurrenceUntil" IS NULL OR ts."startsAt" + k * interval '7 days' <= ts."recurrenceUntil")
      ) occurrence
      WHERE ts."tutorId" = p."id" AND ts."type" = 'BUSY'
        AND occurrence.starts_at < $3::timestamp AND occurrence.ends_at > $2::timestamp
      UNION ALL
      SELECT 'allocation', course."code", clash."startsAt", clash."endsAt", NULL
      FROM "Allocation" clash JOIN "Course" course ON course."id" = clash."courseId"
      WHERE clash."tutorId" = p."id" AND clash."status" = 'CONFIRMED'
        AND ($6::integer IS NULL OR clash."id" <> $6)
        AND clash."startsAt" < $3::timestamp AND clash."endsAt" > $2::timestamp
    ) c
  ) conflicts ON true
  WHERE p."role" = 'TUTOR'
)
SELECT *, ("mark" >= $4 AND NOT "hasClash" AND "remainingHours" >= $5) AS "isEligible"
FROM candidate_data
ORDER BY "isEligible" DESC, "mark" DESC, "fullName" ASC;
`;

export const tutorHourSummarySql = `
WITH tutor_hours AS (${tutorHoursSql("$2")})
SELECT "tutorId", "weeklyLimit"::double precision, "usedHours"::double precision,
  "remainingHours"::double precision
FROM tutor_hours WHERE "tutorId" = $1 AND "weeklyLimit" IS NOT NULL;
`;

export interface TutorWorkload {
  tutorId: number;
  weeklyLimit: number | null;
  usedHours: number;
  remainingHours: number | null;
  workedHours: number;
  weekStart: string;
  weekEnd: string;
  capacityStatus: "available" | "near-limit" | "limit-reached" | "not-set";
}

export async function getTutorWorkloads(client: QueryClient, weekStart: Date): Promise<TutorWorkload[]> {
  if (weekStart.getUTCDay() !== 1 || weekStart.toISOString().slice(11) !== "00:00:00.000Z") {
    throw new RangeError("weekStart must be a Monday at midnight in UTC");
  }
  const result = await client.query<Omit<TutorWorkload, "weekStart" | "weekEnd">>(`
    WITH tutor_hours AS (${tutorHoursSql("$1")})
    SELECT th."tutorId", th."weeklyLimit"::double precision, th."usedHours"::double precision,
      th."remainingHours"::double precision,
      COALESCE((SELECT SUM(w."hours") FROM "WorkLog" w
        WHERE w."tutorId" = th."tutorId" AND w."workDate" >= $1::date
          AND w."workDate" < $1::date + interval '7 days'), 0)::double precision AS "workedHours",
      CASE WHEN th."weeklyLimit" IS NULL THEN 'not-set'
        WHEN th."remainingHours" = 0 THEN 'limit-reached'
        WHEN th."usedHours" >= th."weeklyLimit" * 0.8 THEN 'near-limit'
        ELSE 'available' END AS "capacityStatus"
    FROM tutor_hours th ORDER BY th."tutorId"
  `, [toNaiveUtcText(weekStart)]);
  return result.rows.map((row) => ({
    ...row,
    weekStart: weekStart.toISOString(),
    weekEnd: new Date(weekStart.valueOf() + WEEK_MS).toISOString(),
  }));
}

export const openWorkQuerySql = `
SELECT
  ow."id",
  c."code" AS "courseCode",
  c."name" AS "courseName",
  ow."startsAt",
  ow."endsAt",
  ow."hours"::double precision AS "hours",
  ow."status",
  ow."closesAt"
FROM "OverflowWork" ow
JOIN "Course" c ON c."id" = ow."courseId"
WHERE ow."status" = 'OPEN'
  AND ow."startsAt" > $1::timestamp
  AND (ow."closesAt" IS NULL OR ow."closesAt" > $1::timestamp)
ORDER BY ow."startsAt" ASC, c."code" ASC;
`;

function assertCandidateQuery(input: CandidateQuery): void {
  if (!Number.isInteger(input.courseId) || input.courseId <= 0) {
    throw new RangeError("courseId must be a positive integer");
  }
  if (input.endsAt <= input.startsAt) {
    throw new RangeError("endsAt must be later than startsAt");
  }
  if (input.minimumMark < 0 || input.minimumMark > 100) {
    throw new RangeError("minimumMark must be between 0 and 100");
  }
  if (input.requestedHours <= 0 || input.requestedHours > 24) {
    throw new RangeError("requestedHours must be between 0 and 24");
  }
  if (
    input.excludeAllocationId !== undefined &&
    (!Number.isInteger(input.excludeAllocationId) ||
      input.excludeAllocationId <= 0)
  ) {
    throw new RangeError("excludeAllocationId must be a positive integer");
  }
}

export function allocationReasonCodesFor(
  check: AllocationRuleCheck,
): CandidateReasonCode[] {
  const reasons: CandidateReasonCode[] = [];

  if (meetsMinimumMark(check.mark, check.minimumMark) !== true) {
    reasons.push("insufficient-mark");
  }
  if (check.hasClash !== false) {
    reasons.push("schedule-clash");
  }
  if (
    hasEnoughRemainingHours(check.remainingHours, check.requestedHours) !== true
  ) {
    reasons.push("hour-limit-exceeded");
  }

  return reasons;
}

export async function findAllocationCandidates(
  client: QueryClient,
  input: CandidateQuery,
): Promise<AllocationCandidate[]> {
  assertCandidateQuery(input);
  const result = await client.query<CandidateRow>(candidateQuerySql, [
    input.courseId,
    toNaiveUtcText(input.startsAt),
    toNaiveUtcText(input.endsAt),
    input.minimumMark,
    input.requestedHours,
    input.excludeAllocationId ?? null,
  ]);

  return result.rows.map((row) => ({
    ...row,
    reasonCodes: allocationReasonCodesFor({
      mark: row.mark,
      minimumMark: input.minimumMark,
      hasClash: row.hasClash,
      remainingHours: row.remainingHours,
      requestedHours: input.requestedHours,
    }),
  }));
}

export async function getTutorHourSummary(
  client: QueryClient,
  tutorId: number,
  weekStart: Date,
): Promise<TutorHourSummary | null> {
  if (!Number.isInteger(tutorId) || tutorId <= 0) {
    throw new RangeError("tutorId must be a positive integer");
  }
  if (weekStart.getUTCDay() !== 1) {
    throw new RangeError("weekStart must be a Monday in UTC");
  }

  const result = await client.query<TutorHourSummary>(tutorHourSummarySql, [
    tutorId,
    toNaiveUtcText(weekStart),
  ]);
  return result.rows[0] ?? null;
}

export async function listOpenWork(
  client: QueryClient,
  now = new Date(),
): Promise<OpenWorkItem[]> {
  const result = await client.query<OpenWorkItem>(openWorkQuerySql, [
    toNaiveUtcText(now),
  ]);
  return result.rows;
}

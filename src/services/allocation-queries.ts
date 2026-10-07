import { assertResultLimit, MAX_CANDIDATES } from "../http/limits.js";
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
  recurrence: "WEEKLY" | "FORTNIGHTLY" | "ONCE" | null;
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
  /** The tutor's mark rounded down to its band of ten: 84 becomes 80. */
  markBand: number;
  /**
   * Weekly hours already used as a fraction of the tutor's limit, the second
   * ranking step. A ranking input only - never shown to anyone. The board says
   * "4 of 10 hours used that week", using usedHours and weeklyLimit, because a
   * raw decimal like 0.4 means nothing to an organiser. Do not render it.
   */
  capacityShare: number;
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
const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Whether a tutor BUSY interval clashes with a requested allocation window.
 *
 * A non-recurring slot clashes only on its own absolute window, using the same
 * half-open rule as {@link timeRangesOverlap} (touching intervals do not clash).
 * A WEEKLY slot repeats every seven days from its first occurrence, so it
 * clashes when any occurrence on or after that first week overlaps the window.
 * A FORTNIGHTLY slot repeats every fourteen days.
 * Occurrences before the slot's own start are never counted, which is what
 * stops a recurring slot from flagging a false clash for a session that
 * predates it. This is the in-process twin of the recurrence branch in
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

  if (recurrence !== "WEEKLY" && recurrence !== "FORTNIGHTLY") {
    return slotStart < windowEnd && slotEnd > windowStart;
  }

  const periodMs = recurrence === "FORTNIGHTLY" ? FORTNIGHT_MS : WEEK_MS;
  const k = Math.max(0, Math.floor((windowStart - slotEnd) / periodMs) + 1);
  const occurrenceStart = slotStart + k * periodMs;
  return occurrenceStart < windowEnd &&
    slotEnd + k * periodMs > windowStart &&
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
      AND NOT EXISTS (SELECT 1 FROM "Excuse" sick WHERE sick."allocationId" = a."id" AND sick."status" = 'APPROVED')
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
        WHERE ts."recurrence" IS DISTINCT FROM 'WEEKLY' AND ts."recurrence" IS DISTINCT FROM 'FORTNIGHTLY'
        UNION ALL
        SELECT ts."startsAt" + k * interval '7 days', ts."endsAt" + k * interval '7 days'
        FROM LATERAL (
          SELECT GREATEST(0, floor(extract(epoch FROM ($2::timestamp - ts."endsAt")) / 604800) + 1)::bigint AS k
        ) projected
        WHERE ts."recurrence" = 'WEEKLY'
          AND (ts."recurrenceUntil" IS NULL OR ts."startsAt" + k * interval '7 days' <= ts."recurrenceUntil")
        UNION ALL
        SELECT ts."startsAt" + k * interval '14 days', ts."endsAt" + k * interval '14 days'
        FROM LATERAL (
          SELECT GREATEST(0, floor(extract(epoch FROM ($2::timestamp - ts."endsAt")) / 1209600) + 1)::bigint AS k
        ) projected
        WHERE ts."recurrence" = 'FORTNIGHTLY'
          AND (ts."recurrenceUntil" IS NULL OR ts."startsAt" + k * interval '14 days' <= ts."recurrenceUntil")
      ) occurrence
      WHERE ts."tutorId" = p."id" AND ts."type" = 'BUSY'
        AND occurrence.starts_at < $3::timestamp AND occurrence.ends_at > $2::timestamp
        AND NOT EXISTS (SELECT 1 FROM "OccurrenceException" ex
          WHERE ex."timeSlotId" = ts."id"
            AND ex."occurrenceDate" = (occurrence.starts_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Johannesburg')::date
            AND (ex."exceptionType" = 'CANCELLED' OR ex."newStartsAt" IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM "AcademicTerm" term,
          LATERAL jsonb_array_elements(term."teachingBreaks") pause
          WHERE term."id" = ts."termId" AND ts."recurrence" IN ('WEEKLY', 'FORTNIGHTLY')
            AND (occurrence.starts_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Johannesburg')::date
              BETWEEN (pause->>'startsOn')::date AND (pause->>'endsOn')::date)
      UNION ALL
      SELECT 'busy', ts."label", ex."newStartsAt", ex."newEndsAt", ts."recurrence"
      FROM "TimeSlot" ts JOIN "OccurrenceException" ex ON ex."timeSlotId" = ts."id"
      WHERE ts."tutorId" = p."id" AND ts."type" = 'BUSY' AND ex."exceptionType" <> 'CANCELLED'
        AND ex."newStartsAt" < $3::timestamp AND ex."newEndsAt" > $2::timestamp
      UNION ALL
      SELECT 'allocation', course."code", clash."startsAt", clash."endsAt", NULL
      FROM "Allocation" clash JOIN "Course" course ON course."id" = clash."courseId"
      WHERE clash."tutorId" = p."id" AND clash."status" = 'CONFIRMED'
        AND NOT EXISTS (SELECT 1 FROM "Excuse" sick WHERE sick."allocationId" = clash."id" AND sick."status" = 'APPROVED')
        AND ($6::integer IS NULL OR clash."id" <> $6)
        AND clash."startsAt" < $3::timestamp AND clash."endsAt" > $2::timestamp
      UNION ALL
      SELECT 'busy', 'Tutoring booking', b."startsAt", b."endsAt", NULL
      FROM "TutoringBooking" b
      WHERE b."tutorId"=p."id" AND b."status"='CONFIRMED' AND b."occurrenceStatus"<>'EXCUSED'
        AND b."startsAt"<$3::timestamp AND b."endsAt">$2::timestamp
    ) c
  ) conflicts ON true
  WHERE p."role" = 'TUTOR'
)
SELECT *, ("mark" >= $4 AND NOT "hasClash" AND "remainingHours" >= $5) AS "isEligible"
FROM candidate_data
ORDER BY "isEligible" DESC, "mark" DESC, "fullName" ASC, "tutorId" ASC LIMIT 2001;
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

/**
 * Where an eligible tutor sits in the ranking, as the four things it compares.
 * Ineligible tutors are never ranked, so this is only built for eligible rows.
 */
function rankingKey(candidate: AllocationCandidate) {
  return {
    markBand: candidate.markBand,
    capacityShare: candidate.capacityShare,
    mark: candidate.mark ?? 0,
    tutorId: candidate.tutorId,
  };
}

/**
 * The ranking rule, in one sentence: best mark band first, then whoever has used
 * the smallest share of their weekly hours that week, then the exact mark, then
 * tutor id so the order never changes between loads.
 *
 * Bands come first because a 91 and a 96 are both "excellent" and splitting them
 * by decimals would hand every session to one tutor until they are full. Share
 * rather than raw hours, because tutors have different weekly limits: four hours
 * used means something different at a limit of five than at twenty.
 *
 * Every step is a number an organiser can see on the card. There is deliberately
 * no combined score, because a score cannot be explained or argued with.
 */
export function compareEligibleCandidates(
  first: AllocationCandidate,
  second: AllocationCandidate,
): number {
  const left = rankingKey(first);
  const right = rankingKey(second);

  return (
    right.markBand - left.markBand ||
    left.capacityShare - right.capacityShare ||
    right.mark - left.mark ||
    left.tutorId - right.tutorId
  );
}

/**
 * Rank the eligible tutors and leave everyone else exactly where the query put
 * them. Eligibility itself is decided by candidateQuerySql and is never touched
 * here: this only changes the order the eligible ones are offered in.
 */
export function rankAllocationCandidates(
  candidates: AllocationCandidate[],
): AllocationCandidate[] {
  const eligible = candidates
    .filter((candidate) => candidate.isEligible)
    .sort(compareEligibleCandidates);
  const ineligible = candidates.filter((candidate) => !candidate.isEligible);

  return [...eligible, ...ineligible];
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

  assertResultLimit(result.rows, MAX_CANDIDATES, "Candidate ranking");
  const candidates = result.rows.map((row) => ({
    ...row,
    reasonCodes: allocationReasonCodesFor({
      mark: row.mark,
      minimumMark: input.minimumMark,
      hasClash: row.hasClash,
      remainingHours: row.remainingHours,
      requestedHours: input.requestedHours,
    }),
    markBand: Math.floor((row.mark ?? 0) / 10) * 10,
    // Every eligible tutor has a weekly limit above zero, because a tutor
    // without one can never have the remaining hours a session needs. The guard
    // keeps the arithmetic safe for the ineligible rows that are never ranked.
    capacityShare:
      row.weeklyLimit > 0 ? row.usedHours / row.weeklyLimit : Number.POSITIVE_INFINITY,
  }));

  return rankAllocationCandidates(candidates);
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

export interface AssignedHoursRow {
  requirementId: number;
  assignedHours: number;
}

/**
 * Confirmed tutor-hours already covering each staffing requirement.
 *
 * A booking counts only for the part of it that falls inside the requirement
 * window, in proportion to how much of the booking that is: a 13:00-17:00
 * booking of four hours contributes one hour to a 10:00-14:00 requirement.
 * `allocatedHours` is not tied to a booking's own length anywhere in this system,
 * so the work is treated as spread evenly across the booked window - the only
 * assumption the stored data supports. The share can never exceed the booking.
 *
 * Overlap is the same half-open rule used everywhere else: touching intervals do
 * not count, and only CONFIRMED allocations do, matching the capacity rule in
 * {@link tutorHoursSql}. `staffing-shortage.test.ts` pins these verdicts to
 * {@link timeRangesOverlap} so the two definitions cannot drift apart.
 *
 * One statement covers every requirement in the list, so listing many of them
 * never turns into one query per row.
 */
export const assignedHoursForRequirementsSql = `
SELECT sr."id" AS "requirementId",
  COALESCE(
    ROUND(
      SUM(
        a."allocatedHours"
        * (
            EXTRACT(EPOCH FROM (
              LEAST(a."endsAt", sr."endsAt") - GREATEST(a."startsAt", sr."startsAt")
            ))
            / EXTRACT(EPOCH FROM (a."endsAt" - a."startsAt"))
          )
      )::numeric,
      2
    ),
    0
  )::double precision AS "assignedHours"
FROM "StaffingRequirement" sr
LEFT JOIN "Allocation" a
  ON a."courseId" = sr."courseId"
 AND a."status" = 'CONFIRMED'
      AND NOT EXISTS (SELECT 1 FROM "Excuse" sick WHERE sick."allocationId" = a."id" AND sick."status" = 'APPROVED')
 AND a."startsAt" < sr."endsAt"
 AND a."endsAt" > sr."startsAt"
WHERE sr."id" = ANY($1::integer[])
GROUP BY sr."id";
`;

export async function getAssignedHoursForRequirements(
  client: QueryClient,
  requirementIds: number[],
): Promise<Map<number, number>> {
  if (requirementIds.length === 0) {
    return new Map();
  }
  if (requirementIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new RangeError("requirementIds must be positive integers");
  }

  const result = await client.query<AssignedHoursRow>(
    assignedHoursForRequirementsSql,
    [requirementIds],
  );
  return new Map(result.rows.map((row) => [row.requirementId, row.assignedHours]));
}

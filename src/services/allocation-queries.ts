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

interface CandidateRow {
  tutorId: number;
  fullName: string;
  mark: number;
  weeklyLimit: number;
  usedHours: number;
  remainingHours: number;
  hasClash: boolean;
  isEligible: boolean;
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

export const candidateQuerySql = `
WITH tutor_hours AS (
  SELECT
    p."id" AS "tutorId",
    COALESCE(thl."weeklyHours", 0)::double precision AS "weeklyLimit",
    COALESCE(SUM(a."allocatedHours") FILTER (
      WHERE a."status" = 'CONFIRMED'
        AND a."startsAt" >= date_trunc('week', $2::timestamp)
        AND a."startsAt" < date_trunc('week', $2::timestamp) + interval '7 days'
    ), 0)::double precision AS "usedHours"
  FROM "Profile" p
  LEFT JOIN "TutorHourLimit" thl ON thl."tutorId" = p."id"
  LEFT JOIN "Allocation" a ON a."tutorId" = p."id"
  WHERE p."role" = 'TUTOR'
  GROUP BY p."id", thl."weeklyHours"
), candidate_data AS (
  SELECT
    p."id" AS "tutorId",
    p."fullName",
    tm."mark"::double precision AS "mark",
    th."weeklyLimit",
    th."usedHours",
    GREATEST(th."weeklyLimit" - th."usedHours", 0)::double precision AS "remainingHours",
    (
      EXISTS (
        SELECT 1 FROM "TimeSlot" ts
        WHERE ts."tutorId" = p."id"
          AND ts."type" = 'BUSY'
          AND ts."startsAt" < $3::timestamp
          AND ts."endsAt" > $2::timestamp
      )
      OR EXISTS (
        SELECT 1 FROM "Allocation" clash
        WHERE clash."tutorId" = p."id"
          AND clash."status" = 'CONFIRMED'
          AND clash."startsAt" < $3::timestamp
          AND clash."endsAt" > $2::timestamp
      )
    ) AS "hasClash"
  FROM "Profile" p
  JOIN "TutorMark" tm ON tm."tutorId" = p."id" AND tm."courseId" = $1
  JOIN tutor_hours th ON th."tutorId" = p."id"
  WHERE p."role" = 'TUTOR'
)
SELECT
  *,
  ("mark" >= $4 AND NOT "hasClash" AND "remainingHours" >= $5) AS "isEligible"
FROM candidate_data
ORDER BY "isEligible" DESC, "mark" DESC, "fullName" ASC;
`;

export const tutorHourSummarySql = `
SELECT
  p."id" AS "tutorId",
  thl."weeklyHours"::double precision AS "weeklyLimit",
  COALESCE(SUM(a."allocatedHours") FILTER (
    WHERE a."status" = 'CONFIRMED'
      AND a."startsAt" >= $2::date
      AND a."startsAt" < $2::date + interval '7 days'
  ), 0)::double precision AS "usedHours",
  GREATEST(
    thl."weeklyHours" - COALESCE(SUM(a."allocatedHours") FILTER (
      WHERE a."status" = 'CONFIRMED'
        AND a."startsAt" >= $2::date
        AND a."startsAt" < $2::date + interval '7 days'
    ), 0),
    0
  )::double precision AS "remainingHours"
FROM "Profile" p
JOIN "TutorHourLimit" thl ON thl."tutorId" = p."id"
LEFT JOIN "Allocation" a ON a."tutorId" = p."id"
WHERE p."id" = $1 AND p."role" = 'TUTOR'
GROUP BY p."id", thl."weeklyHours";
`;

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
}

function reasonCodesFor(
  row: CandidateRow,
  input: CandidateQuery,
): CandidateReasonCode[] {
  const reasons: CandidateReasonCode[] = [];

  if (row.mark < input.minimumMark) {
    reasons.push("insufficient-mark");
  }
  if (row.hasClash) {
    reasons.push("schedule-clash");
  }
  if (row.remainingHours < input.requestedHours) {
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
    input.startsAt,
    input.endsAt,
    input.minimumMark,
    input.requestedHours,
  ]);

  return result.rows.map((row) => ({
    ...row,
    reasonCodes: reasonCodesFor(row, input),
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
    weekStart,
  ]);
  return result.rows[0] ?? null;
}

export async function listOpenWork(
  client: QueryClient,
  now = new Date(),
): Promise<OpenWorkItem[]> {
  const result = await client.query<OpenWorkItem>(openWorkQuerySql, [now]);
  return result.rows;
}

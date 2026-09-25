import type { QueryClient } from "./allocation-queries.js";
import {
  groupSearchResults,
  toCourseResult,
  toPersonResult,
  toTimesheetResult,
  toVolunteerResult,
  type CourseRow,
  type PersonRow,
  type SearchCategory,
  type SearchResultGroup,
  type SearchResultItem,
  type SearchRole,
  type TimesheetRow,
  type VolunteerRow,
} from "./search.js";

export interface SearchProfile {
  id: number;
  role: SearchRole;
}

export interface ResolvedSearchQuery {
  term: string;
  categories: SearchCategory[];
  page: number;
  pageSize: number;
}

export interface SearchResponse {
  groups: SearchResultGroup[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SearchService {
  search(
    profile: SearchProfile,
    query: ResolvedSearchQuery,
  ): Promise<SearchResponse>;
}

/**
 * Wrap a search term as a bounded "contains" ILIKE pattern. The term is always
 * passed as a bound parameter; only the LIKE wildcards % and _ are neutralised
 * so a user cannot smuggle wildcard scans into the query.
 */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/gu, "\\$&")}%`;
}

const COURSE_SQL_ORGANISER = `
SELECT "id", "code", "name"
FROM "Course"
WHERE "code" ILIKE $1 OR "name" ILIKE $1
ORDER BY "code" ASC
LIMIT $2 OFFSET $3;
`;

const COURSE_SQL_TUTOR = `
SELECT DISTINCT c."id", c."code", c."name"
FROM "Course" c
JOIN "Allocation" a ON a."courseId" = c."id"
WHERE a."tutorId" = $4 AND (c."code" ILIKE $1 OR c."name" ILIKE $1)
ORDER BY c."code" ASC
LIMIT $2 OFFSET $3;
`;

const COURSE_SQL_STUDENT = `
SELECT DISTINCT c."id", c."code", c."name"
FROM "Course" c
JOIN "OverflowWork" ow ON ow."courseId" = c."id"
WHERE c."code" ILIKE $1 OR c."name" ILIKE $1
ORDER BY c."code" ASC
LIMIT $2 OFFSET $3;
`;

const PERSON_SQL_ORGANISER = `
SELECT "id", "fullName", "role"::text AS "role"
FROM "Profile"
WHERE "role" IN ('TUTOR', 'STUDENT')
  AND ("fullName" ILIKE $1 OR "email" ILIKE $1)
ORDER BY "fullName" ASC, "id" ASC
LIMIT $2 OFFSET $3;
`;

const TIMESHEET_SQL_ORGANISER = `
SELECT t."id", t."status"::text AS "status", t."weekStart", p."fullName" AS "tutorName"
FROM "Timesheet" t
JOIN "Profile" p ON p."id" = t."tutorId"
WHERE p."fullName" ILIKE $1 OR t."status"::text ILIKE $1
ORDER BY t."weekStart" DESC, t."id" DESC
LIMIT $2 OFFSET $3;
`;

const TIMESHEET_SQL_TUTOR = `
SELECT t."id", t."status"::text AS "status", t."weekStart", p."fullName" AS "tutorName"
FROM "Timesheet" t
JOIN "Profile" p ON p."id" = t."tutorId"
WHERE t."tutorId" = $4
  AND (t."status"::text ILIKE $1 OR to_char(t."weekStart", 'YYYY-MM-DD') ILIKE $1)
ORDER BY t."weekStart" DESC, t."id" DESC
LIMIT $2 OFFSET $3;
`;

const VOLUNTEER_SQL_STUDENT = `
SELECT vc."id", vc."status"::text AS "status", c."code" AS "courseCode", c."name" AS "courseName"
FROM "VolunteerClaim" vc
JOIN "OverflowWork" ow ON ow."id" = vc."overflowWorkId"
JOIN "Course" c ON c."id" = ow."courseId"
WHERE vc."studentId" = $4
  AND (c."code" ILIKE $1 OR c."name" ILIKE $1 OR vc."status"::text ILIKE $1)
ORDER BY vc."createdAt" DESC, vc."id" DESC
LIMIT $2 OFFSET $3;
`;

async function searchCourses(
  client: QueryClient,
  profile: SearchProfile,
  pattern: string,
  pageSize: number,
  offset: number,
): Promise<SearchResultItem[]> {
  if (profile.role === "ORGANISER") {
    const result = await client.query<CourseRow>(COURSE_SQL_ORGANISER, [
      pattern,
      pageSize,
      offset,
    ]);
    return result.rows.map((row) => toCourseResult(row, profile.role));
  }
  if (profile.role === "TUTOR") {
    const result = await client.query<CourseRow>(COURSE_SQL_TUTOR, [
      pattern,
      pageSize,
      offset,
      profile.id,
    ]);
    return result.rows.map((row) => toCourseResult(row, profile.role));
  }
  const result = await client.query<CourseRow>(COURSE_SQL_STUDENT, [
    pattern,
    pageSize,
    offset,
  ]);
  return result.rows.map((row) => toCourseResult(row, profile.role));
}

async function searchPeople(
  client: QueryClient,
  profile: SearchProfile,
  pattern: string,
  pageSize: number,
  offset: number,
): Promise<SearchResultItem[]> {
  const result = await client.query<PersonRow>(PERSON_SQL_ORGANISER, [
    pattern,
    pageSize,
    offset,
  ]);
  return result.rows.map((row) => toPersonResult(row, profile.role));
}

async function searchTimesheets(
  client: QueryClient,
  profile: SearchProfile,
  pattern: string,
  pageSize: number,
  offset: number,
): Promise<SearchResultItem[]> {
  if (profile.role === "ORGANISER") {
    const result = await client.query<TimesheetRow>(TIMESHEET_SQL_ORGANISER, [
      pattern,
      pageSize,
      offset,
    ]);
    return result.rows.map((row) => toTimesheetResult(row, profile.role));
  }
  const result = await client.query<TimesheetRow>(TIMESHEET_SQL_TUTOR, [
    pattern,
    pageSize,
    offset,
    profile.id,
  ]);
  return result.rows.map((row) => toTimesheetResult(row, profile.role));
}

async function searchVolunteer(
  client: QueryClient,
  profile: SearchProfile,
  pattern: string,
  pageSize: number,
  offset: number,
): Promise<SearchResultItem[]> {
  const result = await client.query<VolunteerRow>(VOLUNTEER_SQL_STUDENT, [
    pattern,
    pageSize,
    offset,
    profile.id,
  ]);
  return result.rows.map((row) => toVolunteerResult(row, profile.role));
}

/**
 * DB-backed search. Every query is ownership-scoped from the authenticated
 * profile and bounded by LIMIT/OFFSET, so no branch can perform an unbounded
 * scan or read another user's records. Categories are already role-filtered by
 * resolveSearchCategories before they reach this service.
 */
export function createSearchService(client: QueryClient): SearchService {
  return {
    async search(profile, query) {
      const pattern = likePattern(query.term);
      const offset = (query.page - 1) * query.pageSize;
      const collected: SearchResultItem[] = [];

      for (const category of query.categories) {
        if (category === "course") {
          collected.push(
            ...(await searchCourses(
              client,
              profile,
              pattern,
              query.pageSize,
              offset,
            )),
          );
        } else if (category === "person" && profile.role === "ORGANISER") {
          collected.push(
            ...(await searchPeople(
              client,
              profile,
              pattern,
              query.pageSize,
              offset,
            )),
          );
        } else if (category === "timesheet" && profile.role !== "STUDENT") {
          collected.push(
            ...(await searchTimesheets(
              client,
              profile,
              pattern,
              query.pageSize,
              offset,
            )),
          );
        } else if (category === "volunteer" && profile.role === "STUDENT") {
          collected.push(
            ...(await searchVolunteer(
              client,
              profile,
              pattern,
              query.pageSize,
              offset,
            )),
          );
        }
      }

      const groups = groupSearchResults(profile.role, collected);
      return {
        groups,
        total: collected.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  };
}

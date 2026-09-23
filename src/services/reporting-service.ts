import type {
  CourseReportRow,
  TutorReportRow,
  WorkloadReport,
  WorkloadReportQuery,
} from "../app.js";
import { toNaiveUtcText, type QueryClient } from "./allocation-queries.js";

/**
 * Three kinds of hours are reported, and they are never added together or
 * derived from one another:
 *
 * - capacity: what a tutor could work, from their weekly limit
 * - allocated: what they are booked for, from CONFIRMED allocations
 * - approved worked: what they did and had signed off, from work logs on
 *   APPROVED timesheets
 *
 * Each comes from its own table and keeps its own name all the way to the
 * screen. The existing workedHours figure on the tutor screen counts every work
 * log whatever its timesheet says, and is deliberately left alone: this adds a
 * separate approved figure rather than redefining that one.
 *
 * Capacity is reported per tutor only. A tutor's weekly limit is not divided
 * between courses, so a per-course capacity would count the same hours once for
 * every course they teach.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Allocated hours are bucketed by the week a session starts, matching the
 * capacity check; worked hours by the date worked. For one piece of work these
 * can fall in different weeks, which the screen notes.
 */
export const courseReportSql = `
SELECT c."id" AS "courseId", c."code" AS "courseCode", c."name" AS "courseName",
  c."hourlyRate"::double precision AS "hourlyRate",
  c."budget"::double precision AS "budget",
  COALESCE((
    SELECT SUM(a."allocatedHours") FROM "Allocation" a
    WHERE a."courseId" = c."id" AND a."status" = 'CONFIRMED'
      AND a."startsAt" >= $1::timestamp AND a."startsAt" < $2::timestamp
  ), 0)::double precision AS "allocatedHours",
  COALESCE((
    SELECT SUM(w."hours") FROM "WorkLog" w
    JOIN "Allocation" wa ON wa."id" = w."allocationId"
    JOIN "Timesheet" t ON t."id" = w."timesheetId"
    WHERE wa."courseId" = c."id" AND t."status" = 'APPROVED'
      AND w."workDate" >= $1::date AND w."workDate" < $2::date
  ), 0)::double precision AS "approvedWorkedHours"
FROM "Course" c
ORDER BY c."code" ASC;
`;

export const tutorReportSql = `
SELECT p."id" AS "tutorId", p."fullName",
  thl."weeklyHours"::double precision AS "weeklyLimit",
  COALESCE((
    SELECT SUM(a."allocatedHours") FROM "Allocation" a
    WHERE a."tutorId" = p."id" AND a."status" = 'CONFIRMED'
      AND a."startsAt" >= $1::timestamp AND a."startsAt" < $2::timestamp
  ), 0)::double precision AS "allocatedHours",
  COALESCE((
    SELECT SUM(w."hours") FROM "WorkLog" w
    JOIN "Timesheet" t ON t."id" = w."timesheetId"
    WHERE w."tutorId" = p."id" AND t."status" = 'APPROVED'
      AND w."workDate" >= $1::date AND w."workDate" < $2::date
  ), 0)::double precision AS "approvedWorkedHours"
FROM "Profile" p
LEFT JOIN "TutorHourLimit" thl ON thl."tutorId" = p."id"
WHERE p."role" = 'TUTOR'
ORDER BY p."fullName" ASC, p."id" ASC;
`;

interface CourseRow {
  courseId: number;
  courseCode: string;
  courseName: string;
  hourlyRate: number | null;
  budget: number | null;
  allocatedHours: number;
  approvedWorkedHours: number;
}

interface TutorRow {
  tutorId: number;
  fullName: string;
  weeklyLimit: number | null;
  allocatedHours: number;
  approvedWorkedHours: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(hours: number, hourlyRate: number | null): number | null {
  // No rate means no money figure at all. A zero would read as "this was free".
  return hourlyRate === null ? null : round(hours * hourlyRate);
}

export function createReportingService(queryClient: QueryClient) {
  return {
    /**
     * Reads only: this service is built with a query client and never the Prisma
     * client, so a report cannot change anything it reports on.
     */
    async workloadReport(query: WorkloadReportQuery): Promise<WorkloadReport> {
      const weekStart = query.weekStart;
      const weekEnd = new Date(weekStart.valueOf() + query.weeks * WEEK_MS);
      const parameters = [toNaiveUtcText(weekStart), toNaiveUtcText(weekEnd)];

      const [courseResult, tutorResult] = await Promise.all([
        queryClient.query<CourseRow>(courseReportSql, parameters),
        queryClient.query<TutorRow>(tutorReportSql, parameters),
      ]);

      const courses: CourseReportRow[] = courseResult.rows.map((row) => {
        // Spend is what is owed: hours done and signed off. Committed is what is
        // booked but not yet worked, kept separate so neither is mistaken for
        // the other.
        const spend = money(row.approvedWorkedHours, row.hourlyRate);
        const committed = money(row.allocatedHours, row.hourlyRate);

        return {
          courseId: row.courseId,
          courseCode: row.courseCode,
          courseName: row.courseName,
          allocatedHours: round(row.allocatedHours),
          approvedWorkedHours: round(row.approvedWorkedHours),
          hourlyRate: row.hourlyRate,
          budget: row.budget,
          spend,
          committed,
          budgetRemaining:
            row.budget === null || spend === null ? null : round(row.budget - spend),
        };
      });

      const totalAllocated = tutorResult.rows.reduce(
        (total, row) => total + row.allocatedHours,
        0,
      );

      const tutors: TutorReportRow[] = tutorResult.rows.map((row) => ({
        tutorId: row.tutorId,
        fullName: row.fullName,
        // Capacity over the period at the tutor's current weekly limit. Limits
        // are not kept historically, so a past period is measured with today's.
        capacityHours:
          row.weeklyLimit === null ? null : round(row.weeklyLimit * query.weeks),
        allocatedHours: round(row.allocatedHours),
        approvedWorkedHours: round(row.approvedWorkedHours),
        shareOfAllocatedHours:
          totalAllocated === 0 ? 0 : round(row.allocatedHours / totalAllocated),
      }));

      return {
        period: {
          weekStart: weekStart.toISOString(),
          weekEnd: weekEnd.toISOString(),
          weeks: query.weeks,
        },
        courses,
        tutors,
      };
    },
  };
}

import { assertResultLimit, MAX_REPORT_ROWS, MAX_PAYROLL_ROWS } from "../http/limits.js";
import type {
  CourseReportRow,
  PayrollExport,
  PayrollExportRow,
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
WITH allocated AS (
  SELECT "courseId", SUM("allocatedHours") AS hours
  FROM "Allocation" WHERE "status" = 'CONFIRMED'
    AND "startsAt" >= $1::timestamp AND "startsAt" < $2::timestamp
  GROUP BY "courseId"
), worked AS (
  SELECT a."courseId", SUM(w."hours") AS hours,
    SUM(w."hours" * w."approvedHourlyRate") AS spend
  FROM "WorkLog" w
  JOIN "Allocation" a ON a."id" = w."allocationId"
  JOIN "Timesheet" t ON t."id" = w."timesheetId"
  WHERE t."status" = 'APPROVED'
    AND NOT EXISTS (SELECT 1 FROM "Excuse" sick WHERE sick."allocationId" = w."allocationId" AND sick."tutorId" = w."tutorId" AND sick."status" = 'APPROVED') AND w."workDate" >= $1::date AND w."workDate" < $2::date
  GROUP BY a."courseId"
)
SELECT c."id" AS "courseId", c."code" AS "courseCode", c."name" AS "courseName",
  c."hourlyRate"::double precision AS "hourlyRate", c."budget"::double precision AS "budget",
  COALESCE(a.hours, 0)::double precision AS "allocatedHours",
  COALESCE(w.hours, 0)::double precision AS "approvedWorkedHours",
  w.spend::double precision AS "approvedSpend"
FROM "Course" c
LEFT JOIN allocated a ON a."courseId" = c."id"
LEFT JOIN worked w ON w."courseId" = c."id"
ORDER BY c."code" ASC, c."id" ASC LIMIT 5001;
`;

export const tutorReportSql = `
WITH allocated AS (
  SELECT "tutorId", SUM("allocatedHours") AS hours
  FROM "Allocation" WHERE "status" = 'CONFIRMED'
    AND "startsAt" >= $1::timestamp AND "startsAt" < $2::timestamp
  GROUP BY "tutorId"
), worked AS (
  SELECT w."tutorId", SUM(w."hours") AS hours
  FROM "WorkLog" w JOIN "Timesheet" t ON t."id" = w."timesheetId"
  WHERE t."status" = 'APPROVED'
    AND NOT EXISTS (SELECT 1 FROM "Excuse" sick WHERE sick."allocationId" = w."allocationId" AND sick."tutorId" = w."tutorId" AND sick."status" = 'APPROVED') AND w."workDate" >= $1::date AND w."workDate" < $2::date
  GROUP BY w."tutorId"
)
SELECT p."id" AS "tutorId", p."fullName", thl."weeklyHours"::double precision AS "weeklyLimit",
  COALESCE(a.hours, 0)::double precision AS "allocatedHours",
  COALESCE(w.hours, 0)::double precision AS "approvedWorkedHours"
FROM "Profile" p
LEFT JOIN "TutorHourLimit" thl ON thl."tutorId" = p."id"
LEFT JOIN allocated a ON a."tutorId" = p."id"
LEFT JOIN worked w ON w."tutorId" = p."id"
WHERE p."role" = 'TUTOR'
ORDER BY p."fullName" ASC, p."id" ASC LIMIT 5001;
`;

/**
 * The payroll lines: approved work, split into the weeks it was signed off in and
 * the tutor and course that earned it. The week is the timesheet's own, which the
 * work-log rules keep equal to the week the work was done in, so a line cannot be
 * labelled with a week that does not contain it.
 *
 * The where clause is the one the two reports above count with - an approved
 * sheet, and a date inside the period - and the join to the sheet is an inner one,
 * so work that was never submitted cannot reach payroll. An objection that is
 * still open is flagged on the line rather than dropped from it: those hours are
 * then held, and remain visible as the reason the totals differ from the report.
 */
export const payrollExportSql = `
SELECT to_char(t."weekStart", 'YYYY-MM-DD') AS "periodStart",
  to_char(t."weekStart" + INTERVAL '6 days', 'YYYY-MM-DD') AS "periodEnd",
  p."id" AS "tutorId", p."fullName" AS "tutor",
  c."code" AS "courseCode", c."name" AS "courseName",
  SUM(w."hours")::double precision AS "hours",
  EXISTS (
    SELECT 1 FROM "TimesheetDispute" d
    WHERE d."timesheetId" = t."id" AND d."status" = 'OPEN'
  ) AS "held"
FROM "WorkLog" w
JOIN "Timesheet" t ON t."id" = w."timesheetId"
JOIN "Allocation" a ON a."id" = w."allocationId"
JOIN "Course" c ON c."id" = a."courseId"
JOIN "Profile" p ON p."id" = w."tutorId"
WHERE t."status" = 'APPROVED'
    AND NOT EXISTS (SELECT 1 FROM "Excuse" sick WHERE sick."allocationId" = w."allocationId" AND sick."tutorId" = w."tutorId" AND sick."status" = 'APPROVED')
  AND w."workDate" >= $1::date AND w."workDate" < $2::date
GROUP BY t."id", t."weekStart", p."id", p."fullName", c."id", c."code", c."name"
ORDER BY t."weekStart" ASC, p."fullName" ASC, p."id" ASC, c."code" ASC LIMIT 10001;
`;

interface CourseRow {
  courseId: number;
  courseCode: string;
  courseName: string;
  hourlyRate: number | null;
  budget: number | null;
  allocatedHours: number;
  approvedWorkedHours: number;
  approvedSpend: number | null;
}

interface TutorRow {
  tutorId: number;
  fullName: string;
  weeklyLimit: number | null;
  allocatedHours: number;
  approvedWorkedHours: number;
}

/**
 * One week of one tutor's work on one course. The week is read as text because
 * it names a week rather than an instant, and payroll reads it as a label.
 */
interface PayrollRow {
  periodStart: string;
  periodEnd: string;
  tutorId: number;
  tutor: string;
  courseCode: string;
  courseName: string;
  hours: number;
  held: boolean;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A period is whole weeks from the chosen Monday, and every figure in this
 * service measures exactly those weeks. Both the workload report and the payroll
 * export ask for it here, so the two can be compared figure for figure instead
 * of agreeing by convention.
 */
function periodOf(query: WorkloadReportQuery) {
  const weekStart = query.weekStart;
  const weekEnd = new Date(weekStart.valueOf() + query.weeks * WEEK_MS);
  return {
    weekStart,
    weekEnd,
    // Naive text, because the columns these are compared against are plain
    // timestamps and dates rather than instants with a zone.
    parameters: [toNaiveUtcText(weekStart), toNaiveUtcText(weekEnd)],
  };
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
      const { weekStart, weekEnd, parameters } = periodOf(query);

      const [courseResult, tutorResult] = await Promise.all([
        queryClient.query<CourseRow>(courseReportSql, parameters),
        queryClient.query<TutorRow>(tutorReportSql, parameters),
      ]);

      assertResultLimit(courseResult.rows, MAX_REPORT_ROWS, "Course report");
      assertResultLimit(tutorResult.rows, MAX_REPORT_ROWS, "Tutor report");
      const courses: CourseReportRow[] = courseResult.rows.map((row) => {
        // Spend is what is owed: hours done and signed off, priced at the rate
        // that was in force when they were approved. Committed is what is
        // booked but not yet worked, kept separate so neither is mistaken for
        // the other, and still read at the current rate since that work has
        // not been approved yet.
        const spend = row.approvedSpend === null ? null : round(row.approvedSpend);
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

    /**
     * The lines a payroll run is built from, in the order a payroll clerk reads
     * them: by week, then tutor, then course. Payable and held lines are
     * reported side by side rather than netted off, so a total that differs from
     * the workload report can be explained from the file itself.
     */
    async payrollExport(query: WorkloadReportQuery): Promise<PayrollExport> {
      const { weekStart, weekEnd, parameters } = periodOf(query);
      const result = await queryClient.query<PayrollRow>(
        payrollExportSql,
        parameters,
      );

      assertResultLimit(result.rows, MAX_PAYROLL_ROWS, "Payroll export");
      const lines: PayrollExportRow[] = result.rows.map((row) => ({
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        tutorId: row.tutorId,
        tutor: row.tutor,
        courseCode: row.courseCode,
        courseName: row.courseName,
        hours: round(row.hours),
        status: "APPROVED",
        held: row.held,
      }));

      const rows = lines.filter((line) => !line.held);
      const heldRows = lines.filter((line) => line.held);
      const totalOf = (list: PayrollExportRow[]) =>
        round(list.reduce((sum, line) => sum + line.hours, 0));

      return {
        period: {
          weekStart: weekStart.toISOString(),
          weekEnd: weekEnd.toISOString(),
          weeks: query.weeks,
        },
        rows,
        heldRows,
        totals: {
          payableHours: totalOf(rows),
          heldHours: totalOf(heldRows),
          // All of it, so the parts always add up to the whole and the whole is
          // what the workload report shows.
          approvedHours: totalOf(lines),
        },
      };
    },
  };
}

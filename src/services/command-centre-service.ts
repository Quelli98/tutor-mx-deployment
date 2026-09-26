import type {
  CommandCentreStaffingDay,
  CommandCentreSummary,
  CourseReportRow,
  OrganiserApprovalQueuesSummary,
  OrganiserOverflowWorkSummary,
  StaffingRequirementSummary,
  WorkloadReport,
  WorkloadReportQuery,
} from "../app.js";
import { fillStateFor } from "./staffing-requirement-service.js";
import type { TimesheetDisputeSummary } from "./timesheet-corrections.js";

/**
 * The Command Centre puts five existing reads side by side for one period of
 * whole weeks and adds up what they already define. Staffing hours stay the
 * staffing requirement service's figures, money stays the reporting service's,
 * and every queue stays the length of the queue it comes from. Nothing here
 * re-derives a number one of those services owns: the only work this service
 * does is scoping the staffing requirements to the period, because the
 * requirement list is the one read with no period of its own.
 *
 * It is built from readers alone, so a screen that only reports on work cannot
 * change any of it.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumOf<Row>(rows: Row[], pick: (row: Row) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * A total of a money column, or null when nothing could be priced. Null never
 * stands for zero here: a course with no hourly rate has no spend figure at
 * all, and a total that skipped it would read as if it had spent nothing.
 */
function sumMoney(
  rows: CourseReportRow[],
  pick: (row: CourseReportRow) => number | null,
): number | null {
  const values = rows
    .map(pick)
    .filter((value): value is number => value !== null);
  return values.length === 0 ? null : round(sumOf(values, (value) => value));
}

/**
 * Budget less spend over the courses that carry a budget. Null when no course
 * has one, and null as soon as one budgeted course has no rate: the answer
 * would otherwise be short by whatever that course went on to spend.
 */
function remainingOf(courses: CourseReportRow[]): number | null {
  const budgeted = courses.filter((course) => course.budget !== null);
  if (budgeted.length === 0) return null;

  const priced = budgeted.filter(
    (
      course,
    ): course is CourseReportRow & { budget: number; spend: number } =>
      course.spend !== null,
  );
  if (priced.length !== budgeted.length) return null;

  return round(sumOf(priced, (course) => course.budget - course.spend));
}

/**
 * One cell of the shortage heatmap per day of the period. Each day is the sum
 * of the requirements that start on it, which is the same way the reports
 * bucket their work, and the day's fill state is the staffing service's own
 * rule rather than a second opinion about what "full" means. A day with
 * nothing on it keeps its zeros and has no state at all.
 */
function daysOf(
  requirements: StaffingRequirementSummary[],
  weekStart: number,
  weekEnd: number,
): CommandCentreStaffingDay[] {
  const byDay = new Map<string, StaffingRequirementSummary[]>();
  for (const requirement of requirements) {
    const day = requirement.startsAt.slice(0, 10);
    const rows = byDay.get(day);
    if (rows) {
      rows.push(requirement);
    } else {
      byDay.set(day, [requirement]);
    }
  }

  const days: CommandCentreStaffingDay[] = [];
  for (let time = weekStart; time < weekEnd; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    const rows = byDay.get(date) ?? [];
    const requiredHours = round(sumOf(rows, (row) => row.requiredHours));
    const assignedHours = round(sumOf(rows, (row) => row.assignedHours));
    const unfilledHours = round(sumOf(rows, (row) => row.shortageHours));

    days.push({
      date,
      requiredHours,
      assignedHours,
      unfilledHours,
      requirements: rows.length,
      fillState:
        rows.length === 0
          ? null
          : fillStateFor(assignedHours, unfilledHours, "OPEN"),
    });
  }

  return days;
}

export interface CommandCentreReaders {
  /** Every OPEN staffing requirement; the period is applied here, not there. */
  listOpenStaffingRequirements: () => Promise<StaffingRequirementSummary[]>;
  /** The report the finance and workload panels are read from, unchanged. */
  workloadReport: (query: WorkloadReportQuery) => Promise<WorkloadReport>;
  listApprovals: () => Promise<OrganiserApprovalQueuesSummary>;
  listOverflowWork: () => Promise<OrganiserOverflowWorkSummary[]>;
  /** The organiser's open disputes, read for the organiser who is asking. */
  listOpenDisputes: (auth0Id: string) => Promise<TimesheetDisputeSummary[]>;
}

export interface CommandCentreService {
  summary(
    auth0Id: string,
    query: WorkloadReportQuery,
  ): Promise<CommandCentreSummary>;
}

export function createCommandCentreService(
  readers: CommandCentreReaders,
): CommandCentreService {
  return {
    async summary(auth0Id, query) {
      const weekStart = query.weekStart.valueOf();
      const weekEnd = weekStart + query.weeks * WEEK_MS;

      const [requirements, report, approvals, overflowWork, disputes] =
        await Promise.all([
          readers.listOpenStaffingRequirements(),
          readers.workloadReport(query),
          readers.listApprovals(),
          readers.listOverflowWork(),
          readers.listOpenDisputes(auth0Id),
        ]);

      // The reports bucket work by the week a session starts in, so the same
      // rule decides which requirements belong to the period. A requirement
      // dated outside it is another period's problem, not this screen's.
      const inPeriod = requirements.filter((requirement) => {
        const startsAt = Date.parse(requirement.startsAt);
        return (
          Number.isFinite(startsAt) && startsAt >= weekStart && startsAt < weekEnd
        );
      });
      const unfilled = inPeriod.filter(
        (requirement) => requirement.shortageHours > 0,
      );

      const openOverflow = overflowWork.filter((item) => item.status === "OPEN");
      const courses = report.courses;

      return {
        period: {
          weekStart: query.weekStart.toISOString(),
          // Exclusive, as the reports read it: the Monday after the last week.
          weekEnd: new Date(weekEnd).toISOString(),
          weeks: query.weeks,
        },
        staffing: {
          requiredHours: round(
            sumOf(inPeriod, (requirement) => requirement.requiredHours),
          ),
          assignedHours: round(
            sumOf(inPeriod, (requirement) => requirement.assignedHours),
          ),
          unfilledHours: round(
            sumOf(inPeriod, (requirement) => requirement.shortageHours),
          ),
          openRequirements: inPeriod.length,
          unfilledRequirements: unfilled.length,
          requirements: inPeriod,
          days: daysOf(inPeriod, weekStart, weekEnd),
        },
        finance: {
          budget: sumMoney(courses, (course) => course.budget),
          spend: sumMoney(courses, (course) => course.spend),
          committed: sumMoney(courses, (course) => course.committed),
          remaining: remainingOf(courses),
          // The same rule the report's own screen uses: a budget is overspent
          // when the money owed for approved work has passed it.
          overBudgetCourses: courses.filter(
            (course) =>
              course.budgetRemaining !== null && course.budgetRemaining < 0,
          ).length,
          // Courses with work in the period and no rate to price it with. Their
          // hours are in the rows below and absent from every money figure, and
          // the screen says so rather than showing a total that looks whole.
          unpricedCourses: courses.filter(
            (course) =>
              course.hourlyRate === null &&
              (course.allocatedHours > 0 || course.approvedWorkedHours > 0),
          ).length,
          courses,
        },
        workload: { tutors: report.tutors },
        actions: {
          pendingTimesheets: approvals.timesheets.length,
          pendingVolunteerClaims: approvals.volunteerClaims.length,
          pendingExcuses: approvals.excuses.length,
          openDisputes: disputes.length,
          // What is waiting on the organiser, counted from the queues above
          // rather than from a separate query that could disagree with them.
          total:
            approvals.timesheets.length +
            approvals.volunteerClaims.length +
            approvals.excuses.length +
            disputes.length,
        },
        overflow: {
          openItems: openOverflow.length,
          openHours: round(sumOf(openOverflow, (item) => item.hours)),
          // Work offered to students that nobody has claimed yet: the count of
          // claims comes from the overflow service, not from a second read.
          unclaimedItems: openOverflow.filter((item) => item.pendingClaims === 0)
            .length,
        },
      };
    },
  };
}

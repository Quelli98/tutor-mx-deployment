import { describe, expect, it, vi } from "vitest";
import type {
  CourseReportRow,
  OrganiserApprovalQueuesSummary,
  OrganiserOverflowWorkSummary,
  StaffingRequirementSummary,
  TutorReportRow,
  WorkloadReport,
} from "../app.js";
import {
  createCommandCentreService,
  type CommandCentreReaders,
} from "./command-centre-service.js";
import type { TimesheetDisputeSummary } from "./timesheet-corrections.js";

/** A Monday, the day every period in this system starts on. */
const WEEK_START = new Date("2030-09-02T00:00:00.000Z");

function requirement(
  overrides: Partial<StaffingRequirementSummary> = {},
): StaffingRequirementSummary {
  return {
    id: 12,
    courseId: 3,
    courseCode: "COMS3011",
    courseName: "Software Design Project",
    startsAt: "2030-09-04T14:00:00.000Z",
    endsAt: "2030-09-04T18:00:00.000Z",
    tutorsNeeded: 2,
    windowHours: 4,
    requiredHours: 8,
    assignedHours: 0,
    shortageHours: 8,
    shortageTutors: 2,
    fillState: "unfilled",
    status: "OPEN",
    notes: null,
    createdById: 8,
    createdAt: "2026-09-21T09:00:00.000Z",
    updatedAt: "2026-09-21T09:00:00.000Z",
    ...overrides,
  };
}

function course(overrides: Partial<CourseReportRow> = {}): CourseReportRow {
  return {
    courseId: 3,
    courseCode: "COMS3011",
    courseName: "Software Design Project",
    allocatedHours: 0,
    approvedWorkedHours: 0,
    hourlyRate: null,
    budget: null,
    spend: null,
    committed: null,
    budgetRemaining: null,
    ...overrides,
  };
}

function tutor(overrides: Partial<TutorReportRow> = {}): TutorReportRow {
  return {
    tutorId: 7,
    fullName: "Ada Tutor",
    capacityHours: 40,
    allocatedHours: 4,
    approvedWorkedHours: 0,
    shareOfAllocatedHours: 1,
    ...overrides,
  };
}

function overflow(
  overrides: Partial<OrganiserOverflowWorkSummary> = {},
): OrganiserOverflowWorkSummary {
  return {
    id: 4,
    courseId: 3,
    courseCode: "COMS3011",
    courseName: "Software Design Project",
    startsAt: "2030-09-04T14:00:00.000Z",
    endsAt: "2030-09-04T18:00:00.000Z",
    hours: 4,
    windowHours: 4,
    status: "OPEN",
    closesAt: null,
    sourceRequirementId: null,
    pendingClaims: 0,
    acceptedClaims: 0,
    createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-09-23T09:00:00.000Z",
    ...overrides,
  };
}

function dispute(id: number): TimesheetDisputeSummary {
  return {
    id,
    timesheetId: 21,
    tutorId: 7,
    reason: "The hours are wrong.",
    status: "OPEN",
    raisedByProfileId: 7,
    resolvedByProfileId: null,
    resolutionReason: null,
    resolvedAt: null,
    createdAt: "2026-09-22T09:00:00.000Z",
  };
}

function report(
  courses: CourseReportRow[] = [],
  tutors: TutorReportRow[] = [],
): WorkloadReport {
  return {
    period: {
      weekStart: WEEK_START.toISOString(),
      weekEnd: "2030-09-30T00:00:00.000Z",
      weeks: 4,
    },
    courses,
    tutors,
  };
}

/**
 * The summary counts these three queues and reads nothing else from them, so
 * the fixtures carry the shape each queue promises and the queues are asked for
 * by length.
 */
function approvalQueues(
  counts: { timesheets?: number; volunteerClaims?: number; excuses?: number } = {},
): OrganiserApprovalQueuesSummary {
  const ids = (count: number) =>
    Array.from({ length: count }, (_, index) => index + 1);

  return {
    timesheets: ids(counts.timesheets ?? 0).map((id) => ({
      id,
      tutorId: 7,
      tutorName: "Ada Tutor",
      tutorEmail: "ada@tutormx.example",
      weekStart: "2030-09-02",
      submittedAt: null,
      totalHours: 4,
      workLogs: [],
    })),
    volunteerClaims: ids(counts.volunteerClaims ?? 0).map((id) => ({
      id,
      overflowWorkId: 4,
      studentId: 9,
      studentName: "Sam Student",
      studentEmail: "sam@tutormx.example",
      courseCode: "COMS3011",
      courseName: "Software Design Project",
      startsAt: "2030-09-04T14:00:00.000Z",
      endsAt: "2030-09-04T18:00:00.000Z",
      hours: 4,
      createdAt: "2026-09-20T09:00:00.000Z",
    })),
    excuses: ids(counts.excuses ?? 0).map((id) => ({
      id,
      tutorId: 7,
      tutorName: "Ada Tutor",
      tutorEmail: "ada@tutormx.example",
      allocationId: 11,
      courseCode: "COMS3011",
      courseName: "Software Design Project",
      startsAt: "2030-09-04T14:00:00.000Z",
      endsAt: "2030-09-04T18:00:00.000Z",
      reason: "Illness",
      createdAt: "2026-09-20T09:00:00.000Z",
    })),
  };
}

function createReaders(
  overrides: Partial<CommandCentreReaders> = {},
): CommandCentreReaders {
  return {
    listOpenStaffingRequirements: vi.fn().mockResolvedValue([]),
    workloadReport: vi.fn().mockResolvedValue(report()),
    listApprovals: vi.fn().mockResolvedValue(approvalQueues()),
    listOverflowWork: vi.fn().mockResolvedValue([]),
    listOpenDisputes: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function summaryOf(
  readers: CommandCentreReaders,
  query = { weekStart: WEEK_START, weeks: 4 },
) {
  return createCommandCentreService(readers).summary(
    "auth0|organiser",
    query,
  );
}

describe("command centre service", () => {
  it("reads every panel for the period it was asked for", async () => {
    const readers = createReaders();

    const summary = await summaryOf(readers, {
      weekStart: WEEK_START,
      weeks: 4,
    });

    expect(readers.workloadReport).toHaveBeenCalledWith({
      weekStart: WEEK_START,
      weeks: 4,
    });
    // The dispute queue is the organiser's own, so it is read for them.
    expect(readers.listOpenDisputes).toHaveBeenCalledWith("auth0|organiser");
    expect(summary.period).toEqual({
      weekStart: "2030-09-02T00:00:00.000Z",
      // The Monday after the last week, as the reports read a period.
      weekEnd: "2030-09-30T00:00:00.000Z",
      weeks: 4,
    });
  });

  describe("staffing", () => {
    it("reports nothing to do as zeros rather than blanks", async () => {
      const summary = await summaryOf(createReaders());

      expect(summary.staffing).toMatchObject({
        requiredHours: 0,
        assignedHours: 0,
        unfilledHours: 0,
        openRequirements: 0,
        unfilledRequirements: 0,
        requirements: [],
      });
      // The period is still a calendar: a cell per day, none of them claiming
      // to be filled.
      expect(summary.staffing.days).toHaveLength(28);
      expect(summary.staffing.days.every((day) => day.fillState === null)).toBe(
        true,
      );
      expect(summary.staffing.days[0].date).toBe("2030-09-02");
      expect(summary.staffing.days[27].date).toBe("2030-09-29");
    });

    it("counts a partly filled requirement as unfilled work", async () => {
      const partlyFilled = requirement({
        assignedHours: 4,
        shortageHours: 4,
        shortageTutors: 1,
        fillState: "partially-filled",
      });
      const readers = createReaders({
        listOpenStaffingRequirements: vi
          .fn()
          .mockResolvedValue([partlyFilled]),
      });

      const summary = await summaryOf(readers);

      expect(summary.staffing.requiredHours).toBe(8);
      expect(summary.staffing.assignedHours).toBe(4);
      expect(summary.staffing.unfilledHours).toBe(4);
      expect(summary.staffing.openRequirements).toBe(1);
      expect(summary.staffing.unfilledRequirements).toBe(1);
      expect(summary.staffing.requirements).toEqual([partlyFilled]);
    });

    it("counts a filled requirement as no unfilled work", async () => {
      const readers = createReaders({
        listOpenStaffingRequirements: vi.fn().mockResolvedValue([
          requirement({
            assignedHours: 8,
            shortageHours: 0,
            shortageTutors: 0,
            fillState: "fully-filled",
          }),
        ]),
      });

      const summary = await summaryOf(readers);

      expect(summary.staffing.openRequirements).toBe(1);
      expect(summary.staffing.unfilledRequirements).toBe(0);
      expect(summary.staffing.unfilledHours).toBe(0);
      expect(summary.staffing.requiredHours).toBe(8);
      expect(summary.staffing.assignedHours).toBe(8);
    });

    it("keeps requirements that start in another period out of the totals", async () => {
      const readers = createReaders({
        listOpenStaffingRequirements: vi.fn().mockResolvedValue([
          requirement({ id: 1, startsAt: "2030-08-28T09:00:00.000Z" }),
          requirement({ id: 2, startsAt: "2030-09-02T09:00:00.000Z" }),
          requirement({ id: 3, startsAt: "2030-09-16T09:00:00.000Z" }),
          // The Monday after the last week: the next period's work.
          requirement({ id: 4, startsAt: "2030-09-30T09:00:00.000Z" }),
        ]),
      });

      const summary = await summaryOf(readers, {
        weekStart: WEEK_START,
        weeks: 4,
      });

      expect(summary.staffing.requirements.map((row) => row.id)).toEqual([2, 3]);
      expect(summary.staffing.openRequirements).toBe(2);
      expect(summary.staffing.requiredHours).toBe(16);
    });

    it("takes in later requirements when the period is longer", async () => {
      const readers = createReaders({
        listOpenStaffingRequirements: vi.fn().mockResolvedValue([
          requirement({ id: 2, startsAt: "2030-09-02T09:00:00.000Z" }),
          requirement({ id: 3, startsAt: "2030-09-16T09:00:00.000Z" }),
        ]),
      });

      const oneWeek = await summaryOf(readers, {
        weekStart: WEEK_START,
        weeks: 1,
      });
      const fourWeeks = await summaryOf(readers, {
        weekStart: WEEK_START,
        weeks: 4,
      });

      expect(oneWeek.staffing.requirements.map((row) => row.id)).toEqual([2]);
      expect(oneWeek.staffing.requiredHours).toBe(8);
      expect(fourWeeks.staffing.requirements.map((row) => row.id)).toEqual([
        2, 3,
      ]);
      expect(fourWeeks.staffing.requiredHours).toBe(16);
    });

    it("sums the requirements of each day for the heatmap", async () => {
      const readers = createReaders({
        listOpenStaffingRequirements: vi.fn().mockResolvedValue([
          // One day, two windows: one covered, one not.
          requirement({
            id: 1,
            startsAt: "2030-09-02T09:00:00.000Z",
            requiredHours: 4,
            assignedHours: 4,
            shortageHours: 0,
            shortageTutors: 0,
            fillState: "fully-filled",
          }),
          requirement({
            id: 2,
            startsAt: "2030-09-02T14:00:00.000Z",
            requiredHours: 8,
            assignedHours: 2,
            shortageHours: 6,
            shortageTutors: 1,
            fillState: "partially-filled",
          }),
        ]),
      });

      const summary = await summaryOf(readers, {
        weekStart: WEEK_START,
        weeks: 1,
      });

      expect(summary.staffing.days).toHaveLength(7);
      expect(summary.staffing.days[0]).toEqual({
        date: "2030-09-02",
        requiredHours: 12,
        assignedHours: 6,
        unfilledHours: 6,
        requirements: 2,
        fillState: "partially-filled",
      });
      // The rest of the week is on the calendar with nothing on it.
      expect(summary.staffing.days.slice(1)).toEqual(
        [
          "2030-09-03",
          "2030-09-04",
          "2030-09-05",
          "2030-09-06",
          "2030-09-07",
          "2030-09-08",
        ].map((date) => ({
          date,
          requiredHours: 0,
          assignedHours: 0,
          unfilledHours: 0,
          requirements: 0,
          fillState: null,
        })),
      );
    });

    it("describes a day of work nothing covers as unfilled", async () => {
      const readers = createReaders({
        listOpenStaffingRequirements: vi
          .fn()
          .mockResolvedValue([
            requirement({ startsAt: "2030-09-04T14:00:00.000Z" }),
          ]),
      });

      const summary = await summaryOf(readers, {
        weekStart: WEEK_START,
        weeks: 1,
      });

      expect(summary.staffing.days[2]).toEqual({
        date: "2030-09-04",
        requiredHours: 8,
        assignedHours: 0,
        unfilledHours: 8,
        requirements: 1,
        fillState: "unfilled",
      });
    });
  });

  describe("finance", () => {
    it("leaves money unset rather than reporting a zero nothing earned", async () => {
      const readers = createReaders({
        workloadReport: vi.fn().mockResolvedValue(report([course()])),
      });

      const summary = await summaryOf(readers);

      expect(summary.finance).toMatchObject({
        budget: null,
        spend: null,
        committed: null,
        remaining: null,
        overBudgetCourses: 0,
        unpricedCourses: 0,
      });
    });

    it("adds up the budget, spend and commitment the report priced", async () => {
      const readers = createReaders({
        workloadReport: vi.fn().mockResolvedValue(
          report([
            course({
              courseId: 3,
              hourlyRate: 100,
              budget: 1000,
              allocatedHours: 2,
              approvedWorkedHours: 4,
              spend: 400,
              committed: 200,
              budgetRemaining: 600,
            }),
            course({
              courseId: 4,
              courseCode: "MATH101",
              hourlyRate: 50,
              budget: 500,
              allocatedHours: 2,
              approvedWorkedHours: 14,
              spend: 700,
              committed: 100,
              budgetRemaining: -200,
            }),
          ]),
        ),
      });

      const summary = await summaryOf(readers);

      expect(summary.finance.budget).toBe(1500);
      expect(summary.finance.spend).toBe(1100);
      expect(summary.finance.committed).toBe(300);
      expect(summary.finance.remaining).toBe(400);
      expect(summary.finance.overBudgetCourses).toBe(1);
      expect(summary.finance.unpricedCourses).toBe(0);
    });

    it("withholds the remaining figure when a budgeted course has no rate", async () => {
      const readers = createReaders({
        workloadReport: vi.fn().mockResolvedValue(
          report([
            course({
              courseId: 3,
              hourlyRate: 100,
              budget: 1000,
              allocatedHours: 1,
              spend: 100,
              budgetRemaining: 900,
            }),
            // Work with no rate: its spend is unknown, so the budget it is
            // measured against cannot answer either.
            course({
              courseId: 4,
              courseCode: "MATH101",
              budget: 500,
              allocatedHours: 1,
            }),
          ]),
        ),
      });

      const summary = await summaryOf(readers);

      expect(summary.finance.budget).toBe(1500);
      expect(summary.finance.spend).toBe(100);
      expect(summary.finance.remaining).toBeNull();
      expect(summary.finance.unpricedCourses).toBe(1);
    });

    it("counts only courses with work as unpriced, not the whole catalogue", async () => {
      const readers = createReaders({
        workloadReport: vi.fn().mockResolvedValue(
          report([
            // Nothing allocated and nothing worked: no rate is not a gap here.
            course({ courseId: 9, courseCode: "IDLE101" }),
            course({
              courseId: 4,
              courseCode: "MATH101",
              allocatedHours: 3,
            }),
          ]),
        ),
      });

      const summary = await summaryOf(readers);

      expect(summary.finance.unpricedCourses).toBe(1);
    });
  });

  it("passes the report's tutors through untouched", async () => {
    const tutors = [
      tutor({ tutorId: 7, allocatedHours: 12, capacityHours: 40 }),
      tutor({ tutorId: 8, fullName: "Grace Tutor", allocatedHours: 0, shareOfAllocatedHours: 0 }),
    ];
    const readers = createReaders({
      workloadReport: vi.fn().mockResolvedValue(report([], tutors)),
    });

    const summary = await summaryOf(readers);

    expect(summary.workload.tutors).toEqual(tutors);
  });

  it("counts what is waiting on the organiser from the queues themselves", async () => {
    const readers = createReaders({
      listApprovals: vi
        .fn()
        .mockResolvedValue(
          approvalQueues({ timesheets: 2, volunteerClaims: 1 }),
        ),
      listOpenDisputes: vi.fn().mockResolvedValue([dispute(1), dispute(2)]),
    });

    const summary = await summaryOf(readers);

    expect(summary.actions).toEqual({
      pendingTimesheets: 2,
      pendingVolunteerClaims: 1,
      pendingExcuses: 0,
      openDisputes: 2,
      total: 5,
    });
  });

  it("counts open overflow work and what nobody has claimed", async () => {
    const readers = createReaders({
      listOverflowWork: vi.fn().mockResolvedValue([
        overflow({ id: 1, hours: 4, pendingClaims: 0 }),
        overflow({ id: 2, hours: 2, pendingClaims: 1 }),
        // Filled and cancelled work is not work still to place.
        overflow({ id: 3, hours: 8, status: "FILLED" }),
        overflow({ id: 4, hours: 8, status: "CANCELLED" }),
      ]),
    });

    const summary = await summaryOf(readers);

    expect(summary.overflow).toEqual({
      openItems: 2,
      openHours: 6,
      unclaimedItems: 1,
    });
  });
});

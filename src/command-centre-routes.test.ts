import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  createRouteError,
  type AllocationSummary,
  type AppDependencies,
  type CommandCentreSummary,
  type ProfileSummary,
  type TimesheetDecisionSummary,
  type TutorTimeSlotWriteInput,
  type VolunteerClaimDecisionSummary,
} from "./app.js";
import type { AuthContext, TutorRole } from "./auth/contract.js";

const summary: CommandCentreSummary = {
  period: {
    weekStart: "2030-09-02T00:00:00.000Z",
    weekEnd: "2030-09-30T00:00:00.000Z",
    weeks: 4,
  },
  staffing: {
    requiredHours: 8,
    assignedHours: 4,
    unfilledHours: 4,
    openRequirements: 1,
    unfilledRequirements: 1,
    requirements: [
      {
        id: 12,
        courseId: 3,
        courseCode: "COMS3011",
        courseName: "Software Design Project",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T18:00:00.000Z",
        tutorsNeeded: 2,
        windowHours: 4,
        requiredHours: 8,
        assignedHours: 4,
        shortageHours: 4,
        shortageTutors: 1,
        fillState: "partially-filled",
        status: "OPEN",
        statusReason: null,
        notes: null,
        createdById: 8,
        createdAt: "2026-09-21T09:00:00.000Z",
        updatedAt: "2026-09-21T09:00:00.000Z",
      },
    ],
    days: [
      {
        date: "2030-09-04",
        requiredHours: 8,
        assignedHours: 4,
        unfilledHours: 4,
        requirements: 1,
        fillState: "partially-filled",
      },
      {
        date: "2030-09-05",
        requiredHours: 0,
        assignedHours: 0,
        unfilledHours: 0,
        requirements: 0,
        fillState: null,
      },
    ],
  },
  finance: {
    budget: 1500,
    spend: 1100,
    committed: 300,
    remaining: 400,
    overBudgetCourses: 0,
    unpricedCourses: 0,
    courses: [],
  },
  workload: { tutors: [] },
  actions: {
    pendingTimesheets: 2,
    pendingVolunteerClaims: 1,
    pendingExcuses: 0,
    openDisputes: 0,
    total: 3,
  },
  overflow: { openItems: 1, openHours: 4, unclaimedItems: 1 },
};

const allocationSummary: AllocationSummary = {
  id: 11,
  tutorId: 7,
  courseId: 3,
  startsAt: "2030-09-04T14:00:00.000Z",
  endsAt: "2030-09-04T16:00:00.000Z",
  allocatedHours: 2,
  status: "CONFIRMED",
};

const timesheetSummary: TimesheetDecisionSummary = {
  id: 12,
  tutorId: 7,
  weekStart: "2030-09-02",
  status: "RETURNED",
  reviewedAt: "2030-09-06T12:00:00.000Z",
  reviewedById: 8,
  reviewReason: "Add the missing session note.",
};

const volunteerClaimSummary: VolunteerClaimDecisionSummary = {
  id: 13,
  overflowWorkId: 4,
  studentId: 9,
  status: "REJECTED",
  reviewReason: "Another volunteer was selected.",
};

function auth(role: TutorRole = "ORGANISER"): AuthContext {
  return {
    subject: role === "ORGANISER" ? "auth0|organiser" : "auth0|tutor",
    role,
    claims: { sub: role === "ORGANISER" ? "auth0|organiser" : "auth0|tutor" },
  };
}

function profile(role: TutorRole = "ORGANISER"): ProfileSummary {
  return {
    id: role === "ORGANISER" ? 8 : 7,
    email:
      role === "ORGANISER"
        ? "organiser@tutormx.example"
        : "tutor@tutormx.example",
    fullName: role === "ORGANISER" ? "Demo Organiser" : "Demo Tutor",
    role,
  };
}

function makeApp(
  overrides: Partial<AppDependencies> = {},
  role: TutorRole = "ORGANISER",
) {
  const dependencies: AppDependencies = {
    findProfileByAuth0Id: async () => profile(role),
    onboardUser: async (_auth0Id, selectedRole) => profile(selectedRole),
    getPublicHolidays: async () => ({
      source: "fallback",
      data: [],
      retrievedAt: null,
      reason: "unavailable",
    }),
    listCourses: async () => [],
    createCourse: async (input) => ({ id: 1, ...input, hourlyRate: input.hourlyRate ?? null, budget: input.budget ?? null }),
    updateCourse: async (id, input) => ({ id, ...input, hourlyRate: input.hourlyRate ?? null, budget: input.budget ?? null }),
    deleteCourse: async () => undefined,
    listTutors: async () => [],
    getTutorDashboard: async () => ({
      allocations: [],
      weeklyLimit: 10,
      usedHours: 0,
      remainingHours: 10,
    }),
    listOwnTutorTimeSlots: async () => [],
    updateTutorTimeSlot: async (_auth0Id: string, _timeSlotId: number, input: TutorTimeSlotWriteInput) => ({
      id: 1,
      type: input.type,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      recurrence: input.recurrence ?? null,
      label: input.label ?? null,
      recurrenceUntil: input.recurrenceUntil?.toISOString() ?? null,
    }),
    deleteTutorTimeSlot: async () => undefined,
    updateTutorWeeklyCapacity: async (_auth0Id: string, input: { weeklyHours: number | null }) => input,
    createTutorTimeSlot: async (_auth0Id: string, input: TutorTimeSlotWriteInput) => ({
      id: 1,
      type: input.type,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      recurrence: input.recurrence ?? null,
      label: input.label ?? null,
      recurrenceUntil: input.recurrenceUntil?.toISOString() ?? null,
    }),
    createTutorWorkLog: async (_auth0Id, input) => ({
      id: 1,
      timesheetId: 2,
      ...input,
    }),
    createTutorExcuse: async (_auth0Id, input) => ({
      id: 1,
      status: "PENDING",
      ...input,
    }),
    listStudentOpenWork: async () => [],
    listStudentVolunteerRequests: async () => [],
    createStudentVolunteerRequest: async (_auth0Id, input) => ({
      id: 1,
      overflowWorkId: input.overflowWorkId,
      status: "PENDING",
      reviewReason: null,
      createdAt: "2026-09-07T10:00:00.000Z",
      updatedAt: "2026-09-07T10:00:00.000Z",
    }),
    getStudentVolunteerRequest: async () => ({
      id: 1,
      overflowWorkId: 2,
      status: "PENDING",
      reviewReason: null,
      createdAt: "2026-09-07T10:00:00.000Z",
      updatedAt: "2026-09-07T10:00:00.000Z",
    }),
    withdrawStudentVolunteerRequest: async () => ({
      id: 1,
      overflowWorkId: 2,
      status: "WITHDRAWN",
      reviewReason: null,
      createdAt: "2026-09-07T10:00:00.000Z",
      updatedAt: "2026-09-07T10:01:00.000Z",
    }),
    getTutorTimesheetStatus: async () => ({
      id: 1,
      weekStart: "2026-09-07",
      status: "DRAFT",
      submittedAt: null,
      reviewedAt: null,
      reviewReason: null,
      totalHours: 1,
    }),
    submitTutorTimesheet: async () => ({
      id: 1,
      weekStart: "2026-09-07",
      status: "SUBMITTED",
      submittedAt: "2026-09-07T10:00:00.000Z",
      reviewedAt: null,
      reviewReason: null,
      totalHours: 1,
    }),
    getTutorExcuseStatus: async () => ({
      id: 1,
      allocationId: 2,
      reason: "Illness",
      status: "PENDING",
      reviewReason: null,
      createdAt: "2026-09-07T10:00:00.000Z",
      updatedAt: "2026-09-07T10:00:00.000Z",
    }),
    decideExcuse: async (id, input) => ({
      id,
      allocationId: 2,
      reason: "Illness",
      status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewReason: input.reason ?? null,
      createdAt: "2026-09-07T10:00:00.000Z",
      updatedAt: "2026-09-07T10:01:00.000Z",
    }),
    listAllocationCandidates: async () => [],
    listOrganiserAllocations: async () => [],
    listOrganiserApprovals: async () => ({ timesheets: [], volunteerClaims: [], excuses: [] }),
    createAllocation: async () => allocationSummary,
    updateAllocation: async () => allocationSummary,
    removeAllocation: async () => null,
    decideTimesheet: async () => timesheetSummary,
    decideVolunteerClaim: async () => volunteerClaimSummary,
    upsertTutorMark: async (_tutorId, input) => ({
      id: 1,
      courseId: input.courseId,
      courseCode: "DEMO101",
      courseName: "Demo Course",
      mark: input.mark,
      activeAllocationCount: 0,
    }),
    listTutorMarks: async () => [],
    deleteTutorMark: async () => undefined,
    listTutorTimeSlots: async () => [],
    requestPasswordReset: async () => undefined,
    verifyAccessToken: async () => auth(role),
    ...overrides,
  };

  return createApp(async () => undefined, dependencies);
}

function commandCentre(app: Express) {
  return request(app)
    .get("/api/organiser/command-centre")
    .query({ weekStart: "2030-09-02", weeks: "4" })
    .set("Authorization", "Bearer valid-token");
}

describe("command centre route", () => {
  it("answers with the summary for the period it was asked for", async () => {
    const commandCentreSummary = vi.fn().mockResolvedValue(summary);
    const app = makeApp({ commandCentreSummary });

    const response = await commandCentre(app);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: summary });
    expect(commandCentreSummary).toHaveBeenCalledWith("auth0|organiser", {
      weekStart: new Date("2030-09-02T00:00:00.000Z"),
      weeks: 4,
    });
  });

  it("asks for a single week when no length is given", async () => {
    const commandCentreSummary = vi.fn().mockResolvedValue(summary);
    const app = makeApp({ commandCentreSummary });

    await request(app)
      .get("/api/organiser/command-centre")
      .query({ weekStart: "2030-09-02" })
      .set("Authorization", "Bearer valid-token");

    expect(commandCentreSummary).toHaveBeenCalledWith(
      "auth0|organiser",
      expect.objectContaining({ weeks: 1 }),
    );
  });

  it.each([
    ["a day that is not a Monday", { weekStart: "2030-09-03" }],
    ["no week at all", {}],
    ["a malformed date", { weekStart: "not-a-date" }],
    ["zero weeks", { weekStart: "2030-09-02", weeks: "0" }],
    ["a fraction of a week", { weekStart: "2030-09-02", weeks: "1.5" }],
    ["more than a year", { weekStart: "2030-09-02", weeks: "53" }],
  ])("refuses %s", async (_label, query) => {
    const commandCentreSummary = vi.fn();
    const app = makeApp({ commandCentreSummary });

    const response = await request(app)
      .get("/api/organiser/command-centre")
      .query(query)
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(commandCentreSummary).not.toHaveBeenCalled();
  });

  it("requires an organiser", async () => {
    const unauthenticated = await request(makeApp()).get(
      "/api/organiser/command-centre",
    );
    expect(unauthenticated.status).toBe(401);

    const tutor = await request(makeApp({}, "TUTOR"))
      .get("/api/organiser/command-centre")
      .query({ weekStart: "2030-09-02" })
      .set("Authorization", "Bearer valid-token");
    expect(tutor.status).toBe(403);
  });

  it("reports the command centre as unavailable when it is not configured", async () => {
    const response = await commandCentre(makeApp());

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("COMMAND_CENTRE_UNAVAILABLE");
  });

  it("passes on the reason a panel could not be read", async () => {
    // The aggregate reads the reporting service, so its refusal is what the
    // organiser is shown rather than a generic failure.
    const app = makeApp({
      commandCentreSummary: async () => {
        throw createRouteError(
          503,
          "REPORTING_UNAVAILABLE",
          "Reporting is not configured.",
        );
      },
    });

    const response = await commandCentre(app);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("REPORTING_UNAVAILABLE");
  });

  it("does not leak an unexpected failure", async () => {
    const app = makeApp({
      commandCentreSummary: async () => {
        throw new Error("private connection detail");
      },
    });

    const response = await commandCentre(app);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.body.error.message).not.toContain("private connection detail");
  });
});

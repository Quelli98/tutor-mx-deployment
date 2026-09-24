import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  createRouteError,
  type AllocationSummary,
  type AppDependencies,
  type OrganiserOverflowWorkSummary,
  type ProfileSummary,
  type TimesheetDecisionSummary,
  type TutorTimeSlotWriteInput,
  type VolunteerClaimDecisionSummary,
} from "./app.js";
import type { AuthContext, TutorRole } from "./auth/contract.js";

const START = "2030-09-04T14:00:00.000Z";
const END = "2030-09-04T18:00:00.000Z";
const VERSION = "2026-09-23T09:00:00.000Z";

const overflowWorkSummary: OrganiserOverflowWorkSummary = {
  id: 4,
  courseId: 3,
  courseCode: "COMS3011",
  courseName: "Software Design Project",
  startsAt: START,
  endsAt: END,
  hours: 4,
  windowHours: 4,
  status: "OPEN",
  closesAt: null,
  sourceRequirementId: null,
  pendingClaims: 1,
  acceptedClaims: 0,
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: VERSION,
};

const allocationSummary: AllocationSummary = {
  id: 11,
  tutorId: 7,
  courseId: 3,
  startsAt: START,
  endsAt: END,
  allocatedHours: 4,
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

const validPost = {
  courseId: 3,
  startsAt: START,
  endsAt: END,
  hours: 4,
  closesAt: null,
};

const validEdit = {
  ...validPost,
  hours: 3,
  expectedUpdatedAt: VERSION,
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

function overflowRequests(app: Express, withToken = false) {
  const requests = [
    request(app).get("/api/organiser/overflow-work"),
    request(app).post("/api/organiser/overflow-work").send(validPost),
    request(app).patch("/api/organiser/overflow-work/4").send(validEdit),
    request(app)
      .patch("/api/organiser/overflow-work/4/close")
      .send({ expectedUpdatedAt: VERSION }),
  ];

  return withToken
    ? requests.map((pendingRequest) =>
        pendingRequest.set("Authorization", "Bearer valid-token"),
      )
    : requests;
}

describe("organiser overflow work routes", () => {
  describe("access control", () => {
    it("rejects every overflow route without a token", async () => {
      const app = makeApp();

      for (const pendingRequest of overflowRequests(app)) {
        const response = await pendingRequest;
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
      }
    });

    it("rejects an authenticated Tutor on every overflow route", async () => {
      const app = makeApp({}, "TUTOR");

      for (const pendingRequest of overflowRequests(app, true)) {
        const response = await pendingRequest;
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("FORBIDDEN");
      }
    });

    it("reports the feature as unavailable when it is not configured", async () => {
      const app = makeApp();

      for (const pendingRequest of overflowRequests(app, true)) {
        const response = await pendingRequest;
        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe("OVERFLOW_WORK_UNAVAILABLE");
      }
    });

    it("sanitizes an unexpected failure on every overflow route", async () => {
      const fail = vi.fn().mockRejectedValue(new Error("private connection detail"));
      const app = makeApp({
        listOrganiserOverflowWork: fail,
        createOrganiserOverflowWork: fail,
        updateOrganiserOverflowWork: fail,
        closeOrganiserOverflowWork: fail,
      });

      for (const pendingRequest of overflowRequests(app, true)) {
        const response = await pendingRequest;
        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe("INTERNAL_ERROR");
        expect(response.body.error.message).not.toContain("private connection detail");
      }
    });
  });

  describe("listing", () => {
    it("returns the organiser's overflow work in the shared envelope", async () => {
      const listOrganiserOverflowWork = vi
        .fn()
        .mockResolvedValue([overflowWorkSummary]);
      const app = makeApp({ listOrganiserOverflowWork });

      const response = await request(app)
        .get("/api/organiser/overflow-work")
        .set("Authorization", "Bearer valid-token");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: { overflowWork: [overflowWorkSummary] } });
      expect(listOrganiserOverflowWork).toHaveBeenCalledWith();
    });
  });

  describe("posting", () => {
    it("validates and delegates a post with no source requirement", async () => {
      const createOrganiserOverflowWork = vi
        .fn()
        .mockResolvedValue(overflowWorkSummary);
      const app = makeApp({ createOrganiserOverflowWork });

      const response = await request(app)
        .post("/api/organiser/overflow-work")
        .set("Authorization", "Bearer valid-token")
        .send(validPost);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ data: { overflowWork: overflowWorkSummary } });
      expect(createOrganiserOverflowWork).toHaveBeenCalledWith({
        courseId: 3,
        startsAt: new Date(START),
        endsAt: new Date(END),
        hours: 4,
        closesAt: null,
        sourceRequirementId: null,
      });
    });

    it("passes the source requirement of a conversion through to the service", async () => {
      const createOrganiserOverflowWork = vi
        .fn()
        .mockResolvedValue(overflowWorkSummary);
      const app = makeApp({ createOrganiserOverflowWork });

      const response = await request(app)
        .post("/api/organiser/overflow-work")
        .set("Authorization", "Bearer valid-token")
        .send({ ...validPost, sourceRequirementId: 12 });

      expect(response.status).toBe(201);
      expect(createOrganiserOverflowWork).toHaveBeenCalledWith(
        expect.objectContaining({ sourceRequirementId: 12 }),
      );
    });

    it("treats a blank deadline as no deadline", async () => {
      const createOrganiserOverflowWork = vi
        .fn()
        .mockResolvedValue(overflowWorkSummary);
      const app = makeApp({ createOrganiserOverflowWork });

      const response = await request(app)
        .post("/api/organiser/overflow-work")
        .set("Authorization", "Bearer valid-token")
        .send({ ...validPost, closesAt: "" });

      expect(response.status).toBe(201);
      expect(createOrganiserOverflowWork).toHaveBeenCalledWith(
        expect.objectContaining({ closesAt: null }),
      );
    });

    it.each([
      ["a course id sent as text", { courseId: "3" }],
      ["a fractional course id", { courseId: 3.5 }],
      ["a start time without a zone", { startsAt: "2030-09-04T14:00" }],
      ["an end before the start", { endsAt: "2030-09-04T13:00:00.000Z" }],
      ["a window longer than a session", { endsAt: "2030-09-05T18:00:00.000Z" }],
      ["zero hours", { hours: 0 }],
      ["hours longer than the window", { hours: 5 }],
      ["fractions of a minute", { hours: 1.234 }],
      ["a deadline after the start", { closesAt: "2030-09-04T15:00:00.000Z" }],
      ["a source requirement sent as text", { sourceRequirementId: "12" }],
      ["an unexpected field", { expectedUpdatedAt: VERSION }],
    ])("refuses a post with %s", async (_label, change) => {
      const createOrganiserOverflowWork = vi.fn();
      const app = makeApp({ createOrganiserOverflowWork });

      const response = await request(app)
        .post("/api/organiser/overflow-work")
        .set("Authorization", "Bearer valid-token")
        .send({ ...validPost, ...change });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(createOrganiserOverflowWork).not.toHaveBeenCalled();
    });

    it("says what the session limit was when the window is too long", async () => {
      const app = makeApp({ createOrganiserOverflowWork: vi.fn() });

      const response = await request(app)
        .post("/api/organiser/overflow-work")
        .set("Authorization", "Bearer valid-token")
        .send({ ...validPost, endsAt: "2030-09-05T18:00:00.000Z" });

      expect(response.body.error.message).toContain("cannot be longer than 8 hours");
    });
  });

  describe("editing", () => {
    it("validates and delegates the edit with the version the organiser was shown", async () => {
      const updateOrganiserOverflowWork = vi
        .fn()
        .mockResolvedValue(overflowWorkSummary);
      const app = makeApp({ updateOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/4")
        .set("Authorization", "Bearer valid-token")
        .send(validEdit);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: { overflowWork: overflowWorkSummary } });
      expect(updateOrganiserOverflowWork).toHaveBeenCalledWith(4, {
        courseId: 3,
        startsAt: new Date(START),
        endsAt: new Date(END),
        hours: 3,
        closesAt: null,
        expectedUpdatedAt: new Date(VERSION),
      });
    });

    it.each(["abc", "0", "1.5"])(
      "refuses the edit identifier %s",
      async (overflowWorkId) => {
        const updateOrganiserOverflowWork = vi.fn();
        const app = makeApp({ updateOrganiserOverflowWork });

        const response = await request(app)
          .patch(`/api/organiser/overflow-work/${overflowWorkId}`)
          .set("Authorization", "Bearer valid-token")
          .send(validEdit);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
        expect(response.body.error.message).toContain(
          "Overflow work identifier must be a positive whole number.",
        );
        expect(updateOrganiserOverflowWork).not.toHaveBeenCalled();
      },
    );

    it("refuses an edit without the version", async () => {
      const updateOrganiserOverflowWork = vi.fn();
      const app = makeApp({ updateOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/4")
        .set("Authorization", "Bearer valid-token")
        .send(validPost);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(updateOrganiserOverflowWork).not.toHaveBeenCalled();
    });

    it("refuses a client that tries to rewrite the source requirement", async () => {
      const updateOrganiserOverflowWork = vi.fn();
      const app = makeApp({ updateOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/4")
        .set("Authorization", "Bearer valid-token")
        .send({ ...validEdit, sourceRequirementId: 99 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(updateOrganiserOverflowWork).not.toHaveBeenCalled();
    });

    it("passes a stale-edit rejection through untouched", async () => {
      const updateOrganiserOverflowWork = vi.fn().mockRejectedValue(
        createRouteError(
          409,
          "OVERFLOW_WORK_STALE",
          "This overflow work changed in another session. Reload it and try again.",
        ),
      );
      const app = makeApp({ updateOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/4")
        .set("Authorization", "Bearer valid-token")
        .send(validEdit);

      expect(response.status).toBe(409);
      expect(response.body.error).toEqual({
        code: "OVERFLOW_WORK_STALE",
        message: "This overflow work changed in another session. Reload it and try again.",
      });
    });

    it("reports work that does not exist", async () => {
      const updateOrganiserOverflowWork = vi.fn().mockRejectedValue(
        createRouteError(
          404,
          "OVERFLOW_WORK_NOT_FOUND",
          "The requested overflow work could not be found.",
        ),
      );
      const app = makeApp({ updateOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/999")
        .set("Authorization", "Bearer valid-token")
        .send(validEdit);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("OVERFLOW_WORK_NOT_FOUND");
    });
  });

  describe("closing", () => {
    it("validates and delegates the close with the version the organiser was shown", async () => {
      const closeOrganiserOverflowWork = vi.fn().mockResolvedValue({
        ...overflowWorkSummary,
        status: "CLOSED",
      });
      const app = makeApp({ closeOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/4/close")
        .set("Authorization", "Bearer valid-token")
        .send({ expectedUpdatedAt: VERSION });

      expect(response.status).toBe(200);
      expect(response.body.data.overflowWork.status).toBe("CLOSED");
      expect(closeOrganiserOverflowWork).toHaveBeenCalledWith(4, {
        expectedUpdatedAt: new Date(VERSION),
      });
    });

    it("refuses a close without the version", async () => {
      const closeOrganiserOverflowWork = vi.fn();
      const app = makeApp({ closeOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/4/close")
        .set("Authorization", "Bearer valid-token")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(closeOrganiserOverflowWork).not.toHaveBeenCalled();
    });

    it("refuses a close that carries anything else", async () => {
      const closeOrganiserOverflowWork = vi.fn();
      const app = makeApp({ closeOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/4/close")
        .set("Authorization", "Bearer valid-token")
        .send({ expectedUpdatedAt: VERSION, status: "CLOSED" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(closeOrganiserOverflowWork).not.toHaveBeenCalled();
    });

    it("passes the pending-claims conflict through untouched", async () => {
      const closeOrganiserOverflowWork = vi.fn().mockRejectedValue(
        createRouteError(
          409,
          "OVERFLOW_WORK_HAS_CLAIMS",
          "Decide the pending student claims before closing this overflow work.",
        ),
      );
      const app = makeApp({ closeOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/4/close")
        .set("Authorization", "Bearer valid-token")
        .send({ expectedUpdatedAt: VERSION });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("OVERFLOW_WORK_HAS_CLAIMS");
      expect(closeOrganiserOverflowWork).toHaveBeenCalledTimes(1);
    });

    it("refuses the close identifier 0", async () => {
      const closeOrganiserOverflowWork = vi.fn();
      const app = makeApp({ closeOrganiserOverflowWork });

      const response = await request(app)
        .patch("/api/organiser/overflow-work/0/close")
        .set("Authorization", "Bearer valid-token")
        .send({ expectedUpdatedAt: VERSION });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain(
        "Overflow work identifier must be a positive whole number.",
      );
      expect(closeOrganiserOverflowWork).not.toHaveBeenCalled();
    });
  });
});

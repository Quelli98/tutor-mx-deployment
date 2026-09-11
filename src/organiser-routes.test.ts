import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  createRouteError,
  type AllocationSummary,
  type AppDependencies,
  type ProfileSummary,
  type TimesheetDecisionSummary,
  type VolunteerClaimDecisionSummary,
} from "./app.js";
import type { AuthContext, TutorRole } from "./auth/contract.js";

const validAllocation = {
  tutorId: 7,
  courseId: 3,
  startsAt: "2030-09-04T14:00:00.000Z",
  endsAt: "2030-09-04T16:00:00.000Z",
  minimumMark: 50,
  requestedHours: 2,
  status: "CONFIRMED",
};

const allocationSummary: AllocationSummary = {
  id: 11,
  tutorId: 7,
  courseId: 3,
  startsAt: validAllocation.startsAt,
  endsAt: validAllocation.endsAt,
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
    listCourses: async () => [],
    createCourse: async (input) => ({ id: 1, ...input }),
    updateCourse: async (id, input) => ({ id, ...input }),
    deleteCourse: async () => undefined,
    listTutors: async () => [],
    createTutor: async (input) => ({
      id: 7,
      role: "TUTOR",
      weeklyHours: input.weeklyHours ?? null,
      ...input,
    }),
    updateTutor: async (id, input) => ({
      id,
      auth0Id: "auth0|tutor",
      email: input.email ?? "tutor@tutormx.example",
      fullName: input.fullName ?? "Demo Tutor",
      role: "TUTOR",
      weeklyHours: input.weeklyHours ?? 10,
    }),
    getTutorDashboard: async () => ({
      allocations: [],
      weeklyLimit: 10,
      usedHours: 0,
      remainingHours: 10,
    }),
    createTutorTimeSlot: async (_auth0Id, input) => ({
      id: 1,
      type: input.type,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      recurrence: input.recurrence ?? null,
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
    createAllocation: async () => allocationSummary,
    updateAllocation: async () => allocationSummary,
    removeAllocation: async () => undefined,
    decideTimesheet: async () => timesheetSummary,
    decideVolunteerClaim: async () => volunteerClaimSummary,
    upsertTutorMark: async (_tutorId, input) => ({
      id: 1,
      courseId: input.courseId,
      courseCode: "DEMO101",
      courseName: "Demo Course",
      mark: input.mark,
    }),
    listTutorMarks: async () => [],
    listTutorTimeSlots: async () => [],
    createTutorTimeSlotForTutor: async (_tutorId, input) => ({
      id: 1,
      type: input.type,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      recurrence: input.recurrence ?? null,
    }),
    requestPasswordReset: async () => undefined,
    verifyAccessToken: async () => auth(role),
    ...overrides,
  };

  return createApp(async () => undefined, dependencies);
}

function organiserMutationRequests(app: Express, withToken = false) {
  const requests = [
    request(app).post("/api/allocations").send(validAllocation),
    request(app).patch("/api/allocations/11").send(validAllocation),
    request(app).delete("/api/allocations/11?minimumMark=50"),
    request(app)
      .patch("/api/timesheets/12/decision")
      .send({ decision: "APPROVE" }),
    request(app)
      .patch("/api/volunteer-claims/13/decision")
      .send({ decision: "APPROVE" }),
  ];

  return withToken
    ? requests.map((pendingRequest) =>
        pendingRequest.set("Authorization", "Bearer valid-token"),
      )
    : requests;
}

describe("organiser mutation authorization", () => {
  it.each([
    new Error("Prisma SQL private-token"),
    Object.assign(new Error("Auth0 secret database internals"), { status: 409, code: "PRIVATE_PROVIDER_ERROR" }),
    { code: "P2039", meta: { connection: "private connection string" } },
  ])("sanitizes unexpected failures on every organiser mutation %#", async (failure) => {
    const fail = vi.fn().mockRejectedValue(failure);
    const app = makeApp({
      createAllocation: fail, updateAllocation: fail, removeAllocation: fail,
      decideTimesheet: fail, decideVolunteerClaim: fail,
    });
    for (const pending of organiserMutationRequests(app, true)) {
      const response = await pending;
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: {
        code: "INTERNAL_ERROR", message: "The request could not be completed.",
      } });
    }
    expect(fail).toHaveBeenCalledTimes(5);
  });

  it("requires authentication on every allocation and decision mutation", async () => {
    const app = makeApp();

    for (const pendingRequest of organiserMutationRequests(app)) {
      const response = await pendingRequest;
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    }
  });

  it("rejects a matching authenticated Tutor profile on every organiser mutation", async () => {
    const app = makeApp({}, "TUTOR");

    for (const pendingRequest of organiserMutationRequests(app, true)) {
      const response = await pendingRequest;
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }
  });
});

describe("allocation mutation routes", () => {
  it("validates and delegates create, update and remove operations", async () => {
    const createAllocation = vi.fn().mockResolvedValue(allocationSummary);
    const updateAllocation = vi.fn().mockResolvedValue(allocationSummary);
    const removeAllocation = vi.fn().mockResolvedValue(undefined);
    const app = makeApp({
      createAllocation,
      updateAllocation,
      removeAllocation,
    });

    const created = await request(app)
      .post("/api/allocations")
      .set("Authorization", "Bearer valid-token")
      .send(validAllocation);

    expect(created.status).toBe(201);
    expect(created.body).toEqual({ data: { allocation: allocationSummary } });
    expect(createAllocation).toHaveBeenCalledWith({
      ...validAllocation,
      startsAt: new Date(validAllocation.startsAt),
      endsAt: new Date(validAllocation.endsAt),
    });

    const updated = await request(app)
      .patch("/api/allocations/11")
      .set("Authorization", "Bearer valid-token")
      .send(validAllocation);

    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ data: { allocation: allocationSummary } });
    expect(updateAllocation).toHaveBeenCalledWith(11, {
      ...validAllocation,
      startsAt: new Date(validAllocation.startsAt),
      endsAt: new Date(validAllocation.endsAt),
    });

    const removed = await request(app)
      .delete("/api/allocations/11?minimumMark=50")
      .set("Authorization", "Bearer valid-token");

    expect(removed.status).toBe(204);
    expect(removeAllocation).toHaveBeenCalledWith(11, { minimumMark: 50 });
  });

  it("rejects malformed allocation input before delegation", async () => {
    const createAllocation = vi.fn();
    const app = makeApp({ createAllocation });
    const invalidBodies = [
      { ...validAllocation, tutorId: 0 },
      { ...validAllocation, courseId: true },
      { ...validAllocation, startsAt: "2030-09-04T14:00:00" },
      { ...validAllocation, endsAt: validAllocation.startsAt },
      { ...validAllocation, minimumMark: 101 },
      { ...validAllocation, requestedHours: 0 },
      { ...validAllocation, status: "CANCELLED" },
    ];

    for (const body of invalidBodies) {
      const response = await request(app)
        .post("/api/allocations")
        .set("Authorization", "Bearer valid-token")
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(createAllocation).not.toHaveBeenCalled();
  });

  it("validates allocation path IDs and the remove-time minimum mark", async () => {
    const updateAllocation = vi.fn();
    const removeAllocation = vi.fn();
    const app = makeApp({ updateAllocation, removeAllocation });

    const invalidUpdateId = await request(app)
      .patch("/api/allocations/0")
      .set("Authorization", "Bearer valid-token")
      .send(validAllocation);
    const invalidRemoveId = await request(app)
      .delete("/api/allocations/not-a-number?minimumMark=50")
      .set("Authorization", "Bearer valid-token");
    const missingMinimumMark = await request(app)
      .delete("/api/allocations/11")
      .set("Authorization", "Bearer valid-token");

    expect(invalidUpdateId.status).toBe(400);
    expect(invalidRemoveId.status).toBe(400);
    expect(missingMinimumMark.status).toBe(400);
    expect(updateAllocation).not.toHaveBeenCalled();
    expect(removeAllocation).not.toHaveBeenCalled();
  });

  it("preserves safe missing-resource and conflict errors", async () => {
    const missing = await request(
      makeApp({
        createAllocation: async () => {
          throw createRouteError(
            404,
            "TUTOR_NOT_FOUND",
            "The requested tutor could not be found.",
          );
        },
      }),
    )
      .post("/api/allocations")
      .set("Authorization", "Bearer valid-token")
      .send(validAllocation);

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: {
        code: "TUTOR_NOT_FOUND",
        message: "The requested tutor could not be found.",
      },
    });

    const conflict = await request(
      makeApp({
        updateAllocation: async () => {
          throw createRouteError(
            409,
            "ALLOCATION_CONFLICT",
            "The allocation conflicts with current tutor rules.",
          );
        },
      }),
    )
      .patch("/api/allocations/11")
      .set("Authorization", "Bearer valid-token")
      .send(validAllocation);

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("ALLOCATION_CONFLICT");
  });
});

describe("organiser decision routes", () => {
  it("passes the verified subject and safe summary to a timesheet decision", async () => {
    const decideTimesheet = vi.fn().mockResolvedValue(timesheetSummary);
    const app = makeApp({ decideTimesheet });

    const response = await request(app)
      .patch("/api/timesheets/12/decision")
      .set("Authorization", "Bearer valid-token")
      .send({ decision: "RETURN", reason: " Add the missing session note. " });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { timesheet: timesheetSummary } });
    expect(decideTimesheet).toHaveBeenCalledWith("auth0|organiser", 12, {
      decision: "RETURN",
      reason: "Add the missing session note.",
    });
  });

  it("validates timesheet IDs, decisions and reasons", async () => {
    const decideTimesheet = vi.fn();
    const app = makeApp({ decideTimesheet });
    const cases = [
      { path: "/api/timesheets/0/decision", body: { decision: "APPROVE" } },
      { path: "/api/timesheets/12/decision", body: { decision: "REJECT" } },
      { path: "/api/timesheets/12/decision", body: { decision: "RETURN", reason: " " } },
      { path: "/api/timesheets/12/decision", body: { decision: "APPROVE", reason: "x".repeat(1001) } },
    ];

    for (const testCase of cases) {
      const response = await request(app)
        .patch(testCase.path)
        .set("Authorization", "Bearer valid-token")
        .send(testCase.body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(decideTimesheet).not.toHaveBeenCalled();
  });

  it("returns a safe stale timesheet decision conflict", async () => {
    const response = await request(
      makeApp({
        decideTimesheet: async () => {
          throw createRouteError(
            409,
            "TIMESHEET_STATE_CONFLICT",
            "The timesheet is no longer awaiting a decision.",
          );
        },
      }),
    )
      .patch("/api/timesheets/12/decision")
      .set("Authorization", "Bearer valid-token")
      .send({ decision: "APPROVE" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("TIMESHEET_STATE_CONFLICT");
  });

  it("validates and delegates a volunteer-claim decision", async () => {
    const decideVolunteerClaim = vi
      .fn()
      .mockResolvedValue(volunteerClaimSummary);
    const app = makeApp({ decideVolunteerClaim });

    const response = await request(app)
      .patch("/api/volunteer-claims/13/decision")
      .set("Authorization", "Bearer valid-token")
      .send({ decision: "REJECT", reason: " Another volunteer was selected. " });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: { volunteerClaim: volunteerClaimSummary },
    });
    expect(decideVolunteerClaim).toHaveBeenCalledWith(13, {
      decision: "REJECT",
      reason: "Another volunteer was selected.",
    });
  });

  it("validates volunteer-claim IDs, decisions and rejection reasons", async () => {
    const decideVolunteerClaim = vi.fn();
    const app = makeApp({ decideVolunteerClaim });
    const cases = [
      { path: "/api/volunteer-claims/no/decision", body: { decision: "APPROVE" } },
      { path: "/api/volunteer-claims/13/decision", body: { decision: "RETURN" } },
      { path: "/api/volunteer-claims/13/decision", body: { decision: "REJECT" } },
    ];

    for (const testCase of cases) {
      const response = await request(app)
        .patch(testCase.path)
        .set("Authorization", "Bearer valid-token")
        .send(testCase.body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(decideVolunteerClaim).not.toHaveBeenCalled();
  });

  it("preserves missing and duplicate volunteer-claim decision errors", async () => {
    const missing = await request(
      makeApp({
        decideVolunteerClaim: async () => {
          throw createRouteError(
            404,
            "VOLUNTEER_CLAIM_NOT_FOUND",
            "The volunteer claim could not be found.",
          );
        },
      }),
    )
      .patch("/api/volunteer-claims/13/decision")
      .set("Authorization", "Bearer valid-token")
      .send({ decision: "APPROVE" });

    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("VOLUNTEER_CLAIM_NOT_FOUND");

    const duplicate = await request(
      makeApp({
        decideVolunteerClaim: async () => {
          throw createRouteError(
            409,
            "VOLUNTEER_CLAIM_STATE_CONFLICT",
            "The volunteer claim has already been decided.",
          );
        },
      }),
    )
      .patch("/api/volunteer-claims/13/decision")
      .set("Authorization", "Bearer valid-token")
      .send({ decision: "APPROVE" });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({
      error: {
        code: "VOLUNTEER_CLAIM_STATE_CONFLICT",
        message: "The volunteer claim has already been decided.",
      },
    });
  });
});

import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  createRouteError,
  type AllocationSummary,
  type AppDependencies,
  type ProfileSummary,
  type StaffingRequirementSummary,
  type TimesheetDecisionSummary,
  type TutorTimeSlotWriteInput,
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
    getPublicHolidays: async () => ({
      source: "fallback",
      data: [],
      retrievedAt: null,
      reason: "unavailable",
    }),
    listCourses: async () => [],
    createCourse: async (input) => ({ id: 1, ...input }),
    updateCourse: async (id, input) => ({ id, ...input }),
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
    listOrganiserApprovals: async () => ({ timesheets: [], volunteerClaims: [] }),
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

describe("organiser live-board query routes", () => {
  it("lists active allocations and both pending approval queues for an organiser", async () => {
    const allocation = {
      ...allocationSummary,
      tutorName: "Demo Tutor",
      tutorEmail: "tutor@tutormx.example",
      courseCode: "DEMO101",
      courseName: "Demo Course",
    };
    const approvals = {
      timesheets: [
        {
          id: 12,
          tutorId: 7,
          tutorName: "Demo Tutor",
          tutorEmail: "tutor@tutormx.example",
          weekStart: "2030-09-02",
          submittedAt: "2030-09-06T12:00:00.000Z",
          totalHours: 2,
          workLogs: [
            {
              id: 21,
              allocationId: 11,
              courseCode: "DEMO101",
              courseName: "Demo Course",
              workDate: "2030-09-04",
              hours: 2,
              description: "Tutorial",
            },
          ],
        },
      ],
      volunteerClaims: [],
    };
    const listOrganiserAllocations = vi.fn().mockResolvedValue([allocation]);
    const listOrganiserApprovals = vi.fn().mockResolvedValue(approvals);
    const app = makeApp({ listOrganiserAllocations, listOrganiserApprovals });

    const allocationsResponse = await request(app)
      .get("/api/allocations")
      .set("Authorization", "Bearer valid-token");
    const approvalsResponse = await request(app)
      .get("/api/organiser/approvals")
      .set("Authorization", "Bearer valid-token");

    expect(allocationsResponse.status).toBe(200);
    expect(allocationsResponse.body).toEqual({ data: { allocations: [allocation] } });
    expect(approvalsResponse.status).toBe(200);
    expect(approvalsResponse.body).toEqual({ data: approvals });
  });

  it("keeps organiser allocation and approval data away from other roles", async () => {
    const app = makeApp({}, "TUTOR");
    const allocationsResponse = await request(app)
      .get("/api/allocations")
      .set("Authorization", "Bearer valid-token");
    const approvalsResponse = await request(app)
      .get("/api/organiser/approvals")
      .set("Authorization", "Bearer valid-token");

    expect(allocationsResponse.status).toBe(403);
    expect(approvalsResponse.status).toBe(403);
  });
});

describe("organiser tutor-detail reads", () => {
  it("loads marks and schedule independently using the selected Profile ID", async () => {
    const mark = { id: 41, courseId: 3, courseCode: "COMS3010A", courseName: "Computer Science", mark: 90, activeAllocationCount: 0 };
    const slot = { id: 12, type: "BUSY" as const, startsAt: "2026-09-17T06:00:00.000Z", endsAt: "2026-09-17T07:45:00.000Z", recurrence: "ONCE" as const, label: null, recurrenceUntil: null };
    const listTutorMarks = vi.fn(async (id: number) => id === 7 ? [mark] : []);
    const listTutorTimeSlots = vi.fn(async (id: number) => id === 7 ? [slot] : []);
    const app = makeApp({ listTutorMarks, listTutorTimeSlots });
    for (const id of [7, 9]) {
      const marks = await request(app).get(`/api/tutors/${id}/marks`).set("Authorization", "Bearer valid-token");
      const schedule = await request(app).get(`/api/tutors/${id}/time-slots`).set("Authorization", "Bearer valid-token");
      expect(marks.status).toBe(200);
      expect(marks.body).toEqual({ data: { marks: id === 7 ? [mark] : [] } });
      expect(schedule.status).toBe(200);
      expect(schedule.body).toEqual({ data: { timeSlots: id === 7 ? [slot] : [] } });
      expect(listTutorMarks).toHaveBeenCalledWith(id);
      expect(listTutorTimeSlots).toHaveBeenCalledWith(id);
    }
  });

  it.each(["marks", "time-slots"])("protects organiser %s reads and validates numeric IDs", async (resource) => {
    const listTutorMarks = vi.fn();
    const listTutorTimeSlots = vi.fn();
    const dependencies = { listTutorMarks, listTutorTimeSlots };
    expect((await request(makeApp(dependencies)).get(`/api/tutors/7/${resource}`)).status).toBe(401);
    for (const role of ["TUTOR", "STUDENT"] as const) {
      expect((await request(makeApp(dependencies, role)).get(`/api/tutors/7/${resource}`).set("Authorization", "Bearer valid-token")).status).toBe(403);
    }
    expect((await request(makeApp(dependencies)).get(`/api/tutors/0/${resource}`).set("Authorization", "Bearer valid-token")).status).toBe(400);
    expect(listTutorMarks).not.toHaveBeenCalled();
    expect(listTutorTimeSlots).not.toHaveBeenCalled();
  });
});

describe("organiser tutor-rule deletion routes", () => {
  it("removes a tutor mark by database identifiers", async () => {
    const deleteTutorMark = vi.fn().mockResolvedValue(undefined);
    const app = makeApp({ deleteTutorMark });

    const markResponse = await request(app)
      .delete("/api/tutors/7/marks/3")
      .set("Authorization", "Bearer valid-token");

    expect(markResponse.status).toBe(204);
    expect(deleteTutorMark).toHaveBeenCalledWith(7, 3);
  });

  it("rejects invalid tutor-rule identifiers before deletion", async () => {
    const deleteTutorMark = vi.fn();
    const app = makeApp({ deleteTutorMark });

    const markResponse = await request(app)
      .delete("/api/tutors/0/marks/3")
      .set("Authorization", "Bearer valid-token");

    expect(markResponse.status).toBe(400);
    expect(deleteTutorMark).not.toHaveBeenCalled();
  });
});

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
    expect(createAllocation).toHaveBeenCalledWith("auth0|organiser", {
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
    expect(updateAllocation).toHaveBeenCalledWith("auth0|organiser", 11, {
      ...validAllocation,
      startsAt: new Date(validAllocation.startsAt),
      endsAt: new Date(validAllocation.endsAt),
    });

    const removed = await request(app)
      .delete("/api/allocations/11")
      .set("Authorization", "Bearer valid-token");

    expect(removed.status).toBe(204);
    expect(removeAllocation).toHaveBeenCalledWith("auth0|organiser", 11);
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

  it("validates allocation path IDs and removes without requiring stale eligibility input", async () => {
    const updateAllocation = vi.fn();
    const removeAllocation = vi.fn();
    const app = makeApp({ updateAllocation, removeAllocation });

    const invalidUpdateId = await request(app)
      .patch("/api/allocations/0")
      .set("Authorization", "Bearer valid-token")
      .send(validAllocation);
    const invalidRemoveId = await request(app)
      .delete("/api/allocations/not-a-number")
      .set("Authorization", "Bearer valid-token");
    const validRemove = await request(app)
      .delete("/api/allocations/11")
      .set("Authorization", "Bearer valid-token");

    expect(invalidUpdateId.status).toBe(400);
    expect(invalidRemoveId.status).toBe(400);
    expect(validRemove.status).toBe(204);
    expect(updateAllocation).not.toHaveBeenCalled();
    expect(removeAllocation).toHaveBeenCalledWith("auth0|organiser", 11);
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

describe("organiser tutor weekly navigation", () => {
  const tutorSummary = {
    id: 7,
    email: "tutor@tutormx.example",
    fullName: "Demo Tutor",
    role: "TUTOR" as const,
    weeklyHours: 10,
    usedHours: 4,
    remainingHours: 6,
    workedHours: 3,
    weekStart: "2026-09-21",
    weekEnd: "2026-09-27",
    capacityStatus: "available" as const,
  };

  it("forwards a valid Monday weekStart to listTutors", async () => {
    const listTutors = vi.fn().mockResolvedValue([tutorSummary]);
    const app = makeApp({ listTutors });

    const response = await request(app)
      .get("/api/tutors")
      .query({ weekStart: "2026-09-21" })
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body.data.tutors).toEqual([tutorSummary]);
    expect(listTutors).toHaveBeenCalledTimes(1);
    const passedDate = listTutors.mock.calls[0][0] as Date;
    expect(passedDate.toISOString().slice(0, 10)).toBe("2026-09-21");
  });

  it("rejects a weekStart that is not a Monday", async () => {
    const listTutors = vi.fn();
    const app = makeApp({ listTutors });

    const response = await request(app)
      .get("/api/tutors")
      .query({ weekStart: "2026-09-22" })
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(listTutors).not.toHaveBeenCalled();
  });

  it("rejects a malformed weekStart", async () => {
    const listTutors = vi.fn();
    const app = makeApp({ listTutors });

    const response = await request(app)
      .get("/api/tutors")
      .query({ weekStart: "not-a-date" })
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(400);
    expect(listTutors).not.toHaveBeenCalled();
  });

  it("defaults to the current week when weekStart is omitted", async () => {
    const listTutors = vi.fn().mockResolvedValue([tutorSummary]);
    const app = makeApp({ listTutors });

    const response = await request(app)
      .get("/api/tutors")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(listTutors).toHaveBeenCalledWith(undefined);
  });
});

describe("staffing requirement routes", () => {
  const summary: StaffingRequirementSummary = {
    id: 12,
    courseId: 3,
    courseCode: "COMS3011",
    courseName: "Software Design Project",
    startsAt: "2030-09-04T14:00:00.000Z",
    endsAt: "2030-09-04T18:00:00.000Z",
    tutorsNeeded: 2,
    windowHours: 4,
    requiredHours: 8,
    assignedHours: 5,
    shortageHours: 3,
    shortageTutors: 1,
    fillState: "partially-filled",
    status: "OPEN",
    notes: "Two extra tutors for the lab",
    createdById: 8,
    createdAt: "2026-09-21T09:00:00.000Z",
    updatedAt: "2026-09-21T09:00:00.000Z",
  };

  const validBody = {
    courseId: 3,
    startsAt: "2030-09-04T14:00:00.000Z",
    endsAt: "2030-09-04T18:00:00.000Z",
    tutorsNeeded: 2,
    notes: "Two extra tutors for the lab",
  };

  function staffingRequests(app: Express, authenticated = false) {
    const withAuth = <T extends request.Test>(pending: T) =>
      authenticated
        ? pending.set("Authorization", "Bearer valid-token")
        : pending;
    return [
      withAuth(request(app).post("/api/staffing-requirements").send(validBody)),
      withAuth(
        request(app).patch("/api/staffing-requirements/12").send(validBody),
      ),
      withAuth(
        request(app)
          .patch("/api/staffing-requirements/12/status")
          .send({ status: "CLOSED" }),
      ),
      withAuth(request(app).get("/api/staffing-requirements")),
    ];
  }

  it("creates a requirement for the signed-in organiser", async () => {
    const createStaffingRequirement = vi.fn().mockResolvedValue(summary);
    const app = makeApp({ createStaffingRequirement });

    const response = await request(app)
      .post("/api/staffing-requirements")
      .set("Authorization", "Bearer valid-token")
      .send(validBody);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: { staffingRequirement: summary } });
    expect(createStaffingRequirement).toHaveBeenCalledWith("auth0|organiser", {
      courseId: 3,
      startsAt: new Date(validBody.startsAt),
      endsAt: new Date(validBody.endsAt),
      tutorsNeeded: 2,
      notes: "Two extra tutors for the lab",
    });
  });

  it("creates a requirement without notes", async () => {
    const createStaffingRequirement = vi.fn().mockResolvedValue(summary);
    const app = makeApp({ createStaffingRequirement });
    const withoutNotes = {
      courseId: validBody.courseId,
      startsAt: validBody.startsAt,
      endsAt: validBody.endsAt,
      tutorsNeeded: validBody.tutorsNeeded,
    };

    const response = await request(app)
      .post("/api/staffing-requirements")
      .set("Authorization", "Bearer valid-token")
      .send(withoutNotes);

    expect(response.status).toBe(201);
    expect(createStaffingRequirement.mock.calls[0]![1]).not.toHaveProperty(
      "notes",
    );
  });

  it.each([
    ["a missing course", { ...validBody, courseId: undefined }],
    ["a course that is not a positive whole number", { ...validBody, courseId: 0 }],
    ["an end before the start", { ...validBody, endsAt: "2030-09-04T13:00:00.000Z" }],
    ["an end equal to the start", { ...validBody, endsAt: validBody.startsAt }],
    ["zero tutors", { ...validBody, tutorsNeeded: 0 }],
    ["negative tutors", { ...validBody, tutorsNeeded: -2 }],
    ["more tutors than the maximum", { ...validBody, tutorsNeeded: 21 }],
    ["a fraction of a tutor", { ...validBody, tutorsNeeded: 1.5 }],
    ["tutors sent as text", { ...validBody, tutorsNeeded: "2" }],
    ["client-supplied required hours", { ...validBody, requiredHours: 8 }],
    ["a start without a time zone", { ...validBody, startsAt: "2030-09-04T14:00:00" }],
    ["a blank note", { ...validBody, notes: "   " }],
    ["a client-supplied status", { ...validBody, status: "CLOSED" }],
    ["a client-supplied author", { ...validBody, createdById: 99 }],
  ])("rejects %s and sends no request", async (_label, body) => {
    const createStaffingRequirement = vi.fn();
    const app = makeApp({ createStaffingRequirement });

    const response = await request(app)
      .post("/api/staffing-requirements")
      .set("Authorization", "Bearer valid-token")
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(createStaffingRequirement).not.toHaveBeenCalled();
  });

  it.each([
    ["no filters", {}, {}],
    ["a course filter", { courseId: "3" }, { courseId: 3 }],
    ["a status filter", { status: "OPEN" }, { status: "OPEN" }],
    ["a lower-case status filter", { status: "closed" }, { status: "CLOSED" }],
    [
      "both filters",
      { courseId: "3", status: "CANCELLED" },
      { courseId: 3, status: "CANCELLED" },
    ],
  ])("lists requirements with %s", async (_label, query, expected) => {
    const listStaffingRequirements = vi.fn().mockResolvedValue([summary]);
    const app = makeApp({ listStaffingRequirements });

    const response = await request(app)
      .get("/api/staffing-requirements")
      .query(query)
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { staffingRequirements: [summary] } });
    expect(listStaffingRequirements).toHaveBeenCalledWith(expected);
  });

  it.each([
    ["an unknown status", { status: "FILLED" }],
    ["a non-numeric course", { courseId: "abc" }],
    ["a zero course", { courseId: "0" }],
  ])("rejects %s in the list filters", async (_label, query) => {
    const listStaffingRequirements = vi.fn();
    const app = makeApp({ listStaffingRequirements });

    const response = await request(app)
      .get("/api/staffing-requirements")
      .query(query)
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(listStaffingRequirements).not.toHaveBeenCalled();
  });

  it("updates the details of a requirement", async () => {
    const updateStaffingRequirement = vi.fn().mockResolvedValue(summary);
    const app = makeApp({ updateStaffingRequirement });

    const response = await request(app)
      .patch("/api/staffing-requirements/12")
      .set("Authorization", "Bearer valid-token")
      .send({ ...validBody, notes: null });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { staffingRequirement: summary } });
    expect(updateStaffingRequirement).toHaveBeenCalledWith(12, {
      courseId: 3,
      startsAt: new Date(validBody.startsAt),
      endsAt: new Date(validBody.endsAt),
      tutorsNeeded: 2,
      notes: null,
    });
  });

  it.each(["OPEN", "CLOSED", "CANCELLED"])(
    "changes a requirement to %s",
    async (status) => {
      const setStaffingRequirementStatus = vi
        .fn()
        .mockResolvedValue({ ...summary, status });
      const app = makeApp({ setStaffingRequirementStatus });

      const response = await request(app)
        .patch("/api/staffing-requirements/12/status")
        .set("Authorization", "Bearer valid-token")
        .send({ status });

      expect(response.status).toBe(200);
      expect(response.body.data.staffingRequirement.status).toBe(status);
      expect(setStaffingRequirementStatus).toHaveBeenCalledWith(12, status);
    },
  );

  it.each([
    ["an unknown status", { status: "FILLED" }],
    ["a missing status", {}],
    ["extra fields", { status: "CLOSED", notes: "why" }],
  ])("rejects %s on the status route", async (_label, body) => {
    const setStaffingRequirementStatus = vi.fn();
    const app = makeApp({ setStaffingRequirementStatus });

    const response = await request(app)
      .patch("/api/staffing-requirements/12/status")
      .set("Authorization", "Bearer valid-token")
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(setStaffingRequirementStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/staffing-requirements/abc", validBody],
    ["/api/staffing-requirements/0", validBody],
  ])("rejects a malformed identifier on %s", async (path, body) => {
    const updateStaffingRequirement = vi.fn();
    const app = makeApp({ updateStaffingRequirement });

    const response = await request(app)
      .patch(path)
      .set("Authorization", "Bearer valid-token")
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(updateStaffingRequirement).not.toHaveBeenCalled();
  });

  it("passes service refusals through with their public code", async () => {
    const app = makeApp({
      setStaffingRequirementStatus: vi
        .fn()
        .mockRejectedValue(
          createRouteError(
            409,
            "STAFFING_REQUIREMENT_CONFLICT",
            "This staffing requirement is already closed.",
          ),
        ),
    });

    const response = await request(app)
      .patch("/api/staffing-requirements/12/status")
      .set("Authorization", "Bearer valid-token")
      .send({ status: "CLOSED" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STAFFING_REQUIREMENT_CONFLICT");
  });

  it("sanitizes unexpected failures on every staffing requirement route", async () => {
    const fail = vi.fn().mockRejectedValue(new Error("Prisma private detail"));
    const app = makeApp({
      listStaffingRequirements: fail,
      createStaffingRequirement: fail,
      updateStaffingRequirement: fail,
      setStaffingRequirementStatus: fail,
    });

    for (const pending of staffingRequests(app, true)) {
      const response = await pending;
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed.",
        },
      });
      expect(response.text).not.toContain("Prisma private detail");
    }
    expect(fail).toHaveBeenCalledTimes(4);
  });

  it("requires authentication on every staffing requirement route", async () => {
    const app = makeApp();

    for (const pending of staffingRequests(app)) {
      const response = await pending;
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    }
  });

  it("rejects an authenticated tutor on every staffing requirement route", async () => {
    const app = makeApp({}, "TUTOR");

    for (const pending of staffingRequests(app, true)) {
      const response = await pending;
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("reports the feature as unavailable when it is not configured", async () => {
    const app = makeApp();

    for (const pending of staffingRequests(app, true)) {
      const response = await pending;
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("STAFFING_REQUIREMENTS_UNAVAILABLE");
    }
  });
});

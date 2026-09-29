import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  createRouteError,
  type AppDependencies,
} from "./app.js";
import type { AuthContext, TutorRole } from "./auth/contract.js";
import { createTimesheetWorkflowService, type TimesheetWorkflowPrismaClient } from "./services/timesheet-workflows.js";

const studentSubject = "auth0|member5-student";
const tutorSubject = "auth0|member5-tutor";

function auth(subject: string, role: TutorRole): AuthContext {
  return { subject, role, claims: { sub: subject } };
}

function dependenciesFor(
  role: TutorRole,
  subject: string,
  overrides: Partial<AppDependencies> = {},
): AppDependencies {
  const dependencies: AppDependencies = {
    findProfileByAuth0Id: async () => ({
      id: role === "STUDENT" ? 9 : 7,
      email: `${role.toLowerCase()}@tutormx.example`,
      fullName: `Member 5 ${role}`,
      role,
    }),
    onboardUser: async (_auth0Id, requestedRole) => ({
      id: 7,
      email: "member5@tutormx.example",
      fullName: "Member 5",
      role: requestedRole,
    }),
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
    createTutorTimeSlot: async (_auth0Id, input) => ({
      id: 1,
      type: input.type,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      recurrence: input.recurrence ?? null,
      label: input.label ?? null,
      recurrenceUntil: input.recurrenceUntil?.toISOString() ?? null,
    }),
    listOwnTutorTimeSlots: async () => [],
    updateTutorTimeSlot: async (_auth0Id, _id, input) => ({
      id: 1,
      type: input.type,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      recurrence: input.recurrence ?? null,
      label: input.label ?? null,
      recurrenceUntil: input.recurrenceUntil?.toISOString() ?? null,
    }),
    updateTutorWeeklyCapacity: async (_auth0Id, input) => input,
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
      id: 20,
      overflowWorkId: input.overflowWorkId,
      status: "PENDING",
      reviewReason: null,
      createdAt: "2030-09-01T08:00:00.000Z",
      updatedAt: "2030-09-01T08:00:00.000Z",
    }),
    getStudentVolunteerRequest: async (_auth0Id, requestId) => ({
      id: requestId,
      overflowWorkId: 3,
      status: "PENDING",
      reviewReason: null,
      createdAt: "2030-09-01T08:00:00.000Z",
      updatedAt: "2030-09-01T08:00:00.000Z",
    }),
    withdrawStudentVolunteerRequest: async (_auth0Id, requestId) => ({
      id: requestId,
      overflowWorkId: 3,
      status: "WITHDRAWN",
      reviewReason: null,
      createdAt: "2030-09-01T08:00:00.000Z",
      updatedAt: "2030-09-02T08:00:00.000Z",
    }),
    getTutorTimesheetStatus: async (_auth0Id, timesheetId) => ({
      id: timesheetId,
      weekStart: "2030-09-02",
      status: "DRAFT",
      submittedAt: null,
      reviewedAt: null,
      reviewReason: null,
      totalHours: 2,
    }),
    submitTutorTimesheet: async (_auth0Id, timesheetId) => ({
      id: timesheetId,
      weekStart: "2030-09-02",
      status: "SUBMITTED",
      submittedAt: "2030-09-06T12:00:00.000Z",
      reviewedAt: null,
      reviewReason: null,
      totalHours: 2,
    }),
    getTutorExcuseStatus: async (_auth0Id, excuseId) => ({
      id: excuseId,
      allocationId: 4,
      reason: "Medical appointment",
      status: "PENDING",
      reviewReason: null,
      createdAt: "2030-09-01T08:00:00.000Z",
      updatedAt: "2030-09-01T08:00:00.000Z",
    }),
    decideExcuse: async (excuseId, input) => ({
      id: excuseId,
      allocationId: 4,
      reason: "Medical appointment",
      status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewReason: input.reason ?? null,
      createdAt: "2030-09-01T08:00:00.000Z",
      updatedAt: "2030-09-02T08:00:00.000Z",
    }),
    listAllocationCandidates: async () => [],
    listOrganiserAllocations: async () => [],
    listOrganiserApprovals: async () => ({ timesheets: [], volunteerClaims: [], excuses: [] }),
    createAllocation: async (_auth0Id, input) => ({
      id: 1,
      tutorId: input.tutorId,
      courseId: input.courseId,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      allocatedHours: input.requestedHours,
      status: input.status ?? "PROPOSED",
    }),
    updateAllocation: async (_auth0Id, id, input) => ({
      id,
      tutorId: input.tutorId,
      courseId: input.courseId,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      allocatedHours: input.requestedHours,
      status: input.status ?? "PROPOSED",
    }),
    removeAllocation: async () => null,
    decideTimesheet: async (_auth0Id, id, input) => ({
      id,
      tutorId: 7,
      weekStart: "2030-09-02",
      status: input.decision === "APPROVE" ? "APPROVED" : "RETURNED",
      reviewedAt: "2030-09-06T12:00:00.000Z",
      reviewedById: 8,
      reviewReason: input.reason ?? null,
    }),
    decideVolunteerClaim: async (id, input) => ({
      id,
      overflowWorkId: 4,
      studentId: 9,
      status: input.decision === "APPROVE" ? "ACCEPTED" : "REJECTED",
      reviewReason: input.reason ?? null,
    }),
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
    deleteTutorTimeSlot: async () => undefined,
    requestPasswordReset: async () => undefined,
    verifyAccessToken: async () => auth(subject, role),
  };

  return Object.assign(dependencies, overrides);
}

function makeApp(
  role: TutorRole,
  subject: string,
  overrides: Partial<AppDependencies> = {},
) {
  return createApp(
    async () => undefined,
    dependenciesFor(role, subject, overrides),
  );
}

type RequestMethod = "GET" | "POST" | "PATCH";

function apiRequest(
  app: ReturnType<typeof makeApp>,
  method: RequestMethod,
  path: string,
  body?: string | object,
  withToken = true,
) {
  let pending =
    method === "GET"
      ? request(app).get(path)
      : method === "POST"
        ? request(app).post(path)
        : request(app).patch(path);
  if (withToken) {
    pending = pending.set("Authorization", "Bearer valid-token");
  }
  return body === undefined ? pending : pending.send(body);
}

const openWork = {
  id: 3,
  courseCode: "DEMO101",
  courseName: "Demo Course",
  startsAt: "2030-09-04T14:00:00.000Z",
  endsAt: "2030-09-04T16:00:00.000Z",
  hours: 2,
  status: "OPEN" as const,
  closesAt: null,
};

const volunteerRequest = {
  id: 20,
  overflowWorkId: 3,
  status: "PENDING" as const,
  reviewReason: null,
  createdAt: "2030-09-01T08:00:00.000Z",
  updatedAt: "2030-09-01T08:00:00.000Z",
};

const volunteerRequestDetails = {
  ...volunteerRequest,
  courseCode: "DEMO101",
  courseName: "Demo Course",
  startsAt: openWork.startsAt,
  endsAt: openWork.endsAt,
  hours: openWork.hours,
};

describe("Sprint 2 Member 5 workflow routes", () => {
  it.each([
    { row: null, status: 404, code: "TIMESHEET_NOT_FOUND", message: "The requested timesheet could not be found." },
    { row: { workLogs: [{ hours: "invalid" }] }, status: 409, code: "TIMESHEET_HOURS_INVALID", message: "The timesheet hours or weekly limit are invalid." },
  ])("preserves real timesheet service $status errors at the HTTP boundary", async ({ row, status, code, message }) => {
    const service = createTimesheetWorkflowService({
      profile: { findUnique: vi.fn().mockResolvedValue({ id: 7, role: "TUTOR", hourLimit: null }) },
      timesheet: { findFirst: vi.fn().mockResolvedValue(row) },
    } as unknown as TimesheetWorkflowPrismaClient);
    const response = await apiRequest(makeApp("TUTOR", tutorSubject, {
      getTutorTimesheetStatus: service.getStatus,
    }), "GET", "/api/tutor/timesheets/99/status");
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: { code, message } });
  });

  it("serves Student open work and own volunteer actions using the token subject", async () => {
    const listStudentOpenWork = vi.fn().mockResolvedValue([openWork]);
    const listStudentVolunteerRequests = vi
      .fn()
      .mockResolvedValue([volunteerRequestDetails]);
    const createStudentVolunteerRequest = vi
      .fn()
      .mockResolvedValue(volunteerRequest);
    const getStudentVolunteerRequest = vi
      .fn()
      .mockResolvedValue(volunteerRequest);
    const withdrawn = { ...volunteerRequest, status: "WITHDRAWN" as const };
    const withdrawStudentVolunteerRequest = vi
      .fn()
      .mockResolvedValue(withdrawn);
    const app = makeApp("STUDENT", studentSubject, {
      listStudentOpenWork,
      listStudentVolunteerRequests,
      createStudentVolunteerRequest,
      getStudentVolunteerRequest,
      withdrawStudentVolunteerRequest,
    });

    const listed = await apiRequest(app, "GET", "/api/student/open-work");
    const requests = await apiRequest(
      app,
      "GET",
      "/api/student/volunteer-requests?studentId=999",
    );
    const created = await apiRequest(
      app,
      "POST",
      "/api/student/volunteer-requests",
      { overflowWorkId: 3, studentId: 999 },
    );
    const fetched = await apiRequest(
      app,
      "GET",
      "/api/student/volunteer-requests/20",
    );
    const removed = await apiRequest(
      app,
      "PATCH",
      "/api/student/volunteer-requests/20/withdraw",
    );

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ data: { workItems: [openWork] } });
    expect(requests.status).toBe(200);
    expect(requests.body).toEqual({
      data: { volunteerRequests: [volunteerRequestDetails] },
    });
    expect(created.status).toBe(201);
    expect(fetched.status).toBe(200);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ data: { volunteerRequest: withdrawn } });
    expect(listStudentOpenWork).toHaveBeenCalledWith(studentSubject);
    expect(listStudentVolunteerRequests).toHaveBeenCalledWith(studentSubject);
    expect(createStudentVolunteerRequest).toHaveBeenCalledWith(studentSubject, {
      overflowWorkId: 3,
    });
    expect(getStudentVolunteerRequest).toHaveBeenCalledWith(studentSubject, 20);
    expect(withdrawStudentVolunteerRequest).toHaveBeenCalledWith(
      studentSubject,
      20,
    );
  });

  it("gets and submits the Tutor's timesheet using the token subject", async () => {
    const draft = {
      id: 5,
      weekStart: "2030-09-02",
      status: "DRAFT" as const,
      submittedAt: null,
      reviewedAt: null,
      reviewReason: null,
      totalHours: 3.5,
    };
    const submitted = {
      ...draft,
      status: "SUBMITTED" as const,
      submittedAt: "2030-09-06T12:00:00.000Z",
    };
    const getTutorTimesheetStatus = vi.fn().mockResolvedValue(draft);
    const submitTutorTimesheet = vi.fn().mockResolvedValue(submitted);
    const app = makeApp("TUTOR", tutorSubject, {
      getTutorTimesheetStatus,
      submitTutorTimesheet,
    });

    const status = await apiRequest(
      app,
      "GET",
      "/api/tutor/timesheets/5/status",
    );
    const submit = await apiRequest(
      app,
      "POST",
      "/api/tutor/timesheets/5/submit",
    );

    expect(status.status).toBe(200);
    expect(status.body).toEqual({ data: { timesheet: draft } });
    expect(submit.status).toBe(200);
    expect(submit.body).toEqual({ data: { timesheet: submitted } });
    expect(getTutorTimesheetStatus).toHaveBeenCalledWith(tutorSubject, 5);
    expect(submitTutorTimesheet).toHaveBeenCalledWith(tutorSubject, 5);
  });

  it("gets the Tutor's excuse status using the token subject", async () => {
    const summary = {
      id: 12,
      allocationId: 4,
      reason: "Medical appointment",
      status: "PENDING" as const,
      reviewReason: null,
      createdAt: "2030-09-01T08:00:00.000Z",
      updatedAt: "2030-09-01T08:00:00.000Z",
    };
    const getTutorExcuseStatus = vi.fn().mockResolvedValue(summary);
    const app = makeApp("TUTOR", tutorSubject, { getTutorExcuseStatus });

    const response = await apiRequest(
      app,
      "GET",
      "/api/tutor/excuses/12/status",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { excuse: summary } });
    expect(getTutorExcuseStatus).toHaveBeenCalledWith(tutorSubject, 12);
  });

  it("allows an Organiser to approve or reject an excuse", async () => {
    const decideExcuse = vi.fn().mockImplementation((id, input) => ({
      id,
      allocationId: 4,
      reason: "Medical appointment",
      status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewReason: input.reason ?? null,
      createdAt: "2030-09-01T08:00:00.000Z",
      updatedAt: "2030-09-02T08:00:00.000Z",
    }));
    const app = makeApp("ORGANISER", "auth0|member5-organiser", {
      decideExcuse,
    });

    const approved = await apiRequest(
      app,
      "PATCH",
      "/api/excuses/12/decision",
      { decision: " approve " },
    );
    const rejected = await apiRequest(
      app,
      "PATCH",
      "/api/excuses/13/decision",
      { decision: "reject", reason: "  Not supported  " },
    );

    expect(approved.status).toBe(200);
    expect(approved.body.data.excuse.status).toBe("APPROVED");
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.excuse.status).toBe("REJECTED");
    expect(decideExcuse).toHaveBeenNthCalledWith(1, 12, {
      decision: "APPROVE",
    }, "auth0|member5-organiser");
    expect(decideExcuse).toHaveBeenNthCalledWith(2, 13, {
      decision: "REJECT",
      reason: "Not supported",
    }, "auth0|member5-organiser");
  });

  const securedRoutes: Array<{
    method: RequestMethod;
    path: string;
    body?: string | object;
    allowedRole: TutorRole;
    wrongRole: TutorRole;
  }> = [
    {
      method: "GET",
      path: "/api/student/open-work",
      allowedRole: "STUDENT",
      wrongRole: "TUTOR",
    },
    {
      method: "GET",
      path: "/api/student/volunteer-requests",
      allowedRole: "STUDENT",
      wrongRole: "TUTOR",
    },
    {
      method: "POST",
      path: "/api/student/volunteer-requests",
      body: { overflowWorkId: 3 },
      allowedRole: "STUDENT",
      wrongRole: "TUTOR",
    },
    {
      method: "GET",
      path: "/api/student/volunteer-requests/20",
      allowedRole: "STUDENT",
      wrongRole: "TUTOR",
    },
    {
      method: "PATCH",
      path: "/api/student/volunteer-requests/20/withdraw",
      allowedRole: "STUDENT",
      wrongRole: "TUTOR",
    },
    {
      method: "GET",
      path: "/api/tutor/timesheets/5/status",
      allowedRole: "TUTOR",
      wrongRole: "STUDENT",
    },
    {
      method: "POST",
      path: "/api/tutor/timesheets/5/submit",
      allowedRole: "TUTOR",
      wrongRole: "STUDENT",
    },
    {
      method: "GET",
      path: "/api/tutor/excuses/12/status",
      allowedRole: "TUTOR",
      wrongRole: "STUDENT",
    },
    {
      method: "PATCH",
      path: "/api/excuses/12/decision",
      body: { decision: "APPROVE" },
      allowedRole: "ORGANISER",
      wrongRole: "TUTOR",
    },
  ];

  it.each(securedRoutes)(
    "hides rejected token details for $method $path",
    async ({ method, path, body, allowedRole }) => {
      const response = await apiRequest(makeApp(allowedRole, "auth0|member5", {
        verifyAccessToken: vi.fn().mockRejectedValue(new Error("Auth0 secret private-token")),
      }), method, path, body);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: {
        code: "INVALID_ACCESS_TOKEN", message: "A valid bearer token is required.",
      } });
    },
  );

  it.each(securedRoutes)(
    "sanitizes dependency failures for $method $path",
    async ({ method, path, body, allowedRole }) => {
      for (const failure of [
        new Error("Prisma SQL private-token"),
        Object.assign(new Error("Auth0 secret database internals"), { status: 409, code: "PRIVATE_PROVIDER_ERROR" }),
        { status: 400, code: "P2039", message: "private database detail" },
      ]) {
        const fail = vi.fn().mockRejectedValue(failure);
        const response = await apiRequest(makeApp(allowedRole, "auth0|member5", {
          listStudentOpenWork: fail, listStudentVolunteerRequests: fail,
          createStudentVolunteerRequest: fail,
          getStudentVolunteerRequest: fail, withdrawStudentVolunteerRequest: fail,
          getTutorTimesheetStatus: fail, submitTutorTimesheet: fail,
          getTutorExcuseStatus: fail, decideExcuse: fail,
        }), method, path, body);
        expect(fail).toHaveBeenCalledOnce();
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: {
          code: "INTERNAL_ERROR", message: "The request could not be completed.",
        } });
      }
    },
  );

  it.each(securedRoutes.filter(({ body }) => body !== undefined))(
    "rejects invalid JSON before workflow execution for $method $path",
    async ({ method, path, allowedRole }) => {
      const fail = vi.fn();
      const response = await apiRequest(makeApp(allowedRole, "auth0|member5", {
        createStudentVolunteerRequest: fail, decideExcuse: fail,
      }), method, path).set("Content-Type", "application/json").send('{"private-token":');
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: {
        code: "INVALID_JSON", message: "The request body must contain valid JSON.",
      } });
      expect(fail).not.toHaveBeenCalled();
    },
  );

  it.each(securedRoutes)(
    "requires authentication for $method $path",
    async ({ method, path, body, allowedRole }) => {
      const response = await apiRequest(
        makeApp(allowedRole, "auth0|member5"),
        method,
        path,
        body,
        false,
      );

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    },
  );

  it.each(securedRoutes)(
    "rejects the wrong role for $method $path",
    async ({ method, path, body, wrongRole }) => {
      const response = await apiRequest(
        makeApp(wrongRole, "auth0|wrong-role"),
        method,
        path,
        body,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    },
  );

  it.each([
    ["POST", "/api/student/volunteer-requests", { overflowWorkId: 0 }],
    ["POST", "/api/student/volunteer-requests", { overflowWorkId: true }],
    ["GET", "/api/student/volunteer-requests/not-an-id", undefined],
    ["PATCH", "/api/student/volunteer-requests/0/withdraw", undefined],
  ] as const)("rejects malformed Student input for %s %s", async (method, path, body) => {
    const response = await apiRequest(
      makeApp("STUDENT", studentSubject),
      method,
      path,
      body,
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["GET", "/api/tutor/timesheets/not-an-id/status"],
    ["POST", "/api/tutor/timesheets/0/submit"],
    ["GET", "/api/tutor/excuses/not-an-id/status"],
  ] as const)("rejects a malformed Tutor identifier for %s %s", async (method, path) => {
    const response = await apiRequest(
      makeApp("TUTOR", tutorSubject),
      method,
      path,
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects malformed excuse decisions and requires a rejection reason", async () => {
    const decideExcuse = vi.fn();
    const app = makeApp("ORGANISER", "auth0|member5-organiser", {
      decideExcuse,
    });

    for (const [path, body] of [
      ["/api/excuses/not-an-id/decision", { decision: "APPROVE" }],
      ["/api/excuses/12/decision", { decision: "INVALID" }],
      ["/api/excuses/12/decision", { decision: "REJECT" }],
      ["/api/excuses/12/decision", { decision: "REJECT", reason: " " }],
    ] as const) {
      const response = await apiRequest(app, "PATCH", path, body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(decideExcuse).not.toHaveBeenCalled();
  });

  it("rejects work-log hours with more than two decimal places", async () => {
    const createTutorWorkLog = vi.fn();
    const response = await apiRequest(
      makeApp("TUTOR", tutorSubject, { createTutorWorkLog }),
      "POST",
      "/api/tutor/work-logs",
      {
        allocationId: 4,
        workDate: "2030-09-04",
        hours: 1.234,
        description: "Tutorial session",
      },
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(createTutorWorkLog).not.toHaveBeenCalled();
  });

  it("preserves the safe cross-user Student 404 for get and withdraw", async () => {
    const hidden = () => {
      throw createRouteError(
        404,
        "VOLUNTEER_REQUEST_NOT_FOUND",
        "The volunteer request could not be found.",
      );
    };
    const app = makeApp("STUDENT", studentSubject, {
      getStudentVolunteerRequest: hidden,
      withdrawStudentVolunteerRequest: hidden,
    });

    for (const [method, path] of [
      ["GET", "/api/student/volunteer-requests/99"],
      ["PATCH", "/api/student/volunteer-requests/99/withdraw"],
    ] as const) {
      const response = await apiRequest(app, method, path);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: {
          code: "VOLUNTEER_REQUEST_NOT_FOUND",
          message: "The volunteer request could not be found.",
        },
      });
    }
  });

  it("propagates volunteer duplicate/race conflicts safely", async () => {
    const createStudentVolunteerRequest = async () => {
      throw createRouteError(
        409,
        "VOLUNTEER_REQUEST_CONFLICT",
        "The work item is no longer available.",
      );
    };
    const response = await apiRequest(
      makeApp("STUDENT", studentSubject, { createStudentVolunteerRequest }),
      "POST",
      "/api/student/volunteer-requests",
      { overflowWorkId: 3 },
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "VOLUNTEER_REQUEST_CONFLICT",
        message: "The work item is no longer available.",
      },
    });
  });

  it("propagates safe timesheet missing and state-conflict errors", async () => {
    const app = makeApp("TUTOR", tutorSubject, {
      getTutorTimesheetStatus: async () => {
        throw createRouteError(
          404,
          "TIMESHEET_NOT_FOUND",
          "The timesheet could not be found.",
        );
      },
      submitTutorTimesheet: async () => {
        throw createRouteError(
          409,
          "TIMESHEET_SUBMISSION_CONFLICT",
          "The timesheet cannot be submitted from its current state.",
        );
      },
    });

    const missing = await apiRequest(
      app,
      "GET",
      "/api/tutor/timesheets/99/status",
    );
    const conflict = await apiRequest(
      app,
      "POST",
      "/api/tutor/timesheets/5/submit",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("TIMESHEET_NOT_FOUND");
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("TIMESHEET_SUBMISSION_CONFLICT");
  });

  it("propagates safe excuse missing, cross-user and stale-decision errors", async () => {
    const getTutorExcuseStatus = vi.fn(async () => {
      throw createRouteError(
        404,
        "EXCUSE_NOT_FOUND",
        "The requested excuse could not be found.",
      );
    });
    const decideExcuse = vi
      .fn()
      .mockRejectedValueOnce(
        createRouteError(
          404,
          "EXCUSE_NOT_FOUND",
          "The requested excuse could not be found.",
        ),
      )
      .mockRejectedValueOnce(
        createRouteError(
          409,
          "EXCUSE_DECISION_CONFLICT",
          "The excuse has already been decided or changed.",
        ),
      );
    const tutorApp = makeApp("TUTOR", tutorSubject, {
      getTutorExcuseStatus,
    });
    const organiserApp = makeApp("ORGANISER", "auth0|member5-organiser", {
      decideExcuse,
    });

    const hidden = await apiRequest(
      tutorApp,
      "GET",
      "/api/tutor/excuses/99/status",
    );
    const missing = await apiRequest(
      organiserApp,
      "PATCH",
      "/api/excuses/99/decision",
      { decision: "APPROVE" },
    );
    const stale = await apiRequest(
      organiserApp,
      "PATCH",
      "/api/excuses/12/decision",
      { decision: "REJECT", reason: "Duplicate decision" },
    );

    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe("EXCUSE_NOT_FOUND");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("EXCUSE_NOT_FOUND");
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("EXCUSE_DECISION_CONFLICT");
  });
});

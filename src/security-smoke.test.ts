import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  type AllocationSummary,
  type ProfileSummary,
  type StudentVolunteerRequestSummary,
  type TimesheetDecisionSummary,
  type TutorExcuseStatusSummary,
  type TutorExcuseSummary,
  type TutorExcuseWriteInput,
  type TutorTimeSlotSummary,
  type TutorTimeSlotWriteInput,
  type TutorTimesheetStatusSummary,
  type TutorWorkLogSummary,
  type TutorWorkLogWriteInput,
  type VolunteerClaimDecisionSummary,
} from "./app.js";
import type { AuthContext, TutorRole } from "./auth/contract.js";

/**
 * S2-M1-3 cross-role security smoke suite.
 *
 * This suite is intentionally built against the current integrated Basic API,
 * including the Sprint 2 Member 4/5/6 Student, allocation, approval, status and
 * public-holiday routes. It verifies the same role/ownership contract that the
 * live three-account release smoke uses.
 */

const PERSONAS = ["STUDENT", "TUTOR", "ORGANISER"] as const;
type Persona = (typeof PERSONAS)[number];

const PERSONA_PROFILES: Record<Persona, ProfileSummary> = {
  STUDENT: {
    id: 31,
    email: "smoke-student@tutormx.example",
    fullName: "Smoke Student",
    role: "STUDENT",
  },
  TUTOR: {
    id: 32,
    email: "smoke-tutor@tutormx.example",
    fullName: "Smoke Tutor",
    role: "TUTOR",
  },
  ORGANISER: {
    id: 33,
    email: "smoke-organiser@tutormx.example",
    fullName: "Smoke Organiser",
    role: "ORGANISER",
  },
};

const SUBJECTS: Record<Persona, string> = {
  STUDENT: "auth0|smoke-student",
  TUTOR: "auth0|smoke-tutor",
  ORGANISER: "auth0|smoke-organiser",
};

const TOKENS: Record<Persona, string> = {
  STUDENT: "student-smoke-token",
  TUTOR: "tutor-smoke-token",
  ORGANISER: "organiser-smoke-token",
};

const EXPIRED_TOKEN = "expired-smoke-token";
const UNLINKED_TOKEN = "unlinked-smoke-token";
const UNLINKED_SUBJECT = "auth0|smoke-unlinked";

function personaAuth(persona: Persona): AuthContext {
  return {
    subject: SUBJECTS[persona],
    role: PERSONA_PROFILES[persona].role,
    claims: { sub: SUBJECTS[persona] },
  };
}

async function verifySmokeToken(token: string): Promise<AuthContext> {
  for (const persona of PERSONAS) {
    if (token === TOKENS[persona]) {
      return personaAuth(persona);
    }
  }
  if (token === UNLINKED_TOKEN) {
    return {
      subject: UNLINKED_SUBJECT,
      role: null,
      claims: { sub: UNLINKED_SUBJECT },
    };
  }
  throw new Error("The access token is expired or invalid.");
}

async function findSmokeProfile(auth0Id: string): Promise<ProfileSummary | null> {
  for (const persona of PERSONAS) {
    if (auth0Id === SUBJECTS[persona]) {
      return PERSONA_PROFILES[persona];
    }
  }
  return null;
}

const volunteerRequest = (
  id = 71,
): StudentVolunteerRequestSummary => ({
  id,
  overflowWorkId: 51,
  status: "PENDING",
  reviewReason: null,
  createdAt: "2030-09-01T08:00:00.000Z",
  updatedAt: "2030-09-01T08:00:00.000Z",
});

const tutorTimesheet = (id = 81): TutorTimesheetStatusSummary => ({
  id,
  weekStart: "2030-09-02",
  status: "DRAFT",
  submittedAt: null,
  reviewedAt: null,
  reviewReason: null,
  totalHours: 2,
});

const tutorExcuseStatus = (id = 91): TutorExcuseStatusSummary => ({
  id,
  allocationId: 4,
  reason: "Sick",
  status: "PENDING",
  reviewReason: null,
  createdAt: "2030-09-01T08:00:00.000Z",
  updatedAt: "2030-09-01T08:00:00.000Z",
});

type SmokeOverrides = Partial<{
  findProfileByAuth0Id: (auth0Id: string) => Promise<ProfileSummary | null>;
  verifyAccessToken: (token: string) => Promise<AuthContext>;
  createTutorTimeSlot: (
    auth0Id: string,
    input: TutorTimeSlotWriteInput,
  ) => Promise<TutorTimeSlotSummary>;
  createTutorWorkLog: (
    auth0Id: string,
    input: TutorWorkLogWriteInput,
  ) => Promise<TutorWorkLogSummary>;
  createTutorExcuse: (
    auth0Id: string,
    input: TutorExcuseWriteInput,
  ) => Promise<TutorExcuseSummary>;
  getStudentVolunteerRequest: (
    auth0Id: string,
    requestId: number,
  ) => Promise<StudentVolunteerRequestSummary>;
  withdrawStudentVolunteerRequest: (
    auth0Id: string,
    requestId: number,
  ) => Promise<StudentVolunteerRequestSummary>;
  getTutorTimesheetStatus: (
    auth0Id: string,
    timesheetId: number,
  ) => Promise<TutorTimesheetStatusSummary>;
  getTutorExcuseStatus: (
    auth0Id: string,
    excuseId: number,
  ) => Promise<TutorExcuseStatusSummary>;
}>;

function smokeApp(overrides: SmokeOverrides = {}): Express {
  return createApp(async () => undefined, {
    findProfileByAuth0Id:
      overrides.findProfileByAuth0Id ?? findSmokeProfile,
    verifyAccessToken: overrides.verifyAccessToken ?? verifySmokeToken,

    onboardUser: async (_id, role) => ({ ...PERSONA_PROFILES.TUTOR, role }),
    allowSelfServiceOrganiser: true,
    getPublicHolidays: async () => ({
      source: "fallback",
      data: [],
      retrievedAt: null,
      reason: "unavailable",
    }),

    listCourses: async () => [
      { id: 1, code: "DEMO101", name: "Demo Course", hourlyRate: null, budget: null },
    ],
    createCourse: async (input) => ({ id: 11, ...input, hourlyRate: input.hourlyRate ?? null, budget: input.budget ?? null }),
    updateCourse: async (courseId, input) => ({ id: courseId, ...input, hourlyRate: input.hourlyRate ?? null, budget: input.budget ?? null }),
    deleteCourse: async () => undefined,

    listTutors: async () => [
      {
        id: 2,
        email: "tutor@tutormx.example",
        fullName: "Demo Tutor",
        role: "TUTOR",
        weeklyHours: 10,
        usedHours: 6,
        remainingHours: 4,
        workedHours: 0,
        weekStart: "2030-09-02T00:00:00.000Z",
        weekEnd: "2030-09-08T23:59:59.999Z",
        capacityStatus: "available",
      },
    ],

    getTutorDashboard: async () => ({
      allocations: [],
      weeklyLimit: 10,
      usedHours: 0,
      remainingHours: 10,
    }),
    createTutorTimeSlot:
      overrides.createTutorTimeSlot ??
      (async (_auth0Id, input) => ({
        id: 1,
        type: input.type,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        recurrence: input.recurrence ?? null,
        label: input.label ?? null,
        recurrenceUntil: input.recurrenceUntil?.toISOString() ?? null,
      })),
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
    createTutorWorkLog:
      overrides.createTutorWorkLog ??
      (async (_auth0Id, input) => ({ id: 1, timesheetId: 2, ...input })),
    createTutorExcuse:
      overrides.createTutorExcuse ??
      (async (_auth0Id, input) => ({ id: 1, status: "PENDING", ...input })),

    listStudentOpenWork: async () => [
      {
        id: 51,
        courseCode: "DEMO101",
        courseName: "Demo Course",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
        hours: 2,
        status: "OPEN",
        closesAt: null,
      },
    ],
    listStudentVolunteerRequests: async () => [
      {
        ...volunteerRequest(),
        courseCode: "DEMO101",
        courseName: "Demo Course",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
        hours: 2,
      },
    ],
    createStudentVolunteerRequest: async () => volunteerRequest(),
    getStudentVolunteerRequest:
      overrides.getStudentVolunteerRequest ??
      (async (_auth0Id, requestId) => volunteerRequest(requestId)),
    withdrawStudentVolunteerRequest:
      overrides.withdrawStudentVolunteerRequest ??
      (async (_auth0Id, requestId) => ({
        ...volunteerRequest(requestId),
        status: "WITHDRAWN",
      })),

    getTutorTimesheetStatus:
      overrides.getTutorTimesheetStatus ??
      (async (_auth0Id, timesheetId) => tutorTimesheet(timesheetId)),
    submitTutorTimesheet: async (_auth0Id, timesheetId) => ({
      ...tutorTimesheet(timesheetId),
      status: "SUBMITTED",
      submittedAt: "2030-09-05T10:00:00.000Z",
    }),
    getTutorExcuseStatus:
      overrides.getTutorExcuseStatus ??
      (async (_auth0Id, excuseId) => tutorExcuseStatus(excuseId)),
    decideExcuse: async (excuseId, input) => ({
      ...tutorExcuseStatus(excuseId),
      status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewReason: input.reason ?? null,
    }),

    listAllocationCandidates: async () => [],
    listOrganiserAllocations: async () => [],
    listOrganiserApprovals: async () => ({ timesheets: [], volunteerClaims: [], excuses: [] }),
    createAllocation: async (_auth0Id, input): Promise<AllocationSummary> => ({
      id: 61,
      tutorId: input.tutorId,
      courseId: input.courseId,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      allocatedHours: input.requestedHours,
      status: input.status ?? "PROPOSED",
    }),
    updateAllocation: async (_auth0Id, allocationId, input) => ({
      id: allocationId,
      tutorId: input.tutorId,
      courseId: input.courseId,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      allocatedHours: input.requestedHours,
      status: input.status ?? "PROPOSED",
    }),
    removeAllocation: async () => null,
    decideTimesheet: async (
      _auth0Id,
      timesheetId,
      input,
    ): Promise<TimesheetDecisionSummary> => ({
      id: timesheetId,
      tutorId: 2,
      weekStart: "2030-09-02",
      status: input.decision === "APPROVE" ? "APPROVED" : "RETURNED",
      reviewedAt: "2030-09-05T10:00:00.000Z",
      reviewedById: PERSONA_PROFILES.ORGANISER.id,
      reviewReason: input.reason ?? null,
    }),
    decideVolunteerClaim: async (
      claimId,
      input,
    ): Promise<VolunteerClaimDecisionSummary> => ({
      id: claimId,
      overflowWorkId: 51,
      studentId: PERSONA_PROFILES.STUDENT.id,
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
    requestVerificationEmail: async () => undefined,
    deleteAccount: async () => undefined,
  });
}

const candidateQuery =
  "courseId=3&startsAt=2030-09-04T14:00:00.000Z&endsAt=2030-09-04T16:00:00.000Z&minimumMark=50&requestedHours=2";

const allocationBody = {
  tutorId: 2,
  courseId: 3,
  startsAt: "2030-09-04T14:00:00.000Z",
  endsAt: "2030-09-04T16:00:00.000Z",
  minimumMark: 50,
  requestedHours: 2,
  status: "CONFIRMED",
};

type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

interface CriticalEndpoint {
  label: string;
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
  allowedRoles: readonly TutorRole[];
}

const ANY_TUTOR_MX_ROLE: readonly TutorRole[] = [
  "STUDENT",
  "TUTOR",
  "ORGANISER",
];

/** Every authenticated route in the current integrated Sprint 2 Basic API. */
const criticalEndpoints: CriticalEndpoint[] = [
  {
    label: "POST /api/auth/onboarding",
    method: "post",
    path: "/api/auth/onboarding",
    body: { role: "TUTOR" },
    allowedRoles: ANY_TUTOR_MX_ROLE,
  },
  {
    label: "POST /api/auth/resend-verification",
    method: "post",
    path: "/api/auth/resend-verification",
    allowedRoles: ANY_TUTOR_MX_ROLE,
  },
  {
    label: "GET /api/me",
    method: "get",
    path: "/api/me",
    allowedRoles: ANY_TUTOR_MX_ROLE,
  },
  {
    label: "GET /api/profile/current",
    method: "get",
    path: "/api/profile/current",
    allowedRoles: ANY_TUTOR_MX_ROLE,
  },
  {
    label: "GET /api/public-holidays",
    method: "get",
    path: "/api/public-holidays?year=2030",
    allowedRoles: ANY_TUTOR_MX_ROLE,
  },
  {
    label: "GET /api/courses",
    method: "get",
    path: "/api/courses",
    allowedRoles: ANY_TUTOR_MX_ROLE,
  },
  {
    label: "POST /api/courses",
    method: "post",
    path: "/api/courses",
    body: { code: "SMOKE101", name: "Smoke Course" },
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "PATCH /api/courses/:courseId",
    method: "patch",
    path: "/api/courses/3",
    body: { code: "SMOKE101", name: "Smoke Course" },
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "DELETE /api/courses/:courseId",
    method: "delete",
    path: "/api/courses/3",
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "GET /api/tutors",
    method: "get",
    path: "/api/tutors",
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "GET /api/allocations/candidates",
    method: "get",
    path: `/api/allocations/candidates?${candidateQuery}`,
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "GET /api/allocations",
    method: "get",
    path: "/api/allocations",
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "GET /api/organiser/approvals",
    method: "get",
    path: "/api/organiser/approvals",
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "POST /api/allocations",
    method: "post",
    path: "/api/allocations",
    body: allocationBody,
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "PATCH /api/allocations/:allocationId",
    method: "patch",
    path: "/api/allocations/61",
    body: allocationBody,
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "DELETE /api/allocations/:allocationId",
    method: "delete",
    path: "/api/allocations/61",
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "PATCH /api/timesheets/:timesheetId/decision",
    method: "patch",
    path: "/api/timesheets/81/decision",
    body: { decision: "APPROVE" },
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "PATCH /api/volunteer-claims/:claimId/decision",
    method: "patch",
    path: "/api/volunteer-claims/71/decision",
    body: { decision: "REJECT", reason: "No longer needed" },
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "GET /api/tutors/:tutorId/marks",
    method: "get",
    path: "/api/tutors/2/marks",
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "PUT /api/tutors/:tutorId/marks",
    method: "put",
    path: "/api/tutors/2/marks",
    body: { courseId: 3, mark: 75 },
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "DELETE /api/tutors/:tutorId/marks/:courseId",
    method: "delete",
    path: "/api/tutors/2/marks/3",
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "GET /api/tutors/:tutorId/time-slots",
    method: "get",
    path: "/api/tutors/2/time-slots",
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "PATCH /api/excuses/:excuseId/decision",
    method: "patch",
    path: "/api/excuses/91/decision",
    body: { decision: "APPROVE" },
    allowedRoles: ["ORGANISER"],
  },
  {
    label: "GET /api/tutor/dashboard",
    method: "get",
    path: "/api/tutor/dashboard",
    allowedRoles: ["TUTOR"],
  },
  {
    label: "POST /api/tutor/time-slots",
    method: "post",
    path: "/api/tutor/time-slots",
    body: {
      type: "BUSY",
      startsAt: "2030-09-04T14:00:00.000Z",
      endsAt: "2030-09-04T16:00:00.000Z",
    },
    allowedRoles: ["TUTOR"],
  },
  {
    label: "POST /api/tutor/work-logs",
    method: "post",
    path: "/api/tutor/work-logs",
    body: {
      allocationId: 4,
      workDate: "2030-09-04",
      hours: 2,
      description: "Smoke session",
    },
    allowedRoles: ["TUTOR"],
  },
  {
    label: "POST /api/tutor/excuses",
    method: "post",
    path: "/api/tutor/excuses",
    body: { allocationId: 4, reason: "Sick" },
    allowedRoles: ["TUTOR"],
  },
  {
    label: "GET /api/tutor/timesheets/:timesheetId/status",
    method: "get",
    path: "/api/tutor/timesheets/81/status",
    allowedRoles: ["TUTOR"],
  },
  {
    label: "POST /api/tutor/timesheets/:timesheetId/submit",
    method: "post",
    path: "/api/tutor/timesheets/81/submit",
    allowedRoles: ["TUTOR"],
  },
  {
    label: "GET /api/tutor/excuses/:excuseId/status",
    method: "get",
    path: "/api/tutor/excuses/91/status",
    allowedRoles: ["TUTOR"],
  },
  {
    label: "GET /api/student/open-work",
    method: "get",
    path: "/api/student/open-work",
    allowedRoles: ["STUDENT"],
  },
  {
    label: "GET /api/student/volunteer-requests",
    method: "get",
    path: "/api/student/volunteer-requests",
    allowedRoles: ["STUDENT"],
  },
  {
    label: "POST /api/student/volunteer-requests",
    method: "post",
    path: "/api/student/volunteer-requests",
    body: { overflowWorkId: 51 },
    allowedRoles: ["STUDENT"],
  },
  {
    label: "GET /api/student/volunteer-requests/:requestId",
    method: "get",
    path: "/api/student/volunteer-requests/71",
    allowedRoles: ["STUDENT"],
  },
  {
    label: "PATCH /api/student/volunteer-requests/:requestId/withdraw",
    method: "patch",
    path: "/api/student/volunteer-requests/71/withdraw",
    allowedRoles: ["STUDENT"],
  },
  {
    label: "DELETE /api/auth/delete-account",
    method: "delete",
    path: "/api/auth/delete-account",
    allowedRoles: ANY_TUTOR_MX_ROLE,
  },
];

function openRequest(
  app: Express,
  method: HttpMethod,
  path: string,
): request.Test {
  switch (method) {
    case "get":
      return request(app).get(path);
    case "post":
      return request(app).post(path);
    case "patch":
      return request(app).patch(path);
    case "put":
      return request(app).put(path);
    case "delete":
      return request(app).delete(path);
  }
}

function callEndpoint(
  app: Express,
  endpoint: CriticalEndpoint,
  token?: string,
): request.Test {
  const test = openRequest(app, endpoint.method, endpoint.path);
  if (token !== undefined) {
    test.set("Authorization", `Bearer ${token}`);
  }
  if (endpoint.body !== undefined) {
    test.send(endpoint.body);
  }
  return test;
}

describe("S2-M1-3 cross-role security smoke", () => {
  describe("three-role journeys land only in the expected workspace", () => {
    it("keeps the Student account on the Student surface", async () => {
      const app = smokeApp();

      const me = await request(app)
        .get("/api/me")
        .set("Authorization", `Bearer ${TOKENS.STUDENT}`);
      expect(me.status).toBe(200);
      expect(me.body).toEqual({ data: { profile: PERSONA_PROFILES.STUDENT } });

      const openWork = await request(app)
        .get("/api/student/open-work")
        .set("Authorization", `Bearer ${TOKENS.STUDENT}`);
      expect(openWork.status).toBe(200);
      expect(openWork.body.data.workItems).toHaveLength(1);

      const volunteerRequests = await request(app)
        .get("/api/student/volunteer-requests")
        .set("Authorization", `Bearer ${TOKENS.STUDENT}`);
      expect(volunteerRequests.status).toBe(200);

      for (const endpoint of criticalEndpoints) {
        if (endpoint.allowedRoles.includes("STUDENT")) {
          continue;
        }
        const blocked = await callEndpoint(app, endpoint, TOKENS.STUDENT);
        expect(
          blocked.status,
          `${endpoint.label} must stay closed to Students`,
        ).toBe(403);
        expect(blocked.body.error.code, endpoint.label).toBe("FORBIDDEN");
      }
    });

    it("keeps the Tutor account on the Tutor surface", async () => {
      const app = smokeApp();

      const me = await request(app)
        .get("/api/me")
        .set("Authorization", `Bearer ${TOKENS.TUTOR}`);
      expect(me.status).toBe(200);
      expect(me.body).toEqual({ data: { profile: PERSONA_PROFILES.TUTOR } });

      const dashboard = await request(app)
        .get("/api/tutor/dashboard")
        .set("Authorization", `Bearer ${TOKENS.TUTOR}`);
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.data.dashboard).toMatchObject({
        weeklyLimit: 10,
        usedHours: 0,
      });

      const timesheet = await request(app)
        .get("/api/tutor/timesheets/81/status")
        .set("Authorization", `Bearer ${TOKENS.TUTOR}`);
      expect(timesheet.status).toBe(200);
      expect(timesheet.body.data.timesheet.id).toBe(81);

      for (const endpoint of criticalEndpoints) {
        if (endpoint.allowedRoles.includes("TUTOR")) {
          continue;
        }
        const blocked = await callEndpoint(app, endpoint, TOKENS.TUTOR);
        expect(
          blocked.status,
          `${endpoint.label} must stay closed to Tutors`,
        ).toBe(403);
        expect(blocked.body.error.code, endpoint.label).toBe("FORBIDDEN");
      }
    });

    it("keeps the Organiser account on the Organiser surface", async () => {
      const app = smokeApp();

      const me = await request(app)
        .get("/api/me")
        .set("Authorization", `Bearer ${TOKENS.ORGANISER}`);
      expect(me.status).toBe(200);
      expect(me.body).toEqual({ data: { profile: PERSONA_PROFILES.ORGANISER } });

      const tutors = await request(app)
        .get("/api/tutors")
        .set("Authorization", `Bearer ${TOKENS.ORGANISER}`);
      expect(tutors.status).toBe(200);

      const candidates = await request(app)
        .get(`/api/allocations/candidates?${candidateQuery}`)
        .set("Authorization", `Bearer ${TOKENS.ORGANISER}`);
      expect(candidates.status).toBe(200);

      const allocation = await request(app)
        .post("/api/allocations")
        .set("Authorization", `Bearer ${TOKENS.ORGANISER}`)
        .send(allocationBody);
      expect(allocation.status).toBe(201);

      for (const endpoint of criticalEndpoints) {
        if (endpoint.allowedRoles.includes("ORGANISER")) {
          continue;
        }
        const blocked = await callEndpoint(app, endpoint, TOKENS.ORGANISER);
        expect(
          blocked.status,
          `${endpoint.label} must stay closed to Organisers`,
        ).toBe(403);
        expect(blocked.body.error.code, endpoint.label).toBe("FORBIDDEN");
      }
    });
  });

  describe("token states across every current authenticated Basic endpoint", () => {
    it("returns 401 AUTHENTICATION_REQUIRED when the bearer token is missing", async () => {
      const app = smokeApp();

      for (const endpoint of criticalEndpoints) {
        const response = await callEndpoint(app, endpoint);
        expect(
          response.status,
          `${endpoint.label} must require a bearer token`,
        ).toBe(401);
        expect(response.body.error.code, endpoint.label).toBe(
          "AUTHENTICATION_REQUIRED",
        );
      }
    });

    it("returns 401 INVALID_ACCESS_TOKEN when the bearer token is expired", async () => {
      const app = smokeApp();

      for (const endpoint of criticalEndpoints) {
        const response = await callEndpoint(app, endpoint, EXPIRED_TOKEN);
        expect(
          response.status,
          `${endpoint.label} must reject an expired token`,
        ).toBe(401);
        expect(response.body.error.code, endpoint.label).toBe(
          "INVALID_ACCESS_TOKEN",
        );
      }
    });

    it("returns 403 FORBIDDEN for every wrong-role caller without leaking data", async () => {
      const app = smokeApp();
      const personaEmails = PERSONAS.map(
        (persona) => PERSONA_PROFILES[persona].email,
      );

      for (const endpoint of criticalEndpoints) {
        for (const persona of PERSONAS) {
          if (endpoint.allowedRoles.includes(persona)) {
            continue;
          }
          const blocked = await callEndpoint(app, endpoint, TOKENS[persona]);
          expect(
            blocked.status,
            `${endpoint.label} must stay closed to ${persona}`,
          ).toBe(403);
          expect(blocked.body.error.code, endpoint.label).toBe("FORBIDDEN");
          for (const email of personaEmails) {
            expect(
              blocked.text,
              `${endpoint.label} must not leak ${email}`,
            ).not.toContain(email);
          }
        }
      }
    });
  });

  describe("identifier manipulation stays inside the caller's own data", () => {
    it("records tutor writes under the authenticated tutor even when another tutorId is supplied", async () => {
      const createTutorTimeSlot = vi.fn(
        async (
          _auth0Id: string,
          input: TutorTimeSlotWriteInput,
        ): Promise<TutorTimeSlotSummary> => ({
          id: 1,
          type: input.type,
          startsAt: input.startsAt.toISOString(),
          endsAt: input.endsAt.toISOString(),
          recurrence: input.recurrence ?? null,
          label: input.label ?? null,
          recurrenceUntil: input.recurrenceUntil?.toISOString() ?? null,
        }),
      );
      const createTutorWorkLog = vi.fn(
        async (
          _auth0Id: string,
          input: TutorWorkLogWriteInput,
        ): Promise<TutorWorkLogSummary> => ({
          id: 2,
          timesheetId: 3,
          ...input,
        }),
      );
      const createTutorExcuse = vi.fn(
        async (
          _auth0Id: string,
          input: TutorExcuseWriteInput,
        ): Promise<TutorExcuseSummary> => ({
          id: 3,
          status: "PENDING",
          ...input,
        }),
      );
      const app = smokeApp({
        createTutorTimeSlot,
        createTutorWorkLog,
        createTutorExcuse,
      });

      const timeSlot = await request(app)
        .post("/api/tutor/time-slots")
        .set("Authorization", `Bearer ${TOKENS.TUTOR}`)
        .send({
          type: "BUSY",
          startsAt: "2030-09-04T14:00:00.000Z",
          endsAt: "2030-09-04T16:00:00.000Z",
        });
      expect(timeSlot.status).toBe(201);
      expect(createTutorTimeSlot.mock.calls[0]![0]).toBe(SUBJECTS.TUTOR);
      expect(createTutorTimeSlot.mock.calls[0]![1]).not.toHaveProperty("tutorId");

      const workLog = await request(app)
        .post("/api/tutor/work-logs")
        .set("Authorization", `Bearer ${TOKENS.TUTOR}`)
        .send({
          allocationId: 4,
          workDate: "2030-09-04",
          hours: 2,
          description: "Smoke session",
          tutorId: 999,
        });
      expect(workLog.status).toBe(201);
      expect(createTutorWorkLog.mock.calls[0]![0]).toBe(SUBJECTS.TUTOR);
      expect(createTutorWorkLog.mock.calls[0]![1]).not.toHaveProperty("tutorId");

      const excuse = await request(app)
        .post("/api/tutor/excuses")
        .set("Authorization", `Bearer ${TOKENS.TUTOR}`)
        .send({ allocationId: 4, reason: "Sick", tutorId: 999 });
      expect(excuse.status).toBe(201);
      expect(createTutorExcuse.mock.calls[0]![0]).toBe(SUBJECTS.TUTOR);
      expect(createTutorExcuse.mock.calls[0]![1]).not.toHaveProperty("tutorId");
    });

    it("passes the authenticated Student subject into request reads and withdrawals", async () => {
      const getStudentVolunteerRequest = vi.fn(
        async (_auth0Id: string, requestId: number) => volunteerRequest(requestId),
      );
      const withdrawStudentVolunteerRequest = vi.fn(
        async (_auth0Id: string, requestId: number) => ({
          ...volunteerRequest(requestId),
          status: "WITHDRAWN" as const,
        }),
      );
      const app = smokeApp({
        getStudentVolunteerRequest,
        withdrawStudentVolunteerRequest,
      });

      const read = await request(app)
        .get("/api/student/volunteer-requests/77?studentId=999")
        .set("Authorization", `Bearer ${TOKENS.STUDENT}`);
      expect(read.status).toBe(200);
      expect(getStudentVolunteerRequest).toHaveBeenCalledWith(
        SUBJECTS.STUDENT,
        77,
      );

      const withdrawn = await request(app)
        .patch("/api/student/volunteer-requests/77/withdraw")
        .set("Authorization", `Bearer ${TOKENS.STUDENT}`)
        .send({ studentId: 999 });
      expect(withdrawn.status).toBe(200);
      expect(withdrawStudentVolunteerRequest).toHaveBeenCalledWith(
        SUBJECTS.STUDENT,
        77,
      );
    });

    it("passes the authenticated Tutor subject into timesheet and excuse status reads", async () => {
      const getTutorTimesheetStatus = vi.fn(
        async (_auth0Id: string, timesheetId: number) => tutorTimesheet(timesheetId),
      );
      const getTutorExcuseStatus = vi.fn(
        async (_auth0Id: string, excuseId: number) => tutorExcuseStatus(excuseId),
      );
      const app = smokeApp({ getTutorTimesheetStatus, getTutorExcuseStatus });

      const timesheet = await request(app)
        .get("/api/tutor/timesheets/88/status?tutorId=999")
        .set("Authorization", `Bearer ${TOKENS.TUTOR}`);
      expect(timesheet.status).toBe(200);
      expect(getTutorTimesheetStatus).toHaveBeenCalledWith(SUBJECTS.TUTOR, 88);

      const excuse = await request(app)
        .get("/api/tutor/excuses/99/status?tutorId=999")
        .set("Authorization", `Bearer ${TOKENS.TUTOR}`);
      expect(excuse.status).toBe(200);
      expect(getTutorExcuseStatus).toHaveBeenCalledWith(SUBJECTS.TUTOR, 99);
    });
  });

  describe("account binding edge cases", () => {
    it("fails closed with 404 PROFILE_NOT_FOUND when a valid token has no Tutor Mx profile", async () => {
      const app = smokeApp();

      const me = await request(app)
        .get("/api/me")
        .set("Authorization", `Bearer ${UNLINKED_TOKEN}`);
      expect(me.status).toBe(404);
      expect(me.body.error.code).toBe("PROFILE_NOT_FOUND");

      const dashboard = await request(app)
        .get("/api/tutor/dashboard")
        .set("Authorization", `Bearer ${UNLINKED_TOKEN}`);
      expect(dashboard.status).toBe(404);
      expect(dashboard.body.error.code).toBe("PROFILE_NOT_FOUND");
    });

    it("returns 403 ROLE_MISMATCH when the token role disagrees with the stored profile", async () => {
      const app = smokeApp({
        verifyAccessToken: async (token: string): Promise<AuthContext> => {
          if (token === "mismatched-smoke-token") {
            return {
              subject: SUBJECTS.TUTOR,
              role: "ORGANISER",
              claims: { sub: SUBJECTS.TUTOR },
            };
          }
          return verifySmokeToken(token);
        },
      });

      const me = await request(app)
        .get("/api/me")
        .set("Authorization", "Bearer mismatched-smoke-token");
      expect(me.status).toBe(403);
      expect(me.body.error.code).toBe("ROLE_MISMATCH");

      const dashboard = await request(app)
        .get("/api/tutor/dashboard")
        .set("Authorization", "Bearer mismatched-smoke-token");
      expect(dashboard.status).toBe(403);
      expect(dashboard.body.error.code).toBe("ROLE_MISMATCH");
    });
  });

  describe("public surface stays public and safe", () => {
    it("serves health/readiness and password reset publicly while onboarding stays authenticated", async () => {
      const app = smokeApp();

      const health = await request(app).get("/health");
      expect(health.status).toBe(200);
      expect(health.body).toEqual({ status: "ok" });

      const ready = await request(app).get("/ready");
      expect(ready.status).toBe(200);

      const reset = await request(app)
        .post("/api/auth/password-reset")
        .send({ email: "anyone@tutormx.example" });
      expect(reset.status).toBe(202);

      const onboarding = await request(app)
        .post("/api/auth/onboarding")
        .send({ role: "TUTOR" });
      expect(onboarding.status).toBe(401);
      expect(onboarding.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });
});

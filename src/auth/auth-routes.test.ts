import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  createRouteError,
  type AppDependencies,
  type AllocationCandidateQuery,
  type AllocationCandidateSummary,
  type CourseSummary,
  type ProfileSummary,
  type TutorDashboardSummary,
  type TutorExcuseSummary,
  type TutorExcuseWriteInput,
  type TutorMarkSummary,
  type TutorMarkWriteInput,
  type TutorSummary,
  type TutorTimeSlotSummary,
  type TutorTimeSlotWriteInput,
  type TutorWorkLogSummary,
  type TutorWorkLogWriteInput,
} from "../app.js";
import type { AuthContext, TutorRole } from "./contract.js";

const profile: ProfileSummary = {
  id: 7,
  email: "tutor@tutormx.example",
  fullName: "Demo Tutor",
  role: "TUTOR",
};

const organiserProfile: ProfileSummary = {
  id: 8,
  email: "organiser@tutormx.example",
  fullName: "Demo Organiser",
  role: "ORGANISER",
};

function auth(role: TutorRole | null = "TUTOR"): AuthContext {
  return {
    subject: "auth0|tutor",
    role,
    claims: { sub: "auth0|tutor" },
  };
}

function organiserAccess() {
  return {
    findProfileByAuth0Id: async () => organiserProfile,
    verifyAccessToken: async () => auth("ORGANISER"),
  };
}

function makeApp(
  overrides: Partial<{
    corsOrigin: string;
    createCourse: (input: {
      code: string;
      name: string;
    }) => Promise<CourseSummary>;
    createTutor: (input: {
      auth0Id: string;
      email: string;
      fullName: string;
      weeklyHours?: number | null;
    }) => Promise<TutorSummary>;
    deleteCourse: (courseId: number) => Promise<void>;
    findProfileByAuth0Id: (id: string) => Promise<ProfileSummary | null>;
    onboardUser: (id: string, role: TutorRole) => Promise<ProfileSummary>;
    allowSelfServiceOrganiser: boolean;
    getPublicHolidays: AppDependencies["getPublicHolidays"];
    listCourses: () => Promise<CourseSummary[]>;
    listTutors: () => Promise<TutorSummary[]>;
    requestPasswordReset: (email: string) => Promise<void>;
    updateCourse: (
      courseId: number,
      input: { code: string; name: string },
    ) => Promise<CourseSummary>;
    updateTutor: (
      tutorId: number,
      input: {
        email?: string;
        fullName?: string;
        weeklyHours?: number | null;
      },
    ) => Promise<TutorSummary>;
    getTutorDashboard: (auth0Id: string) => Promise<TutorDashboardSummary>;
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
    listAllocationCandidates: (
      input: AllocationCandidateQuery,
    ) => Promise<AllocationCandidateSummary[]>;
    upsertTutorMark: (
      tutorId: number,
      input: TutorMarkWriteInput,
    ) => Promise<TutorMarkSummary>;
    listTutorMarks: (tutorId: number) => Promise<TutorMarkSummary[]>;
    listTutorTimeSlots: (tutorId: number) => Promise<TutorTimeSlotSummary[]>;
    createTutorTimeSlotForTutor: (
      tutorId: number,
      input: TutorTimeSlotWriteInput,
    ) => Promise<TutorTimeSlotSummary>;
    deleteAccount: (auth0Id: string) => Promise<void>;
    verifyAccessToken: (token: string) => Promise<AuthContext>;
  }> = {},
) {
  return createApp(async () => undefined, {
    ...(overrides.corsOrigin ? { corsOrigin: overrides.corsOrigin } : {}),

    createCourse:
      overrides.createCourse ??
      (async (input) => ({
        id: 11,
        ...input,
      })),

    createTutor:
      overrides.createTutor ??
      (async (input) => ({
        id: 22,
        role: "TUTOR",
        weeklyHours: input.weeklyHours ?? null,
        ...input,
      })),

    deleteCourse: overrides.deleteCourse ?? (async () => undefined),

    findProfileByAuth0Id:
      overrides.findProfileByAuth0Id ?? (async () => profile),

    onboardUser:
      overrides.onboardUser ??
      (async (_id, role) => ({
        ...profile,
        role,
      })),

    allowSelfServiceOrganiser:
      overrides.allowSelfServiceOrganiser ?? true,

    getPublicHolidays:
      overrides.getPublicHolidays ??
      (async () => ({
        source: "fallback",
        data: [],
        retrievedAt: null,
        reason: "unavailable",
      })),

    listCourses:
      overrides.listCourses ??
      (async () => [
        {
          id: 1,
          code: "DEMO101",
          name: "Demo Course",
        },
      ]),

    listTutors:
      overrides.listTutors ??
      (async () => [
        {
          id: 2,
          auth0Id: "demo|tutor",
          email: "tutor@tutormx.example",
          fullName: "Demo Tutor",
          role: "TUTOR",
          weeklyHours: 10,
        },
      ]),

    requestPasswordReset:
      overrides.requestPasswordReset ?? (async () => undefined),

    updateCourse:
      overrides.updateCourse ??
      (async (courseId, input) => ({
        id: courseId,
        ...input,
      })),

    updateTutor:
      overrides.updateTutor ??
      (async (tutorId, input) => ({
        id: tutorId,
        auth0Id: "demo|tutor",
        email: input.email ?? "tutor@tutormx.example",
        fullName: input.fullName ?? "Demo Tutor",
        role: "TUTOR",
        weeklyHours: input.weeklyHours ?? 10,
      })),

    getTutorDashboard:
      overrides.getTutorDashboard ??
      (async () => ({
        allocations: [],
        weeklyLimit: 10,
        usedHours: 0,
        remainingHours: 10,
      })),

    createTutorTimeSlot:
      overrides.createTutorTimeSlot ??
      (async (_auth0Id, input) => ({
        id: 1,
        type: input.type,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        recurrence: input.recurrence ?? null,
      })),

    createTutorWorkLog:
      overrides.createTutorWorkLog ??
      (async (_auth0Id, input) => ({
        id: 1,
        timesheetId: 2,
        ...input,
      })),

    createTutorExcuse:
      overrides.createTutorExcuse ??
      (async (_auth0Id, input) => ({
        id: 1,
        status: "PENDING",
        ...input,
      })),

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

    listAllocationCandidates:
      overrides.listAllocationCandidates ?? (async () => []),

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

    removeAllocation: async () => undefined,

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

    upsertTutorMark:
      overrides.upsertTutorMark ??
      (async (_tutorId, input) => ({
        id: 1,
        courseId: input.courseId,
        courseCode: "DEMO101",
        courseName: "Demo Course",
        mark: input.mark,
      })),

    listTutorMarks: overrides.listTutorMarks ?? (async () => []),

    listTutorTimeSlots: overrides.listTutorTimeSlots ?? (async () => []),

    createTutorTimeSlotForTutor:
      overrides.createTutorTimeSlotForTutor ??
      (async (_tutorId, input) => ({
        id: 1,
        type: input.type,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        recurrence: input.recurrence ?? null,
      })),

    deleteAccount:
      overrides.deleteAccount ?? (async () => undefined),

    verifyAccessToken:
      overrides.verifyAccessToken ?? (async () => auth()),
  });
}

describe("authentication contract", () => {
  it("returns the agreed 401 JSON when no bearer token is supplied", async () => {
    const response = await request(makeApp()).get("/api/me");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "A valid bearer token is required.",
      },
    });
  });

  it("returns 401 without private data for an invalid or expired token", async () => {
    const app = makeApp({
      verifyAccessToken: async () => {
        throw new Error("expired");
      },
    });

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer expired-token");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "INVALID_ACCESS_TOKEN",
        message: "A valid bearer token is required.",
      },
    });

    expect(response.text).not.toContain(profile.email);
  });

  it("resolves a newly provisioned role from Neon when the current token has no role claim yet", async () => {
    const app = makeApp({
      verifyAccessToken: async () => auth(null),
    });

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body.data.profile.role).toBe("TUTOR");
  });

  it("provisions the selected role through the authenticated onboarding endpoint", async () => {
    const onboardUser = vi.fn().mockResolvedValue({
      ...profile,
      role: "STUDENT",
    });

    const app = makeApp({
      onboardUser,
      verifyAccessToken: async () => ({
        ...auth(null),
        subject: "auth0|new-user",
      }),
    });

    const response = await request(app)
      .post("/api/auth/onboarding")
      .set("Authorization", "Bearer first-login-token")
      .send({ role: "STUDENT" });

    expect(response.status).toBe(200);

    expect(onboardUser).toHaveBeenCalledWith(
      "auth0|new-user",
      "STUDENT",
    );
  });

  it("rejects an invalid self-selected role", async () => {
    const onboardUser = vi.fn();

    const response = await request(
      makeApp({ onboardUser }),
    )
      .post("/api/auth/onboarding")
      .set("Authorization", "Bearer valid-token")
      .send({ role: "ADMIN" });

    expect(response.status).toBe(400);
    expect(onboardUser).not.toHaveBeenCalled();
  });

  it("keeps organiser self-sign-up behind the backend environment gate", async () => {
    const onboardUser = vi.fn();

    const response = await request(
      makeApp({
        onboardUser,
        allowSelfServiceOrganiser: false,
      }),
    )
      .post("/api/auth/onboarding")
      .set("Authorization", "Bearer valid-token")
      .send({ role: "ORGANISER" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(
      "ORGANISER_SELF_SIGNUP_DISABLED",
    );
    expect(onboardUser).not.toHaveBeenCalled();
  });

  it("lets a valid token and matching role reach the profile handler", async () => {
    const findProfileByAuth0Id = vi
      .fn()
      .mockResolvedValue(profile);

    const app = makeApp({
      findProfileByAuth0Id,
    });

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(findProfileByAuth0Id).toHaveBeenCalledWith(
      "auth0|tutor",
    );

    expect(response.body).toEqual({
      data: {
        profile,
      },
    });
  });

  it("exposes the current-user profile contract on the alias route", async () => {
    const findProfileByAuth0Id = vi
      .fn()
      .mockResolvedValue(profile);

    const app = makeApp({
      findProfileByAuth0Id,
    });

    const response = await request(app)
      .get("/api/profile/current")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      data: {
        profile,
      },
    });
  });

  it("blocks a stale token whose role differs from the database profile", async () => {
    const app = makeApp({
      verifyAccessToken: async () => auth("STUDENT"),
    });

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer stale-token");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_MISMATCH");
  });

  it("returns a safe not-found response when the linked profile is absent", async () => {
    const app = makeApp({
      findProfileByAuth0Id: async () => null,
    });

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PROFILE_NOT_FOUND");
  });

  it("uses the central safe error format when a handler dependency fails", async () => {
    const app = makeApp({
      findProfileByAuth0Id: async () => {
        throw new Error("database connection details");
      },
    });

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(500);

    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    });

    expect(response.text).not.toContain(
      "database connection details",
    );
  });

  it("deletes only the account identified by the verified token subject", async () => {
    const deleteAccount = vi.fn().mockResolvedValue(undefined);

    const response = await request(
      makeApp({ deleteAccount }),
    )
      .delete("/api/auth/delete-account")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(204);

    expect(deleteAccount).toHaveBeenCalledWith(
      "auth0|tutor",
    );
  });
});

describe("GET /api/public-holidays", () => {
  it("requires authentication before calling the external adapter", async () => {
    const getPublicHolidays = vi.fn<AppDependencies["getPublicHolidays"]>();

    const response = await request(makeApp({ getPublicHolidays })).get(
      "/api/public-holidays?year=2026",
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(getPublicHolidays).not.toHaveBeenCalled();
  });

  it.each(["ORGANISER", "TUTOR", "STUDENT"] as const)(
    "allows an authenticated %s profile to read safe holiday fields",
    async (role) => {
      const holidays = [
        {
          date: "2026-12-25",
          name: "Christmas Day",
          countryCode: "ZA" as const,
          nationalHoliday: true,
          holidayTypes: ["Public"],
        },
      ];
      const getPublicHolidays = vi
        .fn<AppDependencies["getPublicHolidays"]>()
        .mockResolvedValue({
          source: "external",
          data: holidays,
          retrievedAt: "2026-09-12T10:00:00.000Z",
        });
      const matchingProfile = { ...profile, role };
      const app = makeApp({
        findProfileByAuth0Id: async () => matchingProfile,
        verifyAccessToken: async () => auth(role),
        getPublicHolidays,
      });

      const response = await request(app)
        .get("/api/public-holidays?year=2026")
        .set("Authorization", "Bearer valid-token");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: {
          source: "external",
          holidays,
          retrievedAt: "2026-09-12T10:00:00.000Z",
        },
      });
      expect(getPublicHolidays).toHaveBeenCalledOnce();
      expect(getPublicHolidays).toHaveBeenCalledWith(2026);
    },
  );

  it("returns a controlled successful fallback when the provider is unavailable", async () => {
    const getPublicHolidays = vi
      .fn<AppDependencies["getPublicHolidays"]>()
      .mockResolvedValue({
        source: "fallback",
        data: [],
        retrievedAt: null,
        reason: "timeout",
      });

    const response = await request(makeApp({ getPublicHolidays }))
      .get("/api/public-holidays?year=2026")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        source: "fallback",
        holidays: [],
        retrievedAt: null,
        reason: "timeout",
      },
    });
  });

  it.each([
    "/api/public-holidays",
    "/api/public-holidays?year=1999",
    "/api/public-holidays?year=2101",
    "/api/public-holidays?year=2026.5",
    "/api/public-holidays?year=20x6",
    "/api/public-holidays?year=2026&year=2027",
  ])("rejects an invalid or ambiguous year: %s", async (path) => {
    const getPublicHolidays = vi.fn<AppDependencies["getPublicHolidays"]>();

    const response = await request(makeApp({ getPublicHolidays }))
      .get(path)
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Enter a four-digit year from 2000 to 2100.",
      },
    });
    expect(getPublicHolidays).not.toHaveBeenCalled();
  });

  it("keeps unexpected adapter errors private", async () => {
    const getPublicHolidays = vi
      .fn<AppDependencies["getPublicHolidays"]>()
      .mockRejectedValue(new Error("private upstream details"));

    const response = await request(makeApp({ getPublicHolidays }))
      .get("/api/public-holidays?year=2026")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    });
    expect(response.text).not.toContain("private upstream details");
  });
});

describe("course and tutor endpoints", () => {
  it("requires a bearer token before returning course data", async () => {
    const listCourses = vi.fn();

    const response = await request(
      makeApp({ listCourses }),
    ).get("/api/courses");

    expect(listCourses).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(
      "AUTHENTICATION_REQUIRED",
    );
  });

  it("returns protected course data for authenticated users", async () => {
    const listCourses = vi.fn().mockResolvedValue([
      {
        id: 1,
        code: "DEMO101",
        name: "Demo Course",
      },
    ]);

    const app = makeApp({
      listCourses,
    });

    const response = await request(app)
      .get("/api/courses")
      .set("Authorization", "Bearer valid-token");

    expect(listCourses).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      data: {
        courses: [
          {
            id: 1,
            code: "DEMO101",
            name: "Demo Course",
          },
        ],
      },
    });
  });

  it("creates a course for organisers with validated input", async () => {
    const createCourse = vi.fn().mockResolvedValue({
      id: 7,
      code: "NEW101",
      name: "New Course",
    });

    const app = makeApp({
      ...organiserAccess(),
      createCourse,
    });

    const response = await request(app)
      .post("/api/courses")
      .set("Authorization", "Bearer valid-token")
      .send({
        code: "NEW101",
        name: "New Course",
      });

    expect(createCourse).toHaveBeenCalledWith({
      code: "NEW101",
      name: "New Course",
    });

    expect(response.status).toBe(201);

    expect(response.body).toEqual({
      data: {
        course: {
          id: 7,
          code: "NEW101",
          name: "New Course",
        },
      },
    });
  });

  it("rejects invalid course payloads before calling the backend", async () => {
    const createCourse = vi.fn().mockResolvedValue({
      id: 7,
      code: "NEW101",
      name: "New Course",
    });

    const app = makeApp({
      ...organiserAccess(),
      createCourse,
    });

    const response = await request(app)
      .post("/api/courses")
      .set("Authorization", "Bearer valid-token")
      .send({
        code: "",
        name: "",
      });

    expect(createCourse).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates, updates and deletes courses for organisers", async () => {
    const updateCourse = vi.fn().mockResolvedValue({
      id: 3,
      code: "UPD101",
      name: "Updated Course",
    });

    const deleteCourse = vi
      .fn()
      .mockResolvedValue(undefined);

    const app = makeApp({
      ...organiserAccess(),
      deleteCourse,
      updateCourse,
    });

    const invalidId = await request(app)
      .patch("/api/courses/not-a-number")
      .set("Authorization", "Bearer valid-token")
      .send({
        code: "UPD101",
        name: "Updated Course",
      });

    expect(invalidId.status).toBe(400);

    const invalidBody = await request(app)
      .patch("/api/courses/3")
      .set("Authorization", "Bearer valid-token")
      .send({
        code: 123,
        name: null,
      });

    expect(invalidBody.status).toBe(400);

    const updated = await request(app)
      .patch("/api/courses/3")
      .set("Authorization", "Bearer valid-token")
      .send({
        code: " UPD101 ",
        name: " Updated Course ",
      });

    expect(updated.status).toBe(200);

    expect(updateCourse).toHaveBeenCalledWith(3, {
      code: "UPD101",
      name: "Updated Course",
    });

    const invalidDelete = await request(app)
      .delete("/api/courses/0")
      .set("Authorization", "Bearer valid-token");

    expect(invalidDelete.status).toBe(400);

    const deleted = await request(app)
      .delete("/api/courses/3")
      .set("Authorization", "Bearer valid-token");

    expect(deleted.status).toBe(204);
    expect(deleteCourse).toHaveBeenCalledWith(3);
  });

  it("blocks tutor writes when the caller is not an organiser", async () => {
    const updateCourse = vi.fn();

    const app = makeApp({
      updateCourse,
      verifyAccessToken: async () => auth("TUTOR"),
    });

    const response = await request(app)
      .patch("/api/courses/1")
      .set("Authorization", "Bearer valid-token")
      .send({
        code: "CHG101",
        name: "Changed",
      });

    expect(updateCourse).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns organiser tutor listings and accepts tutor updates", async () => {
    const listTutors = vi.fn().mockResolvedValue([
      {
        id: 2,
        auth0Id: "demo|tutor",
        email: "tutor@tutormx.example",
        fullName: "Demo Tutor",
        role: "TUTOR",
        weeklyHours: 10,
      },
    ]);

    const updateTutor = vi.fn().mockResolvedValue({
      id: 2,
      auth0Id: "demo|tutor",
      email: "updated@tutormx.example",
      fullName: "Updated Tutor",
      role: "TUTOR",
      weeklyHours: 12,
    });

    const app = makeApp({
      ...organiserAccess(),
      listTutors,
      updateTutor,
    });

    const listResponse = await request(app)
      .get("/api/tutors")
      .set("Authorization", "Bearer valid-token");

    expect(listTutors).toHaveBeenCalledOnce();
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.tutors).toHaveLength(1);

    const updateResponse = await request(app)
      .patch("/api/tutors/2")
      .set("Authorization", "Bearer valid-token")
      .send({
        email: "updated@tutormx.example",
        weeklyHours: 12,
      });

    expect(updateTutor).toHaveBeenCalledWith(2, {
      email: "updated@tutormx.example",
      weeklyHours: 12,
    });

    expect(updateResponse.status).toBe(200);

    expect(
      updateResponse.body.data.tutor.email,
    ).toBe("updated@tutormx.example");
  });

  it("creates tutors for organisers with validated fields", async () => {
    const createTutor = vi.fn().mockResolvedValue({
      id: 9,
      auth0Id: "auth0|new-tutor",
      email: "new.tutor@tutormx.example",
      fullName: "New Tutor",
      role: "TUTOR",
      weeklyHours: 8,
    });

    const app = makeApp({
      ...organiserAccess(),
      createTutor,
    });

    const response = await request(app)
      .post("/api/tutors")
      .set("Authorization", "Bearer valid-token")
      .send({
        auth0Id: "auth0|new-tutor",
        email: "new.tutor@tutormx.example",
        fullName: "New Tutor",
        weeklyHours: 8,
      });

    expect(createTutor).toHaveBeenCalledWith({
      auth0Id: "auth0|new-tutor",
      email: "new.tutor@tutormx.example",
      fullName: "New Tutor",
      weeklyHours: 8,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.tutor.role).toBe("TUTOR");
  });

  it("rejects invalid tutor email and hour values before persistence", async () => {
    const createTutor = vi.fn();

    const app = makeApp({
      ...organiserAccess(),
      createTutor,
    });

    const response = await request(app)
      .post("/api/tutors")
      .set("Authorization", "Bearer valid-token")
      .send({
        auth0Id: "auth0|new-tutor",
        email: "not-an-email",
        fullName: "New Tutor",
        weeklyHours: 0,
      });

    expect(createTutor).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates tutor identifiers and requires at least one update field", async () => {
    const updateTutor = vi.fn().mockResolvedValue({
      id: 2,
      auth0Id: "demo|tutor",
      email: "tutor@tutormx.example",
      fullName: "Renamed Tutor",
      role: "TUTOR",
      weeklyHours: 10,
    });

    const app = makeApp({
      ...organiserAccess(),
      updateTutor,
    });

    const invalidId = await request(app)
      .patch("/api/tutors/nope")
      .set("Authorization", "Bearer valid-token")
      .send({
        fullName: "Renamed Tutor",
      });

    expect(invalidId.status).toBe(400);

    const emptyUpdate = await request(app)
      .patch("/api/tutors/2")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(emptyUpdate.status).toBe(400);

    const updated = await request(app)
      .patch("/api/tutors/2")
      .set("Authorization", "Bearer valid-token")
      .send({
        fullName: " Renamed Tutor ",
      });

    expect(updated.status).toBe(200);

    expect(updateTutor).toHaveBeenCalledWith(2, {
      fullName: "Renamed Tutor",
    });
  });

  it("maps route errors and hides unexpected dependency details", async () => {
    const conflictApp = makeApp({
      ...organiserAccess(),

      createCourse: async () => {
        throw createRouteError(
          409,
          "COURSE_CODE_CONFLICT",
          "A course with that code already exists.",
        );
      },
    });

    const conflict = await request(conflictApp)
      .post("/api/courses")
      .set("Authorization", "Bearer valid-token")
      .send({
        code: "DUP101",
        name: "Duplicate",
      });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe(
      "COURSE_CODE_CONFLICT",
    );

    const failedReads = makeApp({
      ...organiserAccess(),

      listCourses: async () => {
        throw new Error("private database details");
      },

      listTutors: async () => {
        throw createRouteError(
          503,
          "DATA_UNAVAILABLE",
          "Try again later.",
        );
      },
    });

    const courses = await request(failedReads)
      .get("/api/courses")
      .set("Authorization", "Bearer valid-token");

    expect(courses.status).toBe(500);
    expect(courses.text).not.toContain(
      "private database details",
    );

    const tutors = await request(failedReads)
      .get("/api/tutors")
      .set("Authorization", "Bearer valid-token");

    expect(tutors.status).toBe(503);
    expect(tutors.body.error.code).toBe("DATA_UNAVAILABLE");

    const failedWrites = makeApp({
      ...organiserAccess(),

      createTutor: async () => {
        throw new Error("private persistence details");
      },

      deleteCourse: async () => {
        throw createRouteError(
          404,
          "COURSE_NOT_FOUND",
          "Course not found.",
        );
      },

      updateCourse: async () => {
        throw createRouteError(
          404,
          "COURSE_NOT_FOUND",
          "Course not found.",
        );
      },

      updateTutor: async () => {
        throw createRouteError(
          404,
          "TUTOR_NOT_FOUND",
          "Tutor not found.",
        );
      },
    });

    const createdTutor = await request(failedWrites)
      .post("/api/tutors")
      .set("Authorization", "Bearer valid-token")
      .send({
        auth0Id: "auth0|new-tutor",
        email: "new.tutor@tutormx.example",
        fullName: "New Tutor",
      });

    expect(createdTutor.status).toBe(500);

    expect(createdTutor.text).not.toContain(
      "private persistence details",
    );

    const updatedCourse = await request(failedWrites)
      .patch("/api/courses/1")
      .set("Authorization", "Bearer valid-token")
      .send({
        code: "ERR101",
        name: "Missing",
      });

    expect(updatedCourse.status).toBe(404);

    const deletedCourse = await request(failedWrites)
      .delete("/api/courses/1")
      .set("Authorization", "Bearer valid-token");

    expect(deletedCourse.status).toBe(404);

    const updatedTutor = await request(failedWrites)
      .patch("/api/tutors/1")
      .set("Authorization", "Bearer valid-token")
      .send({
        fullName: "Missing Tutor",
      });

    expect(updatedTutor.status).toBe(404);
  });
});

describe("password reset contract", () => {
  it("returns the same non-enumerating success message after a valid request", async () => {
    const requestPasswordReset = vi
      .fn()
      .mockResolvedValue(undefined);

    const app = makeApp({
      requestPasswordReset,
    });

    const response = await request(app)
      .post("/api/auth/password-reset")
      .send({
        email: "known@tutormx.example",
      });

    expect(requestPasswordReset).toHaveBeenCalledWith(
      "known@tutormx.example",
    );

    expect(response.status).toBe(202);

    expect(response.body.data.message).toMatch(
      /if the account can be reset/i,
    );
  });

  it("rejects invalid email input without calling Auth0", async () => {
    const requestPasswordReset = vi
      .fn()
      .mockResolvedValue(undefined);

    const app = makeApp({
      requestPasswordReset,
    });

    const response = await request(app)
      .post("/api/auth/password-reset")
      .send({
        email: "not-an-email",
      });

    expect(response.status).toBe(400);
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("returns a safe unavailable response when Auth0 cannot accept the request", async () => {
    const app = makeApp({
      requestPasswordReset: async () => {
        throw new Error("tenant response details");
      },
    });

    const response = await request(app)
      .post("/api/auth/password-reset")
      .send({
        email: "known@tutormx.example",
      });

    expect(response.status).toBe(503);

    expect(response.body.error.code).toBe(
      "PASSWORD_RESET_UNAVAILABLE",
    );

    expect(response.text).not.toContain(
      "tenant response details",
    );
  });
});

describe("shared HTTP behavior", () => {
  it("permits configured frontend CORS preflight requests", async () => {
    const app = makeApp({
      corsOrigin: "http://localhost:5173",
    });

    const response = await request(app)
      .options("/api/me")
      .set("Origin", "http://localhost:5173");

    expect(response.status).toBe(204);

    expect(
      response.headers["access-control-allow-origin"],
    ).toBe("http://localhost:5173");

    expect(
      response.headers["access-control-allow-headers"],
    ).toContain("Authorization");

    expect(
      response.headers["access-control-allow-methods"],
    ).toContain("PATCH");
  });

  it("does not grant CORS to an unconfigured origin", async () => {
    const app = makeApp({
      corsOrigin: "http://localhost:5173",
    });

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://untrusted.example");

    expect(response.status).toBe(200);

    expect(
      response.headers["access-control-allow-origin"],
    ).toBeUndefined();
  });

  it("returns the shared JSON format for an unknown route", async () => {
    const response = await request(
      makeApp(),
    ).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});

describe("allocation candidate route", () => {
  const candidateQuery =
    "courseId=3&startsAt=2030-09-04T14:00:00.000Z&endsAt=2030-09-04T16:00:00.000Z&minimumMark=50&requestedHours=2";

  it("requires an Organiser token", async () => {
    const listAllocationCandidates = vi.fn();
    const withoutToken = await request(
      makeApp({ listAllocationCandidates }),
    ).get(`/api/allocations/candidates?${candidateQuery}`);
    expect(withoutToken.status).toBe(401);
    expect(listAllocationCandidates).not.toHaveBeenCalled();

    const wrongRole = await request(
      makeApp({
        listAllocationCandidates,
        verifyAccessToken: async () => auth("TUTOR"),
      }),
    )
      .get(`/api/allocations/candidates?${candidateQuery}`)
      .set("Authorization", "Bearer valid-token");
    expect(wrongRole.status).toBe(403);
    expect(listAllocationCandidates).not.toHaveBeenCalled();
  });

  it("validates the candidate query and returns ranked candidates", async () => {
    const candidates = [
      {
        tutorId: 1,
        fullName: "Eligible Tutor",
        mark: 80,
        weeklyLimit: 8,
        usedHours: 2,
        remainingHours: 6,
        hasClash: false,
        isEligible: true,
        reasonCodes: [],
      },
    ];
    const listAllocationCandidates = vi.fn().mockResolvedValue(candidates);
    const app = makeApp({ ...organiserAccess(), listAllocationCandidates });

    const invalid = await request(app)
      .get(
        "/api/allocations/candidates?courseId=3&minimumMark=150&requestedHours=2",
      )
      .set("Authorization", "Bearer valid-token");
    expect(invalid.status).toBe(400);
    expect(listAllocationCandidates).not.toHaveBeenCalled();

    const inverted = await request(app)
      .get(
        "/api/allocations/candidates?courseId=3&startsAt=2030-09-04T16:00:00.000Z&endsAt=2030-09-04T14:00:00.000Z&minimumMark=50&requestedHours=2",
      )
      .set("Authorization", "Bearer valid-token");
    expect(inverted.status).toBe(400);

    const invalidHours = await request(app)
      .get(
        "/api/allocations/candidates?courseId=3&startsAt=2030-09-04T14:00:00.000Z&endsAt=2030-09-04T16:00:00.000Z&minimumMark=50&requestedHours=25",
      )
      .set("Authorization", "Bearer valid-token");
    expect(invalidHours.status).toBe(400);

    const ok = await request(app)
      .get(`/api/allocations/candidates?${candidateQuery}`)
      .set("Authorization", "Bearer valid-token");
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ data: { candidates } });
    expect(listAllocationCandidates).toHaveBeenCalledWith({
      courseId: 3,
      startsAt: new Date("2030-09-04T14:00:00.000Z"),
      endsAt: new Date("2030-09-04T16:00:00.000Z"),
      minimumMark: 50,
      requestedHours: 2,
    });
  });

  it("returns a safe error when the candidate service rejects", async () => {
    const response = await request(
      makeApp({
        ...organiserAccess(),
        listAllocationCandidates: async () => {
          throw createRouteError(404, "COURSE_NOT_FOUND", "Course not found.");
        },
      }),
    )
      .get(`/api/allocations/candidates?${candidateQuery}`)
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("COURSE_NOT_FOUND");
  });
});

describe("organiser tutor mark routes", () => {
  it("requires an Organiser token to set marks", async () => {
    const upsertTutorMark = vi.fn();
    const withoutToken = await request(makeApp({ upsertTutorMark }))
      .put("/api/tutors/7/marks")
      .send({ courseId: 3, mark: 75 });
    expect(withoutToken.status).toBe(401);
    expect(upsertTutorMark).not.toHaveBeenCalled();
  });

  it("validates and upserts a tutor mark", async () => {
    const mark = {
      id: 11,
      courseId: 3,
      courseCode: "DEMO101",
      courseName: "Demo Course",
      mark: 75,
    };
    const upsertTutorMark = vi.fn().mockResolvedValue(mark);
    const app = makeApp({ ...organiserAccess(), upsertTutorMark });

    const invalid = await request(app)
      .put("/api/tutors/7/marks")
      .set("Authorization", "Bearer valid-token")
      .send({ courseId: 3, mark: 150 });
    expect(invalid.status).toBe(400);
    expect(upsertTutorMark).not.toHaveBeenCalled();

    for (const missingValue of [null, true, " "]) {
      const missingMark = await request(app)
        .put("/api/tutors/7/marks")
        .set("Authorization", "Bearer valid-token")
        .send({ courseId: 3, mark: missingValue });
      expect(missingMark.status).toBe(400);
      expect(upsertTutorMark).not.toHaveBeenCalled();
    }

    const invalidId = await request(app)
      .put("/api/tutors/not-a-number/marks")
      .set("Authorization", "Bearer valid-token")
      .send({ courseId: 3, mark: 75 });
    expect(invalidId.status).toBe(400);

    const created = await request(app)
      .put("/api/tutors/7/marks")
      .set("Authorization", "Bearer valid-token")
      .send({ courseId: 3, mark: 75 });
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ data: { mark } });
    expect(upsertTutorMark).toHaveBeenCalledWith(7, {
      courseId: 3,
      mark: 75,
    });
  });

  it("lists a tutor's marks", async () => {
    const marks = [
      {
        id: 11,
        courseId: 3,
        courseCode: "DEMO101",
        courseName: "Demo Course",
        mark: 75,
      },
    ];
    const listTutorMarks = vi.fn().mockResolvedValue(marks);
    const response = await request(
      makeApp({ ...organiserAccess(), listTutorMarks }),
    )
      .get("/api/tutors/7/marks")
      .set("Authorization", "Bearer valid-token");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { marks } });
    expect(listTutorMarks).toHaveBeenCalledWith(7);
  });

  it("validates mark-list tutor IDs and maps mark service errors", async () => {
    const listTutorMarks = vi.fn().mockRejectedValue(
      createRouteError(404, "TUTOR_NOT_FOUND", "Tutor not found."),
    );
    const app = makeApp({ ...organiserAccess(), listTutorMarks });

    const invalid = await request(app)
      .get("/api/tutors/invalid/marks")
      .set("Authorization", "Bearer valid-token");
    expect(invalid.status).toBe(400);
    expect(listTutorMarks).not.toHaveBeenCalled();

    const missing = await request(app)
      .get("/api/tutors/7/marks")
      .set("Authorization", "Bearer valid-token");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("TUTOR_NOT_FOUND");
  });

  it("maps tutor-mark write service errors", async () => {
    const response = await request(
      makeApp({
        ...organiserAccess(),
        upsertTutorMark: async () => {
          throw createRouteError(404, "COURSE_NOT_FOUND", "Course not found.");
        },
      }),
    )
      .put("/api/tutors/7/marks")
      .set("Authorization", "Bearer valid-token")
      .send({ courseId: 3, mark: 75 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("COURSE_NOT_FOUND");
  });
});

describe("organiser tutor availability routes", () => {
  it("requires an Organiser token to manage availability", async () => {
    const createTutorTimeSlotForTutor = vi.fn();
    const withoutToken = await request(
      makeApp({ createTutorTimeSlotForTutor }),
    )
      .post("/api/tutors/7/time-slots")
      .send({
        type: "BUSY",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
      });
    expect(withoutToken.status).toBe(401);
    expect(createTutorTimeSlotForTutor).not.toHaveBeenCalled();
  });

  it("validates and creates a busy slot for a specific tutor", async () => {
    const timeSlot = {
      id: 9,
      type: "BUSY",
      startsAt: "2030-09-04T14:00:00.000Z",
      endsAt: "2030-09-04T16:00:00.000Z",
      recurrence: null,
    };
    const createTutorTimeSlotForTutor = vi.fn().mockResolvedValue(timeSlot);
    const app = makeApp({
      ...organiserAccess(),
      createTutorTimeSlotForTutor,
    });

    const invalid = await request(app)
      .post("/api/tutors/7/time-slots")
      .set("Authorization", "Bearer valid-token")
      .send({
        type: "BUSY",
        startsAt: "2030-09-04T16:00:00.000Z",
        endsAt: "2030-09-04T14:00:00.000Z",
      });
    expect(invalid.status).toBe(400);
    expect(createTutorTimeSlotForTutor).not.toHaveBeenCalled();

    const invalidId = await request(app)
      .post("/api/tutors/not-a-number/time-slots")
      .set("Authorization", "Bearer valid-token")
      .send({
        type: "BUSY",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
      });
    expect(invalidId.status).toBe(400);

    const created = await request(app)
      .post("/api/tutors/7/time-slots")
      .set("Authorization", "Bearer valid-token")
      .send({
        type: "BUSY",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
      });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ data: { timeSlot } });
    expect(createTutorTimeSlotForTutor).toHaveBeenCalledWith(7, {
      type: "BUSY",
      startsAt: new Date("2030-09-04T14:00:00.000Z"),
      endsAt: new Date("2030-09-04T16:00:00.000Z"),
    });
  });

  it("lists a tutor's availability", async () => {
    const timeSlots = [
      {
        id: 8,
        type: "BUSY",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
        recurrence: "WEEKLY",
      },
    ];
    const listTutorTimeSlots = vi.fn().mockResolvedValue(timeSlots);
    const response = await request(
      makeApp({ ...organiserAccess(), listTutorTimeSlots }),
    )
      .get("/api/tutors/7/time-slots")
      .set("Authorization", "Bearer valid-token");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { timeSlots } });
    expect(listTutorTimeSlots).toHaveBeenCalledWith(7);
  });

  it("validates time-slot list IDs and maps time-slot service errors", async () => {
    const listTutorTimeSlots = vi.fn().mockRejectedValue(
      createRouteError(404, "TUTOR_NOT_FOUND", "Tutor not found."),
    );
    const app = makeApp({ ...organiserAccess(), listTutorTimeSlots });

    const invalid = await request(app)
      .get("/api/tutors/invalid/time-slots")
      .set("Authorization", "Bearer valid-token");
    expect(invalid.status).toBe(400);
    expect(listTutorTimeSlots).not.toHaveBeenCalled();

    const missing = await request(app)
      .get("/api/tutors/7/time-slots")
      .set("Authorization", "Bearer valid-token");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("TUTOR_NOT_FOUND");
  });

  it("maps tutor time-slot write service errors", async () => {
    const response = await request(
      makeApp({
        ...organiserAccess(),
        createTutorTimeSlotForTutor: async () => {
          throw createRouteError(409, "TIME_SLOT_CONFLICT", "Time slot conflict.");
        },
      }),
    )
      .post("/api/tutors/7/time-slots")
      .set("Authorization", "Bearer valid-token")
      .send({
        type: "BUSY",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("TIME_SLOT_CONFLICT");
  });
});

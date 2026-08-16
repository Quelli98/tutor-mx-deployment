import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  createRouteError,
  type AppDependencies,
} from "./app.js";
import type { AuthContext, TutorRole } from "./auth/contract.js";

function auth(role: TutorRole | null = "TUTOR"): AuthContext {
  return {
    subject: "auth0|current-tutor",
    role,
    claims: { sub: "auth0|current-tutor" },
  };
}

function makeApp(overrides: Partial<AppDependencies> = {}) {
  const dependencies: AppDependencies = {
    findProfileByAuth0Id: async () => ({
      id: 7,
      email: "tutor@tutormx.example",
      fullName: "Current Tutor",
      role: "TUTOR",
    }),
    listCourses: async () => [],
    createCourse: async (input) => ({ id: 1, ...input }),
    updateCourse: async (id, input) => ({ id, ...input }),
    deleteCourse: async () => undefined,
    listTutors: async () => [],
    createTutor: async (input) => ({
      id: 1,
      role: "TUTOR",
      weeklyHours: input.weeklyHours ?? null,
      ...input,
    }),
    updateTutor: async (id, input) => ({
      id,
      auth0Id: "auth0|tutor",
      email: input.email ?? "tutor@tutormx.example",
      fullName: input.fullName ?? "Tutor",
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
    requestPasswordReset: async () => undefined,
    verifyAccessToken: async () => auth(),
    ...overrides,
  };

  return createApp(async () => undefined, dependencies);
}

describe("own-tutor dashboard route", () => {
  it("requires a valid Tutor token", async () => {
    const getTutorDashboard = vi.fn();
    const withoutToken = await request(makeApp({ getTutorDashboard })).get(
      "/api/tutor/dashboard",
    );

    expect(withoutToken.status).toBe(401);
    expect(getTutorDashboard).not.toHaveBeenCalled();

    const wrongRole = await request(
      makeApp({
        getTutorDashboard,
        verifyAccessToken: async () => auth("STUDENT"),
      }),
    )
      .get("/api/tutor/dashboard")
      .set("Authorization", "Bearer valid-token");

    expect(wrongRole.status).toBe(403);
    expect(getTutorDashboard).not.toHaveBeenCalled();
  });

  it("derives ownership from the token subject and returns the dashboard", async () => {
    const dashboard = {
      allocations: [
        {
          id: 4,
          courseCode: "DEMO101",
          courseName: "Demo Course",
          startsAt: "2030-09-04T14:00:00.000Z",
          endsAt: "2030-09-04T16:00:00.000Z",
          allocatedHours: 2,
          status: "CONFIRMED" as const,
        },
      ],
      weeklyLimit: 10,
      usedHours: 6,
      remainingHours: 4,
    };
    const getTutorDashboard = vi.fn().mockResolvedValue(dashboard);

    const response = await request(makeApp({ getTutorDashboard }))
      .get("/api/tutor/dashboard")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { dashboard } });
    expect(getTutorDashboard).toHaveBeenCalledWith("auth0|current-tutor");
  });

  it("does not expose a tutor-id dashboard URL", async () => {
    const getTutorDashboard = vi.fn();
    const response = await request(makeApp({ getTutorDashboard }))
      .get("/api/tutor/dashboard/999")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(404);
    expect(getTutorDashboard).not.toHaveBeenCalled();
  });
});

describe("own-tutor form routes", () => {
  it("validates and creates availability without accepting a tutor id", async () => {
    const createTutorTimeSlot = vi.fn().mockResolvedValue({
      id: 8,
      type: "BUSY",
      startsAt: "2030-09-04T14:00:00.000Z",
      endsAt: "2030-09-04T16:00:00.000Z",
      recurrence: "WEEKLY",
    });
    const app = makeApp({ createTutorTimeSlot });

    const invalid = await request(app)
      .post("/api/tutor/time-slots")
      .set("Authorization", "Bearer valid-token")
      .send({
        type: "BUSY",
        startsAt: "2030-09-04T16:00:00.000Z",
        endsAt: "2030-09-04T14:00:00.000Z",
        recurrence: "DAILY",
      });
    expect(invalid.status).toBe(400);
    expect(createTutorTimeSlot).not.toHaveBeenCalled();

    const created = await request(app)
      .post("/api/tutor/time-slots")
      .set("Authorization", "Bearer valid-token")
      .send({
        type: "BUSY",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
        recurrence: "weekly",
        tutorId: 999,
      });

    expect(created.status).toBe(201);
    expect(createTutorTimeSlot).toHaveBeenCalledWith(
      "auth0|current-tutor",
      {
        type: "BUSY",
        startsAt: new Date("2030-09-04T14:00:00.000Z"),
        endsAt: new Date("2030-09-04T16:00:00.000Z"),
        recurrence: "WEEKLY",
      },
    );
  });

  it("rejects invalid work logs and creates a valid draft entry", async () => {
    const createTutorWorkLog = vi.fn().mockResolvedValue({
      id: 9,
      allocationId: 4,
      timesheetId: 3,
      workDate: "2030-09-04",
      hours: 2,
      description: "Tutorial session",
    });
    const app = makeApp({ createTutorWorkLog });

    const invalid = await request(app)
      .post("/api/tutor/work-logs")
      .set("Authorization", "Bearer valid-token")
      .send({ allocationId: 4, workDate: "2030-02-30", hours: -1 });
    expect(invalid.status).toBe(400);
    expect(createTutorWorkLog).not.toHaveBeenCalled();

    const created = await request(app)
      .post("/api/tutor/work-logs")
      .set("Authorization", "Bearer valid-token")
      .send({
        allocationId: 4,
        workDate: "2030-09-04",
        hours: 2,
        description: " Tutorial session ",
        tutorId: 999,
      });

    expect(created.status).toBe(201);
    expect(createTutorWorkLog).toHaveBeenCalledWith(
      "auth0|current-tutor",
      {
        allocationId: 4,
        workDate: "2030-09-04",
        hours: 2,
        description: "Tutorial session",
      },
    );
  });

  it("validates excuses and preserves safe conflict errors", async () => {
    const createTutorExcuse = vi.fn();
    const app = makeApp({ createTutorExcuse });

    const invalid = await request(app)
      .post("/api/tutor/excuses")
      .set("Authorization", "Bearer valid-token")
      .send({ allocationId: 4, reason: " " });
    expect(invalid.status).toBe(400);
    expect(createTutorExcuse).not.toHaveBeenCalled();

    createTutorExcuse.mockRejectedValueOnce(
      createRouteError(
        409,
        "EXCUSE_DUPLICATE",
        "An excuse has already been submitted for this session.",
      ),
    );
    const conflict = await request(app)
      .post("/api/tutor/excuses")
      .set("Authorization", "Bearer valid-token")
      .send({ allocationId: 4, reason: "Sick" });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("EXCUSE_DUPLICATE");
    expect(createTutorExcuse).toHaveBeenCalledWith(
      "auth0|current-tutor",
      { allocationId: 4, reason: "Sick" },
    );
  });

  it("fails closed with a safe error when persistence is unavailable", async () => {
    const response = await request(
      makeApp({
        createTutorExcuse: async () => {
          throw new Error("private database details");
        },
      }),
    )
      .post("/api/tutor/excuses")
      .set("Authorization", "Bearer valid-token")
      .send({ allocationId: 4, reason: "Sick" });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.text).not.toContain("private database details");
  });
});

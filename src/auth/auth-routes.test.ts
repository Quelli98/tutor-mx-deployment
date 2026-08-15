import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  createRouteError,
  type CourseSummary,
  type ProfileSummary,
  type TutorSummary,
} from "../app.js";
import type { AuthContext, TutorRole } from "./contract.js";

const profile: ProfileSummary = {
  id: 7,
  email: "tutor@tutormx.example",
  fullName: "Demo Tutor",
  role: "TUTOR",
};

function auth(role: TutorRole | null = "TUTOR"): AuthContext {
  return {
    subject: "auth0|tutor",
    role,
    claims: { sub: "auth0|tutor" },
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
    verifyAccessToken: (token: string) => Promise<AuthContext>;
  }> = {},
) {
  return createApp(async () => undefined, {
    ...(overrides.corsOrigin ? { corsOrigin: overrides.corsOrigin } : {}),
    createCourse:
      overrides.createCourse ?? (async (input) => ({ id: 11, ...input })),
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
    listCourses:
      overrides.listCourses ??
      (async () => [{ id: 1, code: "DEMO101", name: "Demo Course" }]),
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
      (async (courseId, input) => ({ id: courseId, ...input })),
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
    verifyAccessToken: overrides.verifyAccessToken ?? (async () => auth()),
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

  it("returns 403 when a valid token has no permitted Tutor Mx role", async () => {
    const app = makeApp({ verifyAccessToken: async () => auth(null) });

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("lets a valid token and matching role reach the profile handler", async () => {
    const findProfileByAuth0Id = vi.fn().mockResolvedValue(profile);
    const app = makeApp({ findProfileByAuth0Id });

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(findProfileByAuth0Id).toHaveBeenCalledWith("auth0|tutor");
    expect(response.body).toEqual({ data: { profile } });
  });

  it("exposes the current-user profile contract on the alias route", async () => {
    const findProfileByAuth0Id = vi.fn().mockResolvedValue(profile);
    const app = makeApp({ findProfileByAuth0Id });

    const response = await request(app)
      .get("/api/profile/current")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { profile } });
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
    const app = makeApp({ findProfileByAuth0Id: async () => null });

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
    expect(response.text).not.toContain("database connection details");
  });

  it("keeps account deletion as an authenticated Sprint 1 stub", async () => {
    const response = await request(makeApp())
      .delete("/api/auth/delete-account")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(202);
    expect(response.body.data.status).toBe("pending");
  });
});

describe("course and tutor endpoints", () => {
  it("requires a bearer token before returning course data", async () => {
    const listCourses = vi.fn();
    const response = await request(makeApp({ listCourses })).get(
      "/api/courses",
    );

    expect(listCourses).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("returns protected course data for authenticated users", async () => {
    const listCourses = vi
      .fn()
      .mockResolvedValue([{ id: 1, code: "DEMO101", name: "Demo Course" }]);
    const app = makeApp({ listCourses });

    const response = await request(app)
      .get("/api/courses")
      .set("Authorization", "Bearer valid-token");

    expect(listCourses).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        courses: [{ id: 1, code: "DEMO101", name: "Demo Course" }],
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
      createCourse,
      verifyAccessToken: async () => auth("ORGANISER"),
    });

    const response = await request(app)
      .post("/api/courses")
      .set("Authorization", "Bearer valid-token")
      .send({ code: "NEW101", name: "New Course" });

    expect(createCourse).toHaveBeenCalledWith({
      code: "NEW101",
      name: "New Course",
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      data: {
        course: { id: 7, code: "NEW101", name: "New Course" },
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
      createCourse,
      verifyAccessToken: async () => auth("ORGANISER"),
    });

    const response = await request(app)
      .post("/api/courses")
      .set("Authorization", "Bearer valid-token")
      .send({ code: "", name: "" });

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
    const deleteCourse = vi.fn().mockResolvedValue(undefined);
    const app = makeApp({
      deleteCourse,
      updateCourse,
      verifyAccessToken: async () => auth("ORGANISER"),
    });

    const invalidId = await request(app)
      .patch("/api/courses/not-a-number")
      .set("Authorization", "Bearer valid-token")
      .send({ code: "UPD101", name: "Updated Course" });
    expect(invalidId.status).toBe(400);

    const invalidBody = await request(app)
      .patch("/api/courses/3")
      .set("Authorization", "Bearer valid-token")
      .send({ code: 123, name: null });
    expect(invalidBody.status).toBe(400);

    const updated = await request(app)
      .patch("/api/courses/3")
      .set("Authorization", "Bearer valid-token")
      .send({ code: " UPD101 ", name: " Updated Course " });
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
      .send({ code: "CHG101", name: "Changed" });

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
      listTutors,
      updateTutor,
      verifyAccessToken: async () => auth("ORGANISER"),
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
      .send({ email: "updated@tutormx.example", weeklyHours: 12 });

    expect(updateTutor).toHaveBeenCalledWith(2, {
      email: "updated@tutormx.example",
      weeklyHours: 12,
    });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.tutor.email).toBe(
      "updated@tutormx.example",
    );
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
      createTutor,
      verifyAccessToken: async () => auth("ORGANISER"),
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
      createTutor,
      verifyAccessToken: async () => auth("ORGANISER"),
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
      updateTutor,
      verifyAccessToken: async () => auth("ORGANISER"),
    });

    const invalidId = await request(app)
      .patch("/api/tutors/nope")
      .set("Authorization", "Bearer valid-token")
      .send({ fullName: "Renamed Tutor" });
    expect(invalidId.status).toBe(400);

    const emptyUpdate = await request(app)
      .patch("/api/tutors/2")
      .set("Authorization", "Bearer valid-token")
      .send({});
    expect(emptyUpdate.status).toBe(400);

    const updated = await request(app)
      .patch("/api/tutors/2")
      .set("Authorization", "Bearer valid-token")
      .send({ fullName: " Renamed Tutor " });
    expect(updated.status).toBe(200);
    expect(updateTutor).toHaveBeenCalledWith(2, {
      fullName: "Renamed Tutor",
    });
  });

  it("maps route errors and hides unexpected dependency details", async () => {
    const organiser = async () => auth("ORGANISER");
    const conflictApp = makeApp({
      createCourse: async () => {
        throw createRouteError(
          409,
          "COURSE_CODE_CONFLICT",
          "A course with that code already exists.",
        );
      },
      verifyAccessToken: organiser,
    });
    const conflict = await request(conflictApp)
      .post("/api/courses")
      .set("Authorization", "Bearer valid-token")
      .send({ code: "DUP101", name: "Duplicate" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("COURSE_CODE_CONFLICT");

    const failedReads = makeApp({
      listCourses: async () => {
        throw new Error("private database details");
      },
      listTutors: async () => {
        throw createRouteError(503, "DATA_UNAVAILABLE", "Try again later.");
      },
      verifyAccessToken: organiser,
    });
    const courses = await request(failedReads)
      .get("/api/courses")
      .set("Authorization", "Bearer valid-token");
    expect(courses.status).toBe(500);
    expect(courses.text).not.toContain("private database details");

    const tutors = await request(failedReads)
      .get("/api/tutors")
      .set("Authorization", "Bearer valid-token");
    expect(tutors.status).toBe(503);
    expect(tutors.body.error.code).toBe("DATA_UNAVAILABLE");

    const failedWrites = makeApp({
      createTutor: async () => {
        throw new Error("private persistence details");
      },
      deleteCourse: async () => {
        throw createRouteError(404, "COURSE_NOT_FOUND", "Course not found.");
      },
      updateCourse: async () => {
        throw createRouteError(404, "COURSE_NOT_FOUND", "Course not found.");
      },
      updateTutor: async () => {
        throw createRouteError(404, "TUTOR_NOT_FOUND", "Tutor not found.");
      },
      verifyAccessToken: organiser,
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
    expect(createdTutor.text).not.toContain("private persistence details");

    const updatedCourse = await request(failedWrites)
      .patch("/api/courses/1")
      .set("Authorization", "Bearer valid-token")
      .send({ code: "ERR101", name: "Missing" });
    expect(updatedCourse.status).toBe(404);

    const deletedCourse = await request(failedWrites)
      .delete("/api/courses/1")
      .set("Authorization", "Bearer valid-token");
    expect(deletedCourse.status).toBe(404);

    const updatedTutor = await request(failedWrites)
      .patch("/api/tutors/1")
      .set("Authorization", "Bearer valid-token")
      .send({ fullName: "Missing Tutor" });
    expect(updatedTutor.status).toBe(404);
  });
});

describe("password reset contract", () => {
  it("returns the same non-enumerating success message after a valid request", async () => {
    const requestPasswordReset = vi.fn().mockResolvedValue(undefined);
    const app = makeApp({ requestPasswordReset });

    const response = await request(app)
      .post("/api/auth/password-reset")
      .send({ email: "known@tutormx.example" });

    expect(requestPasswordReset).toHaveBeenCalledWith("known@tutormx.example");
    expect(response.status).toBe(202);
    expect(response.body.data.message).toMatch(/if the account can be reset/i);
  });

  it("rejects invalid email input without calling Auth0", async () => {
    const requestPasswordReset = vi.fn().mockResolvedValue(undefined);
    const app = makeApp({ requestPasswordReset });

    const response = await request(app)
      .post("/api/auth/password-reset")
      .send({ email: "not-an-email" });

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
      .send({ email: "known@tutormx.example" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("PASSWORD_RESET_UNAVAILABLE");
    expect(response.text).not.toContain("tenant response details");
  });
});

describe("shared HTTP behavior", () => {
  it("permits configured frontend CORS preflight requests", async () => {
    const app = makeApp({ corsOrigin: "http://localhost:5173" });

    const response = await request(app)
      .options("/api/me")
      .set("Origin", "http://localhost:5173");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(response.headers["access-control-allow-headers"]).toContain(
      "Authorization",
    );
    expect(response.headers["access-control-allow-methods"]).toContain(
      "PATCH",
    );
  });

  it("does not grant CORS to an unconfigured origin", async () => {
    const app = makeApp({ corsOrigin: "http://localhost:5173" });

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://untrusted.example");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns the shared JSON format for an unknown route", async () => {
    const response = await request(makeApp()).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});

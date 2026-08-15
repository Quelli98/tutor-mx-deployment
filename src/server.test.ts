import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDependencies, RequestLogger } from "./app.js";

const mocks = vi.hoisted(() => ({
  courseCreate: vi.fn(),
  courseDelete: vi.fn(),
  courseFindMany: vi.fn(),
  courseUpdate: vi.fn(),
  createApp: vi.fn(),
  listen: vi.fn(),
  profileCreate: vi.fn(),
  profileFindMany: vi.fn(),
  profileFindUnique: vi.fn(),
  profileUpdate: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("dotenv/config", () => ({}));

vi.mock("./app.js", () => ({
  createApp: mocks.createApp,
  createRouteError(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, code });
  },
}));

vi.mock("./database.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    course: {
      create: mocks.courseCreate,
      delete: mocks.courseDelete,
      findMany: mocks.courseFindMany,
      update: mocks.courseUpdate,
    },
    profile: {
      create: mocks.profileCreate,
      findMany: mocks.profileFindMany,
      findUnique: mocks.profileFindUnique,
      update: mocks.profileUpdate,
    },
  },
}));

const originalEnvironment = {
  AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE,
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,
  AUTH0_DB_CONNECTION: process.env.AUTH0_DB_CONNECTION,
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  PORT: process.env.PORT,
};

function restoreEnvironment() {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function capturedDependencies(): AppDependencies {
  return mocks.createApp.mock.calls[0]![1] as AppDependencies;
}

function capturedRequestLogger(): RequestLogger {
  return mocks.createApp.mock.calls[0]![2] as RequestLogger;
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }

  mocks.createApp.mockReturnValue({
    listen: mocks.listen,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnvironment();
});

describe("server startup", () => {
  it("uses the default port and connects the Prisma readiness check", async () => {
    delete process.env.PORT;
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await import("./server.js");

    expect(mocks.createApp).toHaveBeenCalledOnce();

    const checkReadiness = mocks.createApp.mock.calls[0][0] as () => Promise<void>;
    await checkReadiness();

    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.listen).toHaveBeenCalledWith(3000, expect.any(Function));

    const onListening = mocks.listen.mock.calls[0][1] as () => void;
    onListening();

    expect(consoleLog).toHaveBeenCalledWith(
      "Tutor Mx API listening on http://localhost:3000",
    );
  });

  it("uses the configured PORT", async () => {
    process.env.PORT = "4100";
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await import("./server.js");

    expect(mocks.listen).toHaveBeenCalledWith(4100, expect.any(Function));

    const onListening = mocks.listen.mock.calls[0][1] as () => void;
    onListening();

    expect(consoleLog).toHaveBeenCalledWith(
      "Tutor Mx API listening on http://localhost:4100",
    );
  });

  it("passes configured Auth0, CORS and safe request logging dependencies", async () => {
    process.env.AUTH0_DOMAIN = "tenant.example.auth0.com";
    process.env.AUTH0_AUDIENCE = "https://api.tutormx.example";
    process.env.AUTH0_CLIENT_ID = "public-spa-client-id";
    process.env.AUTH0_DB_CONNECTION = "Username-Password-Authentication";
    process.env.FRONTEND_ORIGIN = "https://app.tutormx.example";
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    await import("./server.js");

    expect(capturedDependencies().corsOrigin).toBe(
      "https://app.tutormx.example",
    );
    expect(capturedDependencies().verifyAccessToken).toBeTypeOf("function");
    expect(capturedDependencies().requestPasswordReset).toBeTypeOf("function");

    capturedRequestLogger()({
      method: "PATCH",
      path: "/api/courses/1",
      status: 200,
      durationMs: 1.25,
    });
    expect(consoleInfo).toHaveBeenCalledWith(
      JSON.stringify({
        event: "http_request",
        method: "PATCH",
        path: "/api/courses/1",
        status: 200,
        durationMs: 1.25,
      }),
    );
  });
});

describe("server-side API persistence", () => {
  it("maps profile, course and tutor reads to safe summaries", async () => {
    await import("./server.js");
    const dependencies = capturedDependencies();

    mocks.profileFindUnique.mockResolvedValueOnce({
      id: 1,
      email: "organiser@tutormx.example",
      fullName: "Demo Organiser",
      role: "ORGANISER",
    });
    await expect(
      dependencies.findProfileByAuth0Id("demo|organiser"),
    ).resolves.toEqual({
      id: 1,
      email: "organiser@tutormx.example",
      fullName: "Demo Organiser",
      role: "ORGANISER",
    });
    expect(mocks.profileFindUnique).toHaveBeenCalledWith({
      where: { auth0Id: "demo|organiser" },
      select: { id: true, email: true, fullName: true, role: true },
    });

    mocks.profileFindUnique.mockResolvedValueOnce({
      id: 2,
      email: "unknown@tutormx.example",
      fullName: "Unknown Role",
      role: "OTHER",
    });
    await expect(
      dependencies.findProfileByAuth0Id("demo|unknown"),
    ).resolves.toBeNull();

    mocks.courseFindMany.mockResolvedValueOnce([
      { id: 3, code: "DEMO101", name: "Demo Course", internal: "discard" },
    ]);
    await expect(dependencies.listCourses()).resolves.toEqual([
      { id: 3, code: "DEMO101", name: "Demo Course" },
    ]);

    mocks.profileFindMany.mockResolvedValueOnce([
      {
        id: 4,
        auth0Id: "demo|tutor",
        email: "tutor@tutormx.example",
        fullName: "Demo Tutor",
        role: "TUTOR",
        hourLimit: { weeklyHours: "12.5" },
      },
      {
        id: 5,
        auth0Id: "demo|tutor-no-limit",
        email: "tutor2@tutormx.example",
        fullName: "Tutor Without Limit",
        role: "TUTOR",
        hourLimit: null,
      },
    ]);
    await expect(dependencies.listTutors()).resolves.toEqual([
      {
        id: 4,
        auth0Id: "demo|tutor",
        email: "tutor@tutormx.example",
        fullName: "Demo Tutor",
        role: "TUTOR",
        weeklyHours: 12.5,
      },
      {
        id: 5,
        auth0Id: "demo|tutor-no-limit",
        email: "tutor2@tutormx.example",
        fullName: "Tutor Without Limit",
        role: "TUTOR",
        weeklyHours: null,
      },
    ]);
  });

  it("creates, updates and deletes courses through Prisma", async () => {
    await import("./server.js");
    const dependencies = capturedDependencies();

    mocks.courseCreate.mockResolvedValueOnce({
      id: 6,
      code: "NEW101",
      name: "New Course",
    });
    await expect(
      dependencies.createCourse({ code: "NEW101", name: "New Course" }),
    ).resolves.toEqual({ id: 6, code: "NEW101", name: "New Course" });

    mocks.courseUpdate.mockResolvedValueOnce({
      id: 6,
      code: "NEW102",
      name: "Updated Course",
    });
    await expect(
      dependencies.updateCourse(6, {
        code: "NEW102",
        name: "Updated Course",
      }),
    ).resolves.toEqual({
      id: 6,
      code: "NEW102",
      name: "Updated Course",
    });

    mocks.courseDelete.mockResolvedValueOnce({ id: 6 });
    await expect(dependencies.deleteCourse(6)).resolves.toBeUndefined();
    expect(mocks.courseDelete).toHaveBeenCalledWith({ where: { id: 6 } });
  });

  it("creates and updates tutor profiles without exposing Prisma records", async () => {
    await import("./server.js");
    const dependencies = capturedDependencies();
    const tutor = {
      id: 7,
      auth0Id: "auth0|new-tutor",
      email: "new.tutor@tutormx.example",
      fullName: "New Tutor",
      role: "TUTOR",
      hourLimit: { weeklyHours: 8 },
    };

    mocks.profileCreate.mockResolvedValueOnce(tutor);
    await expect(
      dependencies.createTutor({
        auth0Id: tutor.auth0Id,
        email: tutor.email,
        fullName: tutor.fullName,
        weeklyHours: 8,
      }),
    ).resolves.toEqual({
      id: 7,
      auth0Id: tutor.auth0Id,
      email: tutor.email,
      fullName: tutor.fullName,
      role: "TUTOR",
      weeklyHours: 8,
    });
    expect(mocks.profileCreate.mock.calls[0]![0].data.hourLimit).toEqual({
      create: { weeklyHours: 8 },
    });

    mocks.profileCreate.mockResolvedValueOnce({
      ...tutor,
      id: 8,
      auth0Id: "auth0|no-limit",
      hourLimit: null,
    });
    await dependencies.createTutor({
      auth0Id: "auth0|no-limit",
      email: "no.limit@tutormx.example",
      fullName: "No Limit Tutor",
    });
    expect(mocks.profileCreate.mock.calls[1]![0].data).not.toHaveProperty(
      "hourLimit",
    );

    mocks.profileFindUnique.mockResolvedValueOnce({ role: "TUTOR" });
    mocks.profileUpdate.mockResolvedValueOnce({
      ...tutor,
      email: "updated@tutormx.example",
      fullName: "Updated Tutor",
      hourLimit: { weeklyHours: 10 },
    });
    await expect(
      dependencies.updateTutor(7, {
        email: "updated@tutormx.example",
        fullName: "Updated Tutor",
        weeklyHours: 10,
      }),
    ).resolves.toMatchObject({
      id: 7,
      email: "updated@tutormx.example",
      fullName: "Updated Tutor",
      weeklyHours: 10,
    });
    expect(mocks.profileUpdate.mock.calls[0]![0].data.hourLimit).toEqual({
      upsert: {
        create: { weeklyHours: 10 },
        update: { weeklyHours: 10 },
      },
    });
  });

  it("maps expected Prisma conflicts to safe route errors", async () => {
    await import("./server.js");
    const dependencies = capturedDependencies();

    mocks.courseCreate.mockRejectedValueOnce({ code: "P2002" });
    await expect(
      dependencies.createCourse({ code: "DUP101", name: "Duplicate" }),
    ).rejects.toMatchObject({ status: 409, code: "COURSE_CODE_CONFLICT" });

    mocks.courseUpdate.mockRejectedValueOnce({ code: "P2025" });
    await expect(
      dependencies.updateCourse(999, { code: "NONE", name: "Missing" }),
    ).rejects.toMatchObject({ status: 404, code: "COURSE_NOT_FOUND" });
    mocks.courseUpdate.mockRejectedValueOnce({ code: "P2002" });
    await expect(
      dependencies.updateCourse(1, { code: "DUP101", name: "Duplicate" }),
    ).rejects.toMatchObject({ status: 409, code: "COURSE_CODE_CONFLICT" });

    mocks.courseDelete.mockRejectedValueOnce({ code: "P2025" });
    await expect(dependencies.deleteCourse(999)).rejects.toMatchObject({
      status: 404,
      code: "COURSE_NOT_FOUND",
    });
    mocks.courseDelete.mockRejectedValueOnce({ code: "P2003" });
    await expect(dependencies.deleteCourse(1)).rejects.toMatchObject({
      status: 409,
      code: "COURSE_CONFLICT",
    });

    mocks.profileCreate.mockRejectedValueOnce({ code: "P2002" });
    await expect(
      dependencies.createTutor({
        auth0Id: "auth0|duplicate",
        email: "duplicate@tutormx.example",
        fullName: "Duplicate Tutor",
      }),
    ).rejects.toMatchObject({ status: 409, code: "TUTOR_CONFLICT" });

    mocks.profileFindUnique.mockResolvedValueOnce({ role: "ORGANISER" });
    await expect(
      dependencies.updateTutor(1, { fullName: "Not a Tutor" }),
    ).rejects.toMatchObject({ status: 404, code: "TUTOR_NOT_FOUND" });

    mocks.profileFindUnique.mockResolvedValueOnce({ role: "TUTOR" });
    mocks.profileUpdate.mockRejectedValueOnce({ code: "P2002" });
    await expect(
      dependencies.updateTutor(7, {
        email: "duplicate@tutormx.example",
      }),
    ).rejects.toMatchObject({ status: 409, code: "TUTOR_CONFLICT" });
  });

  it("does not hide unexpected persistence failures", async () => {
    await import("./server.js");
    const dependencies = capturedDependencies();
    const unexpected = new Error("database unavailable");

    mocks.courseCreate.mockRejectedValueOnce(unexpected);
    await expect(
      dependencies.createCourse({ code: "ERR101", name: "Failure" }),
    ).rejects.toBe(unexpected);

    mocks.courseUpdate.mockRejectedValueOnce(unexpected);
    await expect(
      dependencies.updateCourse(1, { code: "ERR101", name: "Failure" }),
    ).rejects.toBe(unexpected);

    mocks.courseDelete.mockRejectedValueOnce(unexpected);
    await expect(dependencies.deleteCourse(1)).rejects.toBe(unexpected);

    mocks.profileCreate.mockRejectedValueOnce(unexpected);
    await expect(
      dependencies.createTutor({
        auth0Id: "auth0|error",
        email: "error@tutormx.example",
        fullName: "Error Tutor",
      }),
    ).rejects.toBe(unexpected);

    mocks.profileFindUnique.mockResolvedValueOnce({ role: "TUTOR" });
    mocks.profileUpdate.mockRejectedValueOnce(unexpected);
    await expect(
      dependencies.updateTutor(7, { fullName: "Error Tutor" }),
    ).rejects.toBe(unexpected);
  });
});

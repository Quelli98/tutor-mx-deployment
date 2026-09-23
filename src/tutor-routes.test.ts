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
    onboardUser: async (_auth0Id, role) => ({ id: 7, email: "tutor@tutormx.example", fullName: "Current Tutor", role }),
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
    updateTutorTimeSlot: async (_auth0Id, _timeSlotId, input) => ({
      id: 1,
      type: input.type,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      recurrence: input.recurrence ?? null,
      label: input.label ?? null,
      recurrenceUntil: input.recurrenceUntil?.toISOString() ?? null,
    }),
    deleteTutorTimeSlot: async () => undefined,
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

describe("tutor timetable import routes", () => {
  const term = {
    id: 1,
    name: "Demo 2030 Semester 2",
    startsOn: "2030-08-26",
    endsOn: "2030-11-29",
  };

  const previewBody = {
    source: "CSV" as const,
    text: "date,start,end,label\n2030-09-02,09:00,11:00,Maths",
    timeZone: "UTC",
    termId: 1,
  };

  it("requires a Tutor token on both import routes", async () => {
    const previewTutorTimetableImport = vi.fn();
    const commitTutorTimetableImport = vi.fn();

    for (const path of [
      "/api/tutor/time-slots/import/preview",
      "/api/tutor/time-slots/import/commit",
    ]) {
      const withoutToken = await request(
        makeApp({ previewTutorTimetableImport, commitTutorTimetableImport }),
      )
        .post(path)
        .send(previewBody);
      expect(withoutToken.status).toBe(401);

      const wrongRole = await request(
        makeApp({
          previewTutorTimetableImport,
          commitTutorTimetableImport,
          verifyAccessToken: async () => auth("STUDENT"),
        }),
      )
        .post(path)
        .set("Authorization", "Bearer valid-token")
        .send(previewBody);
      expect(wrongRole.status).toBe(403);
    }

    expect(previewTutorTimetableImport).not.toHaveBeenCalled();
    expect(commitTutorTimetableImport).not.toHaveBeenCalled();
  });

  it("rejects a malformed request before reaching the service", async () => {
    const previewTutorTimetableImport = vi.fn();
    const app = makeApp({ previewTutorTimetableImport });

    const badSource = await request(app)
      .post("/api/tutor/time-slots/import/preview")
      .set("Authorization", "Bearer valid-token")
      .send({ ...previewBody, source: "XLSX" });
    expect(badSource.status).toBe(400);
    expect(badSource.body.error.code).toBe("VALIDATION_ERROR");

    const extraField = await request(app)
      .post("/api/tutor/time-slots/import/preview")
      .set("Authorization", "Bearer valid-token")
      .send({ ...previewBody, tutorId: 999 });
    expect(extraField.status).toBe(400);

    const missingTerm = await request(app)
      .post("/api/tutor/time-slots/import/preview")
      .set("Authorization", "Bearer valid-token")
      .send({ source: "CSV", text: previewBody.text, timeZone: "UTC" });
    expect(missingTerm.status).toBe(400);

    expect(previewTutorTimetableImport).not.toHaveBeenCalled();
  });

  it("derives the tutor from the token and returns the preview", async () => {
    const previewTutorTimetableImport = vi.fn().mockResolvedValue({
      source: "CSV",
      timeZone: "UTC",
      term,
      rows: [],
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
    });

    const response = await request(makeApp({ previewTutorTimetableImport }))
      .post("/api/tutor/time-slots/import/preview")
      .set("Authorization", "Bearer valid-token")
      .send(previewBody);

    expect(response.status).toBe(200);
    expect(response.body.data.preview.term).toEqual(term);
    // The subject comes from the token, never from the body.
    expect(previewTutorTimetableImport).toHaveBeenCalledWith(
      "auth0|current-tutor",
      previewBody,
    );
  });

  it("returns the commit result, including the rows it skipped", async () => {
    const commitTutorTimetableImport = vi.fn().mockResolvedValue({
      created: 1,
      createdIds: [7],
      skipped: [{ sourceRow: 3, duplicate: false, errors: ["A date is required."] }],
      invalidCount: 1,
      duplicateCount: 0,
    });

    const response = await request(makeApp({ commitTutorTimetableImport }))
      .post("/api/tutor/time-slots/import/commit")
      .set("Authorization", "Bearer valid-token")
      .send(previewBody);

    expect(response.status).toBe(200);
    expect(response.body.data.result).toEqual({
      created: 1,
      createdIds: [7],
      skipped: [{ sourceRow: 3, duplicate: false, errors: ["A date is required."] }],
      invalidCount: 1,
      duplicateCount: 0,
    });
  });

  it("surfaces an import conflict with its own code", async () => {
    const commitTutorTimetableImport = vi.fn().mockRejectedValue(
      createRouteError(
        409,
        "TIMETABLE_IMPORT_CONFLICT",
        "The timetable could not be saved and nothing was changed.",
      ),
    );

    const response = await request(makeApp({ commitTutorTimetableImport }))
      .post("/api/tutor/time-slots/import/commit")
      .set("Authorization", "Bearer valid-token")
      .send(previewBody);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("TIMETABLE_IMPORT_CONFLICT");
  });

  it("fails closed when the import dependency is not configured", async () => {
    const response = await request(makeApp({ previewTutorTimetableImport: undefined }))
      .post("/api/tutor/time-slots/import/preview")
      .set("Authorization", "Bearer valid-token")
      .send(previewBody);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("TIMETABLE_IMPORT_UNAVAILABLE");
  });
});

describe("academic term routes", () => {
  const term = {
    id: 1,
    name: "Demo 2030 Semester 2",
    startsOn: "2030-08-26",
    endsOn: "2030-11-29",
  };

  /**
   * The stored profile is the authority on the role, so an Organiser request
   * needs both an Organiser token claim and an Organiser profile row.
   */
  const organiserOverrides = {
    findProfileByAuth0Id: async () => ({
      id: 8,
      email: "organiser@tutormx.example",
      fullName: "Demo Organiser",
      role: "ORGANISER" as const,
    }),
    verifyAccessToken: async () => auth("ORGANISER"),
  };

  it("lists terms for any signed-in role", async () => {
    const listAcademicTerms = vi.fn().mockResolvedValue([term]);

    const response = await request(makeApp({ listAcademicTerms }))
      .get("/api/academic-terms")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { academicTerms: [term] } });
  });

  it("requires an Organiser to create a term", async () => {
    const createAcademicTerm = vi.fn();
    const body = { name: "2031 Semester 2", startsOn: "2031-07-21", endsOn: "2031-11-28" };

    const asTutor = await request(makeApp({ createAcademicTerm }))
      .post("/api/organiser/academic-terms")
      .set("Authorization", "Bearer valid-token")
      .send(body);

    expect(asTutor.status).toBe(403);
    expect(createAcademicTerm).not.toHaveBeenCalled();
  });

  it("rejects backwards or malformed term dates before reaching the service", async () => {
    const createAcademicTerm = vi.fn();
    const app = makeApp({ createAcademicTerm, ...organiserOverrides });

    for (const body of [
      { name: "Backwards", startsOn: "2031-11-28", endsOn: "2031-07-21" },
      { name: "Impossible", startsOn: "2031-02-30", endsOn: "2031-06-06" },
      { name: "", startsOn: "2031-02-17", endsOn: "2031-06-06" },
      { name: "No dates" },
    ]) {
      const response = await request(app)
        .post("/api/organiser/academic-terms")
        .set("Authorization", "Bearer valid-token")
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }

    expect(createAcademicTerm).not.toHaveBeenCalled();
  });

  it("creates a term for an Organiser", async () => {
    const createAcademicTerm = vi.fn().mockResolvedValue({ ...term, id: 4 });

    const response = await request(
      makeApp({ createAcademicTerm, ...organiserOverrides }),
    )
      .post("/api/organiser/academic-terms")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Demo 2030 Semester 2", startsOn: "2030-08-26", endsOn: "2030-11-29" });

    expect(response.status).toBe(201);
    expect(response.body.data.academicTerm).toEqual({ ...term, id: 4 });
    expect(createAcademicTerm).toHaveBeenCalledWith({
      name: "Demo 2030 Semester 2",
      startsOn: "2030-08-26",
      endsOn: "2030-11-29",
    });
  });

  it("fails closed when terms are not configured", async () => {
    const response = await request(makeApp({ listAcademicTerms: undefined }))
      .get("/api/academic-terms")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("ACADEMIC_TERMS_UNAVAILABLE");
  });
});


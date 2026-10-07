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

    const invalidTerm = await request(app)
      .post("/api/tutor/time-slots/import/preview")
      .set("Authorization", "Bearer valid-token")
      .send({ source: "CSV", text: previewBody.text, timeZone: "UTC", termId: 0 });
    expect(invalidTerm.status).toBe(400);

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

  it("lists only published terms for tutors", async () => {
    const listAcademicTerms = vi.fn().mockResolvedValue([{ ...term, published: true }, { ...term, id: 99, published: false }]);

    const response = await request(makeApp({ listAcademicTerms }))
      .get("/api/academic-terms")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { academicTerms: [{ ...term, published: true }] } });
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

describe("tutor timesheet correction routes", () => {
  const history = {
    timesheet: {
      id: 12,
      weekStart: "2030-09-16",
      status: "RETURNED" as const,
      submittedAt: "2030-09-22T18:00:00.000Z",
      reviewedAt: "2030-09-23T08:00:00.000Z",
      reviewReason: "Please correct Tuesday hours",
      totalHours: 2.5,
      editable: true,
    },
    workLogs: [],
    revisions: [],
    declarations: [],
    disputes: [],
    declaration: { statementVersion: "s3-m3-v1", statement: "I confirm..." },
  };

  const revision = {
    id: 91,
    kind: "CORRECTION" as const,
    workLogId: 41,
    authorProfileId: 7,
    reason: "Please correct Tuesday hours",
    previousHours: 2.5,
    previousDescription: "Tuesday tutorial",
    newHours: 1.75,
    newDescription: "Tuesday tutorial (shortened)",
    createdAt: "2030-09-23T09:00:00.000Z",
  };

  const workLog = {
    id: 41,
    allocationId: 5,
    timesheetId: 12,
    workDate: "2030-09-17",
    hours: 1.75,
    description: "Tuesday tutorial (shortened)",
  };

  const dispute = {
    id: 71,
    timesheetId: 12,
    tutorId: 7,
    reason: "The Tuesday hours are wrong.",
    status: "OPEN" as const,
    raisedByProfileId: 7,
    resolvedByProfileId: null,
    resolutionReason: null,
    resolvedAt: null,
    createdAt: "2030-09-24T07:00:00.000Z",
  };

  const organiserOverrides = {
    findProfileByAuth0Id: async () => ({
      id: 8,
      email: "organiser@tutormx.example",
      fullName: "Demo Organiser",
      role: "ORGANISER" as const,
    }),
    verifyAccessToken: async () => ({
      subject: "auth0|current-organiser",
      role: "ORGANISER" as const,
      claims: { sub: "auth0|current-organiser" },
    }),
  };

  const correctionBody = { hours: 1.75, description: "Tuesday tutorial" };
  const disputeBody = { reason: "The Tuesday hours are wrong." };
  const declarationBody = { statementVersion: "s3-m3-v1" };

  it("requires a Tutor token on every correction route", async () => {
    const getTutorTimesheetHistory = vi.fn();
    const correctTutorTimesheetWorkLog = vi.fn();
    const declareTutorTimesheet = vi.fn();
    const raiseTutorTimesheetDispute = vi.fn();
    const routes = [
      { method: "get" as const, path: "/api/tutor/timesheets/12/history", body: undefined },
      { method: "patch" as const, path: "/api/tutor/timesheets/12/work-logs/41", body: correctionBody },
      { method: "post" as const, path: "/api/tutor/timesheets/12/declaration", body: declarationBody },
      { method: "post" as const, path: "/api/tutor/timesheets/12/disputes", body: disputeBody },
    ];

    for (const route of routes) {
      const app = makeApp({
        getTutorTimesheetHistory,
        correctTutorTimesheetWorkLog,
        declareTutorTimesheet,
        raiseTutorTimesheetDispute,
      });
      const withoutToken = await request(app)[route.method](route.path).send(
        route.body,
      );
      expect(withoutToken.status).toBe(401);

      const studentApp = makeApp({
        getTutorTimesheetHistory,
        correctTutorTimesheetWorkLog,
        declareTutorTimesheet,
        raiseTutorTimesheetDispute,
        verifyAccessToken: async () => auth("STUDENT"),
      });
      const wrongRole = await request(studentApp)[route.method](route.path)
        .set("Authorization", "Bearer valid-token")
        .send(route.body);
      expect(wrongRole.status).toBe(403);
    }

    expect(getTutorTimesheetHistory).not.toHaveBeenCalled();
    expect(correctTutorTimesheetWorkLog).not.toHaveBeenCalled();
    expect(declareTutorTimesheet).not.toHaveBeenCalled();
    expect(raiseTutorTimesheetDispute).not.toHaveBeenCalled();
  });

  it("returns the whole timeline for the tutor the token belongs to", async () => {
    const getTutorTimesheetHistory = vi.fn().mockResolvedValue(history);

    const response = await request(makeApp({ getTutorTimesheetHistory }))
      .get("/api/tutor/timesheets/12/history")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { history } });
    expect(getTutorTimesheetHistory).toHaveBeenCalledWith(
      "auth0|current-tutor",
      12,
    );
  });

  it("rejects a malformed timesheet or work-log identifier before the service", async () => {
    const getTutorTimesheetHistory = vi.fn();
    const correctTutorTimesheetWorkLog = vi.fn();
    const app = makeApp({
      getTutorTimesheetHistory,
      correctTutorTimesheetWorkLog,
    });

    const badTimesheet = await request(app)
      .get("/api/tutor/timesheets/zero/history")
      .set("Authorization", "Bearer valid-token");
    expect(badTimesheet.status).toBe(400);
    expect(badTimesheet.body.error.code).toBe("VALIDATION_ERROR");

    const badWorkLog = await request(app)
      .patch("/api/tutor/timesheets/12/work-logs/0")
      .set("Authorization", "Bearer valid-token")
      .send(correctionBody);
    expect(badWorkLog.status).toBe(400);

    expect(getTutorTimesheetHistory).not.toHaveBeenCalled();
    expect(correctTutorTimesheetWorkLog).not.toHaveBeenCalled();
  });

  it.each([
    { hours: 0, description: "Tuesday tutorial" },
    { hours: 24.5, description: "Tuesday tutorial" },
    { hours: 1.234, description: "Tuesday tutorial" },
    { hours: 1.75, description: "" },
    { hours: "1.75", description: "Tuesday tutorial" },
  ])(
    "rejects a correction body of %o before the service",
    async (body) => {
      const correctTutorTimesheetWorkLog = vi.fn();

      const response = await request(makeApp({ correctTutorTimesheetWorkLog }))
        .patch("/api/tutor/timesheets/12/work-logs/41")
        .set("Authorization", "Bearer valid-token")
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(correctTutorTimesheetWorkLog).not.toHaveBeenCalled();
    },
  );

  it("saves a correction and returns the revision that recorded it", async () => {
    const correctTutorTimesheetWorkLog = vi
      .fn()
      .mockResolvedValue({ workLog, revision });

    const response = await request(makeApp({ correctTutorTimesheetWorkLog }))
      .patch("/api/tutor/timesheets/12/work-logs/41")
      .set("Authorization", "Bearer valid-token")
      .send(correctionBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { workLog, revision } });
    expect(correctTutorTimesheetWorkLog).toHaveBeenCalledWith(
      "auth0|current-tutor",
      12,
      41,
      correctionBody,
    );
  });

  it.each(["SUBMITTED", "APPROVED"] as const)(
    "refuses to change a %s timesheet even when the route is called directly",
    async () => {
      const correctTutorTimesheetWorkLog = vi.fn().mockRejectedValue(
        createRouteError(
          409,
          "TIMESHEET_EDIT_LOCKED",
          "Only a draft or returned timesheet can be changed. This one has already been submitted.",
        ),
      );

      const response = await request(makeApp({ correctTutorTimesheetWorkLog }))
        .patch("/api/tutor/timesheets/12/work-logs/41")
        .set("Authorization", "Bearer valid-token")
        .send(correctionBody);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("TIMESHEET_EDIT_LOCKED");
    },
  );

  it("records a declaration and echoes the wording version", async () => {
    const declaration = {
      id: 61,
      timesheetId: 12,
      statementVersion: "s3-m3-v1",
      declaredAt: "2030-09-23T10:00:00.000Z",
    };
    const declareTutorTimesheet = vi.fn().mockResolvedValue(declaration);

    const response = await request(makeApp({ declareTutorTimesheet }))
      .post("/api/tutor/timesheets/12/declaration")
      .set("Authorization", "Bearer valid-token")
      .send(declarationBody);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: { declaration } });
    expect(declareTutorTimesheet).toHaveBeenCalledWith(
      "auth0|current-tutor",
      12,
      "s3-m3-v1",
    );
  });

  it("rejects a declaration without the wording version", async () => {
    const declareTutorTimesheet = vi.fn();

    const response = await request(makeApp({ declareTutorTimesheet }))
      .post("/api/tutor/timesheets/12/declaration")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(response.status).toBe(400);
    expect(declareTutorTimesheet).not.toHaveBeenCalled();
  });

  it("surfaces a stale declaration as its own conflict", async () => {
    const declareTutorTimesheet = vi.fn().mockRejectedValue(
      createRouteError(
        409,
        "TIMESHEET_DECLARATION_STALE",
        "The declaration wording has changed. Reload it and read it again.",
      ),
    );

    const response = await request(makeApp({ declareTutorTimesheet }))
      .post("/api/tutor/timesheets/12/declaration")
      .set("Authorization", "Bearer valid-token")
      .send(declarationBody);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("TIMESHEET_DECLARATION_STALE");
  });

  it("tells the tutor to declare before the resubmission is accepted", async () => {
    const submitTutorTimesheet = vi.fn().mockRejectedValue(
      createRouteError(
        409,
        "TIMESHEET_DECLARATION_REQUIRED",
        "Declare that this timesheet is correct before resubmitting it.",
      ),
    );

    const response = await request(makeApp({ submitTutorTimesheet }))
      .post("/api/tutor/timesheets/12/submit")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("TIMESHEET_DECLARATION_REQUIRED");
    expect(response.body.error.message).toContain("Declare");
  });

  it("raises a dispute for the signed-in tutor", async () => {
    const raiseTutorTimesheetDispute = vi.fn().mockResolvedValue(dispute);

    const response = await request(makeApp({ raiseTutorTimesheetDispute }))
      .post("/api/tutor/timesheets/12/disputes")
      .set("Authorization", "Bearer valid-token")
      .send(disputeBody);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: { dispute } });
    expect(raiseTutorTimesheetDispute).toHaveBeenCalledWith(
      "auth0|current-tutor",
      12,
      disputeBody,
    );
  });

  it("rejects a dispute without a reason", async () => {
    const raiseTutorTimesheetDispute = vi.fn();

    const response = await request(makeApp({ raiseTutorTimesheetDispute }))
      .post("/api/tutor/timesheets/12/disputes")
      .set("Authorization", "Bearer valid-token")
      .send({ reason: "   " });

    expect(response.status).toBe(400);
    expect(raiseTutorTimesheetDispute).not.toHaveBeenCalled();
  });

  it("reports a second open dispute on the same sheet", async () => {
    const raiseTutorTimesheetDispute = vi.fn().mockRejectedValue(
      createRouteError(
        409,
        "TIMESHEET_DISPUTE_OPEN",
        "This timesheet already has an open dispute waiting for an answer.",
      ),
    );

    const response = await request(makeApp({ raiseTutorTimesheetDispute }))
      .post("/api/tutor/timesheets/12/disputes")
      .set("Authorization", "Bearer valid-token")
      .send(disputeBody);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("TIMESHEET_DISPUTE_OPEN");
  });

  it("lets an Organiser read and answer the objection queue", async () => {
    const listTimesheetDisputes = vi.fn().mockResolvedValue([dispute]);
    const resolveTimesheetDispute = vi.fn().mockResolvedValue({
      ...dispute,
      status: "RESOLVED" as const,
      resolvedByProfileId: 8,
      resolutionReason: "Agreed, the hours have been corrected.",
      resolvedAt: "2030-09-25T09:00:00.000Z",
    });
    const overrides = {
      listTimesheetDisputes,
      resolveTimesheetDispute,
      ...organiserOverrides,
    };

    const listed = await request(makeApp(overrides))
      .get("/api/organiser/timesheet-disputes")
      .set("Authorization", "Bearer valid-token");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ data: { disputes: [dispute] } });
    expect(listTimesheetDisputes).toHaveBeenCalledWith("auth0|current-organiser");

    const answered = await request(makeApp(overrides))
      .patch("/api/timesheet-disputes/71")
      .set("Authorization", "Bearer valid-token")
      .send({ resolutionReason: "Agreed, the hours have been corrected." });
    expect(answered.status).toBe(200);
    expect(answered.body.data.dispute.status).toBe("RESOLVED");
    expect(resolveTimesheetDispute).toHaveBeenCalledWith(
      "auth0|current-organiser",
      71,
      { resolutionReason: "Agreed, the hours have been corrected." },
    );
  });

  it("keeps both dispute routes away from a Tutor", async () => {
    const listTimesheetDisputes = vi.fn();
    const resolveTimesheetDispute = vi.fn();
    const app = makeApp({ listTimesheetDisputes, resolveTimesheetDispute });

    const listed = await request(app)
      .get("/api/organiser/timesheet-disputes")
      .set("Authorization", "Bearer valid-token");
    expect(listed.status).toBe(403);

    const answered = await request(app)
      .patch("/api/timesheet-disputes/71")
      .set("Authorization", "Bearer valid-token")
      .send({ resolutionReason: "No." });
    expect(answered.status).toBe(403);

    expect(listTimesheetDisputes).not.toHaveBeenCalled();
    expect(resolveTimesheetDispute).not.toHaveBeenCalled();
  });

  it("requires a reason for answering a dispute", async () => {
    const resolveTimesheetDispute = vi.fn();

    const response = await request(
      makeApp({ resolveTimesheetDispute, ...organiserOverrides }),
    )
      .patch("/api/timesheet-disputes/71")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(response.status).toBe(400);
    expect(resolveTimesheetDispute).not.toHaveBeenCalled();
  });

  it.each([
    ["getTutorTimesheetHistory" as const, "get" as const, "/api/tutor/timesheets/12/history"],
    ["correctTutorTimesheetWorkLog" as const, "patch" as const, "/api/tutor/timesheets/12/work-logs/41"],
    ["declareTutorTimesheet" as const, "post" as const, "/api/tutor/timesheets/12/declaration"],
    ["raiseTutorTimesheetDispute" as const, "post" as const, "/api/tutor/timesheets/12/disputes"],
  ])(
    "fails %s closed when the correction surface is not configured",
    async (key, method, path) => {
      const body =
        key === "correctTutorTimesheetWorkLog"
          ? correctionBody
          : key === "declareTutorTimesheet"
            ? declarationBody
            : disputeBody;

      const app = makeApp({ [key]: undefined });
      const response = await request(app)[method](path)
        .set("Authorization", "Bearer valid-token")
        .send(body);

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe(
        "TIMESHEET_CORRECTIONS_UNAVAILABLE",
      );
    },
  );

  it("fails the organiser dispute routes closed when they are not configured", async () => {
    const listed = await request(
      makeApp({ listTimesheetDisputes: undefined, ...organiserOverrides }),
    )
      .get("/api/organiser/timesheet-disputes")
      .set("Authorization", "Bearer valid-token");
    expect(listed.status).toBe(503);
    expect(listed.body.error.code).toBe("TIMESHEET_DISPUTE_UNAVAILABLE");

    const answered = await request(
      makeApp({ resolveTimesheetDispute: undefined, ...organiserOverrides }),
    )
      .patch("/api/timesheet-disputes/71")
      .set("Authorization", "Bearer valid-token")
      .send({ resolutionReason: "No." });
    expect(answered.status).toBe(503);
    expect(answered.body.error.code).toBe("TIMESHEET_DISPUTE_UNAVAILABLE");
  });
});

describe('manual timetable metadata contract', () => {
  const payload = {
    type: 'BUSY', startsAt: '2030-09-04T14:00:00.000Z', endsAt: '2030-09-04T16:00:00.000Z',
    recurrence: 'FORTNIGHTLY', label: 'Lab', recurrenceUntil: null, category: 'CLASS', seriesId: null,
  };
  it.each(['post', 'patch'] as const)('accepts the real frontend %s payload and retains metadata', async (method) => {
    const write = vi.fn().mockResolvedValue({ id: 1, ...payload });
    const app = makeApp({ createTutorTimeSlot: write, updateTutorTimeSlot: write });
    const response = await request(app)[method](`/api/tutor/time-slots${method === 'patch' ? '/1' : ''}`)
      .set('Authorization', 'Bearer token').send(payload);
    expect(response.status).toBe(method === 'post' ? 201 : 200);
    expect(response.body.data.timeSlot).toMatchObject(payload);
    expect(write.mock.calls[0]!.at(-1)).toMatchObject({
      recurrence: 'FORTNIGHTLY', category: 'CLASS', seriesId: null,
      startsAt: new Date(payload.startsAt), endsAt: new Date(payload.endsAt),
    });
  });
  it.each([
    { category: 'TUTORING' }, { category: null }, { category: 1 },
    { seriesId: 1 }, { seriesId: '' }, { seriesId: ' ' }, { seriesId: 'x'.repeat(37) },
    { tutorId: 999 },
  ])('refuses invalid metadata or ownership injection %j', async (invalid) => {
    const createTutorTimeSlot = vi.fn();
    const response = await request(makeApp({ createTutorTimeSlot })).post('/api/tutor/time-slots')
      .set('Authorization', 'Bearer token').send({ ...payload, ...invalid });
    expect(response.status).toBe(400);
    expect(createTutorTimeSlot).not.toHaveBeenCalled();
  });
  it('accepts a retained series identifier on an edited class', async () => {
    const updateTutorTimeSlot = vi.fn().mockResolvedValue({ id: 1, ...payload, seriesId: 'class-series' });
    const response = await request(makeApp({ updateTutorTimeSlot })).patch('/api/tutor/time-slots/1')
      .set('Authorization', 'Bearer token').send({ ...payload, seriesId: 'class-series' });
    expect(response.status).toBe(200);
    expect(updateTutorTimeSlot).toHaveBeenCalledWith('auth0|current-tutor', 1,
      expect.objectContaining({ category: 'CLASS', seriesId: 'class-series' }));
  });
});

describe('Sprint 4 shared own-schedule HTTP contract', () => {
  function shared(role: TutorRole, overrides: Partial<AppDependencies> = {}) {
    return makeApp({
      findProfileByAuth0Id: async () => ({ id: 7, email: 'owner@example.test', fullName: 'Owner', role }),
      verifyAccessToken: async () => auth(role), ...overrides,
    });
  }
  it.each(['STUDENT', 'TUTOR'] as const)('%s uses the shared recurrence and authenticated owner', async role => {
    const create = vi.fn(async (_subject, input) => ({ id: 1, ...input }));
    for (const recurrence of [undefined, 'WEEKLY', 'FORTNIGHTLY']) {
      const result = await request(shared(role, { createTutorTimeSlot: create })).post('/api/me/time-slots')
        .set('Authorization', 'Bearer valid').send({ type: 'BUSY', startsAt: '2030-09-02T08:00:00Z', endsAt: '2030-09-02T09:00:00Z', category: 'CLASS', recurrence });
      expect(result.status).toBe(201);
      expect(create.mock.calls.at(-1)?.[0]).toBe('auth0|current-tutor');
    }
  });
  it('keeps legacy tutor aliases tutor-only and organisers out of own schedules', async () => {
    expect((await request(shared('STUDENT')).get('/api/tutor/time-slots').set('Authorization', 'Bearer valid')).status).toBe(403);
    expect((await request(shared('ORGANISER')).get('/api/me/time-slots').set('Authorization', 'Bearer valid')).status).toBe(403);
    expect((await request(shared('STUDENT')).get('/api/me/time-slots')).status).toBe(401);
  });
  it.each(['ownerId', 'tutorId'])('refuses injected %s in a Student write', async field => {
    const create = vi.fn();
    const result = await request(shared('STUDENT', { createTutorTimeSlot: create })).post('/api/me/time-slots').set('Authorization', 'Bearer valid')
      .send({ type: 'BUSY', startsAt: '2030-09-02T08:00:00Z', endsAt: '2030-09-02T09:00:00Z', [field]: 99 });
    expect(result.status).toBe(400); expect(create).not.toHaveBeenCalled();
  });
  it('passes Student identity to list, update, delete and import handlers', async () => {
    const list = vi.fn(async () => []), remove = vi.fn(async () => undefined);
    const update = vi.fn(async () => { throw createRouteError(404, 'TIME_SLOT_NOT_FOUND', 'Unavailable'); });
    const preview = vi.fn(async () => { throw createRouteError(404, 'ACADEMIC_TERM_NOT_FOUND', 'Unavailable'); });
    const commit = vi.fn(async () => { throw createRouteError(404, 'ACADEMIC_TERM_NOT_FOUND', 'Unavailable'); });
    const app = shared('STUDENT', { listOwnTutorTimeSlots: list, deleteTutorTimeSlot: remove, updateTutorTimeSlot: update, previewTutorTimetableImport: preview, commitTutorTimetableImport: commit });
    expect((await request(app).get('/api/me/time-slots').set('Authorization', 'Bearer valid')).status).toBe(200);
    expect((await request(app).delete('/api/me/time-slots/8').set('Authorization', 'Bearer valid')).status).toBe(204);
    expect((await request(app).patch('/api/me/time-slots/8').set('Authorization', 'Bearer valid').send({ type: 'BUSY', startsAt: '2030-09-02T08:00:00Z', endsAt: '2030-09-02T09:00:00Z' })).status).toBe(404);
    for (const action of ['preview', 'commit']) {
      expect((await request(app).post(`/api/me/time-slots/import/${action}`).set('Authorization', 'Bearer valid').send({ source: 'CSV', text: 'date,start,end\n2030-09-02,08:00,09:00', timeZone: 'UTC', termId: 1 })).status).toBe(404);
    }
    expect(list).toHaveBeenCalledWith('auth0|current-tutor');
    expect(remove).toHaveBeenCalledWith('auth0|current-tutor', 8);
    expect(update).toHaveBeenCalledWith('auth0|current-tutor', 8, expect.any(Object));
    expect(preview).toHaveBeenCalledWith('auth0|current-tutor', expect.any(Object));
    expect(commit).toHaveBeenCalledWith('auth0|current-tutor', expect.any(Object));
  });
  it('validates navigation payloads and uses only the authenticated subject', async () => {
    const resolve = vi.fn(async () => ({ linkPath: '/student/timetable', action: 'View' as const }));
    const app = shared('STUDENT', { resolveNavigation: resolve });
    expect((await request(app).post('/api/navigation/resolve').set('Authorization', 'Bearer valid').send({ destinationId: 'student-timetable' })).status).toBe(200);
    expect(resolve).toHaveBeenCalledWith('auth0|current-tutor', { destinationId: 'student-timetable' });
    expect((await request(app).post('/api/navigation/resolve').set('Authorization', 'Bearer valid').send({ destinationId: 'settings', notificationId: 1 })).status).toBe(400);
  });
});

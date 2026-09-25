import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp, createRouteError, type AppDependencies } from "./app.js";
import type { TutorRole } from "./auth/contract.js";

function fixture(role: TutorRole = "ORGANISER", extra: Partial<AppDependencies> = {}) {
  const dependencies = {
    verifyAccessToken: async () => ({ subject: "auth0|verified", role, claims: {} }),
    findProfileByAuth0Id: async () => ({ id: 7, fullName: "Test", email: "test@example.org", role }),
    listOrganiserApprovals: vi.fn(async () => ({ timesheets: [], volunteerClaims: [], excuses: [] })),
    listTimesheetDisputes: vi.fn(async () => []),
    listStaffingRequirements: vi.fn(async () => []),
    listOrganiserOverflowWork: vi.fn(async () => []),
    ...extra,
  } as unknown as AppDependencies;
  return { dependencies, app: createApp(async () => undefined, dependencies) };
}

const protectedRoutes = [
  ["get", "/api/organiser/approvals", "ORGANISER"],
  ["get", "/api/organiser/timesheet-disputes", "ORGANISER"],
  ["patch", "/api/timesheet-disputes/1", "ORGANISER"],
  ["get", "/api/staffing-requirements", "ORGANISER"],
  ["post", "/api/staffing-requirements", "ORGANISER"],
  ["patch", "/api/staffing-requirements/1", "ORGANISER"],
  ["patch", "/api/staffing-requirements/1/status", "ORGANISER"],
  ["post", "/api/allocations/bulk-preview", "ORGANISER"],
  ["post", "/api/allocations/bulk-commit", "ORGANISER"],
  ["get", "/api/reports/workload", "ORGANISER"],
  ["get", "/api/reports/payroll-export", "ORGANISER"],
  ["get", "/api/organiser/overflow-work", "ORGANISER"],
  ["post", "/api/organiser/overflow-work", "ORGANISER"],
  ["patch", "/api/organiser/overflow-work/1", "ORGANISER"],
  ["patch", "/api/organiser/overflow-work/1/close", "ORGANISER"],
  ["post", "/api/notifications/reminders/run", "ORGANISER"],
  ["post", "/api/organiser/academic-terms", "ORGANISER"],
  ["post", "/api/tutor/time-slots/import/preview", "TUTOR"],
  ["post", "/api/tutor/time-slots/import/commit", "TUTOR"],
  ["get", "/api/tutor/timesheets/1/history", "TUTOR"],
  ["patch", "/api/tutor/timesheets/1/work-logs/1", "TUTOR"],
  ["post", "/api/tutor/timesheets/1/declaration", "TUTOR"],
  ["post", "/api/tutor/timesheets/1/disputes", "TUTOR"],
  ["get", "/api/student/open-work", "STUDENT"],
  ["post", "/api/student/volunteer-requests", "STUDENT"],
  ["patch", "/api/student/volunteer-requests/1/withdraw", "STUDENT"],
] as const;

describe("Sprint 3 Member 5 permission and error contract", () => {
  it.each(protectedRoutes)("%s %s requires authentication and the %s role", async (method, path, allowed) => {
    expect((await request(fixture().app)[method](path).send({})).status).toBe(401);
    for (const role of ["ORGANISER", "TUTOR", "STUDENT"] as const) {
      if (role === allowed) continue;
      const response = await request(fixture(role).app)[method](path).set("Authorization", "Bearer test").send({});
      expect(response.status).toBe(403);
      expect(Object.keys(response.body.error).sort()).toEqual(["code", "message"]);
    }
  });
  it.each(["/api/search?q=Tutor", "/api/notifications", "/api/notifications/unread-count", "/api/academic-terms"])("requires a verified identity for %s", async (path) => {
    expect((await request(fixture().app).get(path)).status).toBe(401);
  });
  it("loads both actual organiser queue URLs", async () => {
    const { app } = fixture();
    for (const path of ["/api/organiser/approvals", "/api/organiser/timesheet-disputes"]) {
      expect((await request(app).get(path).set("Authorization", "Bearer test")).status).toBe(200);
    }
  });
  it.each(["page=10001", "page=1.5", "pageSize=26", "page=1&page=2", "pageSize=0"])("rejects %s before querying lists", async (query) => {
    for (const path of ["/api/search?q=Tutor&", "/api/notifications?"]) {
      const response = await request(fixture().app).get(path + query).set("Authorization", "Bearer test");
      expect(response.status).toBe(400);
    }
  });
  it("never exposes private error properties or a forged database message", async () => {
    const listTimesheetDisputes = vi.fn().mockRejectedValue(Object.assign(new Error("postgres://secret"), { status: 409, code: "PRIVATE", sql: "secret" }));
    const response = await request(fixture("ORGANISER", { listTimesheetDisputes }).app).get("/api/organiser/timesheet-disputes").set("Authorization", "Bearer test");
    expect(response.status).toBe(500);
    expect(response.text).not.toContain("secret");
  });
  it.each([404, 409] as const)("preserves deliberately public %s import errors", async (status) => {
    const commitTutorTimetableImport = vi.fn().mockRejectedValue(createRouteError(status, "TIMETABLE_IMPORT_CONFLICT", "Check your schedule."));
    const response = await request(fixture("TUTOR", { commitTutorTimetableImport }).app)
      .post("/api/tutor/time-slots/import/commit").set("Authorization", "Bearer test")
      .send({ source: "CSV", text: "date,start,end,label\n2030-09-02,09:00,10:00,Maths", timeZone: "UTC", termId: 1 });
    expect(response.status).toBe(status);
  });
  it("takes ownership from the verified token and passes the validated retry key", async () => {
    const commitTutorTimetableImport = vi.fn().mockResolvedValue({ created: 0, createdIds: [], skipped: [], invalidCount: 0, duplicateCount: 0 });
    const { app } = fixture("TUTOR", { commitTutorTimetableImport });
    const input = { source: "CSV", text: "date,start,end,label\n2030-09-02,09:00,10:00,Maths", timeZone: "UTC", termId: 1 };
    expect((await request(app).post("/api/tutor/time-slots/import/commit").set("Authorization", "Bearer test").set("Idempotency-Key", "import-1234").send(input)).status).toBe(200);
    expect(commitTutorTimetableImport).toHaveBeenCalledWith("auth0|verified", input, "import-1234");
    expect((await request(app).post("/api/tutor/time-slots/import/commit").set("Authorization", "Bearer test").set("Idempotency-Key", "bad").send(input)).status).toBe(400);
  });
  it("exposes the CSV filename only to the configured frontend origin", async () => {
    const { app } = fixture("ORGANISER", {
      corsOrigin: "https://frontend.example.org",
      payrollExportCsv: async () => ({ filename: "payroll.csv", csv: "Tutor,Hours\nSam,2" }),
    });
    for (const origin of ["https://frontend.example.org", "https://other.example.org"]) {
      const response = await request(app).get("/api/reports/payroll-export?weekStart=2030-09-02&weeks=1")
        .set("Authorization", "Bearer test").set("Origin", origin);
      expect(response.status).toBe(200);
      expect(response.headers["access-control-expose-headers"]).toBe(
        origin === "https://frontend.example.org" ? "Content-Disposition" : undefined,
      );
    }
  });
  it("returns JSON 413 with CORS for oversized requests", async () => {
    const { app } = fixture("TUTOR", { corsOrigin: "https://example.org" });
    const response = await request(app).post("/api/tutor/time-slots/import/commit").set("Origin", "https://example.org").send({ text: "x".repeat(33_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(response.headers["access-control-allow-origin"]).toBe("https://example.org");
  });
  it("rejects unsafe resource IDs before touching the service", async () => {
    const resolveTimesheetDispute = vi.fn();
    const response = await request(fixture("ORGANISER", { resolveTimesheetDispute }).app).patch("/api/timesheet-disputes/2147483648").set("Authorization", "Bearer test").send({ resolutionReason: "Resolved" });
    expect(response.status).toBe(400);
    expect(resolveTimesheetDispute).not.toHaveBeenCalled();
  });
  it("logs route templates without private URLs or request bodies", async () => {
    const log = vi.fn();
    const { dependencies } = fixture();
    const app = createApp(async () => undefined, dependencies, log);
    await request(app).get("/api/notifications/123?token=private").set("Authorization", "Bearer secret");
    await request(app).get("/private-email@example.org");
    expect(log.mock.calls[0]?.[0].path).toBe("/api/notifications/:id");
    expect(log.mock.calls[1]?.[0].path).toBe("/unmatched");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|secret/);
  });
});

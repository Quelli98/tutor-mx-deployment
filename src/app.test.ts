import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp, sessionLengthText } from "./app.js";

describe("GET /health", () => {
  it("keeps liveness available after a failed readiness probe", async () => {
    const checkReadiness = vi.fn().mockRejectedValue(new Error("Prisma private connection string"));
    const app = createApp(checkReadiness);
    const ready = await request(app).get("/ready");
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: "not ready", database: "disconnected" });
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });
    expect(checkReadiness).toHaveBeenCalledOnce();
  });

  it("returns an OK health status", async () => {
    const app = createApp(async () => undefined);

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("logs safe request metadata without headers or bearer tokens", async () => {
    const requestLogger = vi.fn();
    const app = createApp(async () => undefined, undefined, requestLogger);

    const response = await request(app)
      .get("/health?access_token=must-not-be-logged")
      .set("Authorization", "Bearer private-test-token");

    expect(response.status).toBe(200);
    expect(requestLogger).toHaveBeenCalledOnce();
    expect(requestLogger).toHaveBeenCalledWith({
      method: "GET",
      path: "/health",
      status: 200,
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(requestLogger.mock.calls)).not.toContain(
      "private-test-token",
    );
    expect(JSON.stringify(requestLogger.mock.calls)).not.toContain(
      "must-not-be-logged",
    );
  });
});

describe("GET /ready", () => {
  it("returns ready when the database check succeeds", async () => {
    const checkReadiness = vi.fn().mockResolvedValue(undefined);
    const app = createApp(checkReadiness);

    const response = await request(app).get("/ready");

    expect(checkReadiness).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ready",
      database: "connected",
    });
  });

  it("returns unavailable when the database check fails", async () => {
    const checkReadiness = vi
      .fn()
      .mockRejectedValue(new Error("Database unavailable"));
    const app = createApp(checkReadiness);

    const response = await request(app).get("/ready");

    expect(checkReadiness).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "not ready",
      database: "disconnected",
    });
  });
});

describe("unconfigured authentication", () => {
  it("fails closed when a bearer token is supplied without Auth0 configuration", async () => {
    const app = createApp(async () => undefined);

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_ACCESS_TOKEN");
  });

  it("fails closed when password reset is not configured", async () => {
    const app = createApp(async () => undefined);

    const response = await request(app)
      .post("/api/auth/password-reset")
      .send({ email: "user@tutormx.example" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("PASSWORD_RESET_UNAVAILABLE");
  });
});

describe("shared error handling", () => {
  it("returns a safe 400 JSON response for malformed JSON", async () => {
    const app = createApp(async () => undefined);

    const response = await request(app)
      .post("/api/auth/password-reset")
      .set("Content-Type", "application/json")
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "The request body must contain valid JSON.",
      },
    });
  });

  it("uses the generic safe error envelope for other middleware failures", async () => {
    const app = createApp(async () => undefined);
    const oversizedBody = JSON.stringify({ value: "x".repeat(40_000) });

    const response = await request(app)
      .post("/api/auth/password-reset")
      .set("Content-Type", "application/json")
      .send(oversizedBody);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    });
    expect(response.text).not.toContain("request entity too large");
  });
});

describe("session length wording", () => {
  // The board repeats these words exactly. frontend/src/components/shared/
  // scheduleWeek.test.js runs the same table, so the two cannot drift apart.
  it.each([
      ["2030-09-04T10:00:00.000Z", "2030-09-04T12:00:00.000Z", "2 hours"],
      ["2030-09-04T10:00:00.000Z", "2030-09-04T11:00:00.000Z", "1 hour"],
      ["2030-09-04T10:00:00.000Z", "2030-09-04T11:30:00.000Z", "1 hour 30 minutes"],
      ["2030-09-04T10:00:00.000Z", "2030-09-04T12:45:00.000Z", "2 hours 45 minutes"],
      ["2030-09-04T10:00:00.000Z", "2030-09-04T10:45:00.000Z", "45 minutes"],
      ["2030-09-04T10:00:00.000Z", "2030-09-04T10:20:00.000Z", "20 minutes"],
      ["2030-09-04T10:00:00.000Z", "2030-09-04T10:01:00.000Z", "1 minute"],
      ["2030-09-04T10:00:00.000Z", "2030-09-04T11:01:00.000Z", "1 hour 1 minute"],
  ])("says %s to %s as %s", (startsAt, endsAt, expected) => {
    expect(sessionLengthText(new Date(startsAt), new Date(endsAt))).toBe(expected);
  });
});

import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

describe("GET /health", () => {
  it("returns an OK health status", async () => {
    const app = createApp(async () => undefined);

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
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

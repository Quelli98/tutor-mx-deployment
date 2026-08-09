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
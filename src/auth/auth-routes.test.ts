import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp, type ProfileSummary } from "../app.js";
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
    findProfileByAuth0Id: (id: string) => Promise<ProfileSummary | null>;
    requestPasswordReset: (email: string) => Promise<void>;
    verifyAccessToken: (token: string) => Promise<AuthContext>;
  }> = {},
) {
  return createApp(async () => undefined, {
    ...(overrides.corsOrigin ? { corsOrigin: overrides.corsOrigin } : {}),
    findProfileByAuth0Id:
      overrides.findProfileByAuth0Id ?? (async () => profile),
    requestPasswordReset:
      overrides.requestPasswordReset ?? (async () => undefined),
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { logUnhandledError } from "./unhandled-error-log.js";

function loggedEntry() {
  const consoleError = vi.mocked(console.error);
  return JSON.parse(String(consoleError.mock.calls[0][0]));
}

describe("logUnhandledError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records an Error with its code and stack", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    logUnhandledError(
      "route",
      { method: "DELETE", path: "/api/courses/7" },
      Object.assign(new TypeError("boom"), { code: 42 }),
    );

    expect(loggedEntry()).toMatchObject({
      event: "unhandled_route_error",
      source: "route",
      method: "DELETE",
      path: "/api/courses/7",
      name: "TypeError",
      message: "boom",
      code: "42",
    });
    expect(loggedEntry().stack).toContain("boom");
  });

  it("records thrown non-Error values without a request", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    logUnhandledError("final_error_handler", undefined, "plain failure");

    const entry = loggedEntry();
    expect(entry).toMatchObject({
      event: "unhandled_route_error",
      source: "final_error_handler",
      name: "string",
      message: "plain failure",
    });
    expect(entry).not.toHaveProperty("method");
    expect(entry).not.toHaveProperty("code");
    expect(entry).not.toHaveProperty("stack");
  });

  it("records a non-Error object that carries a code", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    logUnhandledError("profile_role_middleware", {}, { code: "P2003" });

    expect(loggedEntry()).toMatchObject({
      name: "object",
      message: "[object Object]",
      code: "P2003",
    });
  });
});

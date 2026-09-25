import { describe, expect, it } from "vitest";
import { boundedInteger, matchesVersion, parsePage, permitsTransition } from "./validation.js";
import { createRouteError, sanitizeError } from "./errors.js";
import { normalizeIdempotencyKey, requestFingerprint } from "./idempotency.js";
import { assertResultLimit } from "./limits.js";

describe("Member 5 shared contract boundaries", () => {
  it.each([null, [], {}, true, "1e2", "1.5", "-1", "", "9007199254740992"])("rejects invalid integer %j", (input) => {
    expect(boundedInteger(input, 1, 2147483647)).toBeNull();
  });
  it("enforces inclusive page, size and ID bounds", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("10000")).toBe(10000);
    expect(parsePage("10001")).toBeNull();
    expect(parsePage("26", 10, 25)).toBeNull();
    expect(boundedInteger(2147483647, 1, 2147483647)).toBe(2147483647);
    expect(boundedInteger(2147483648, 1, 2147483647)).toBeNull();
  });
  it("strips private fields and refuses forged public errors", () => {
    const safe = Object.assign(createRouteError(409, "CONFLICT", "Please refresh."), { stack: "secret", sql: "private" });
    expect(sanitizeError(safe)).toEqual({ status: 409, body: { error: { code: "CONFLICT", message: "Please refresh." } } });
    expect(JSON.stringify(sanitizeError(Object.assign(new Error("password"), { status: 409, code: "P2002" })))).not.toContain("password");
    expect(sanitizeError({ status: 400, code: "FAKE", message: "secret" }).status).toBe(500);
  });
  it.each(["short", " bad-key ", "a".repeat(129), ["first-key", "second-key"], "a/b/c/d/e"])("rejects malformed retry key %j", (input) => {
    expect(() => normalizeIdempotencyKey(input)).toThrow();
  });
  it("preserves keys, canonicalizes payloads and detects changed content", () => {
    expect(normalizeIdempotencyKey(undefined)).toBeUndefined();
    expect(normalizeIdempotencyKey("import-1234")).toBe("import-1234");
    expect(requestFingerprint({ a: 1, b: 2 })).toBe(requestFingerprint({ b: 2, a: 1 }));
    expect(requestFingerprint({ a: 1 })).not.toBe(requestFingerprint({ a: 2 }));
  });
  it("rejects stale versions and illegal state transitions", () => {
    expect(matchesVersion("v1", "v1")).toBe(true);
    expect(matchesVersion("v1", ["v1"])).toBe(false);
    expect(matchesVersion("v1", "v0")).toBe(false);
    expect(permitsTransition("OPEN", "OPEN", "RESOLVED", { OPEN: ["RESOLVED"] })).toBe(true);
    expect(permitsTransition("RESOLVED", "OPEN", "RESOLVED", { OPEN: ["RESOLVED"] })).toBe(false);
    expect(permitsTransition("OPEN", "OPEN", "APPROVED", { OPEN: ["RESOLVED"] })).toBe(false);
  });
  it("fails explicitly instead of truncating a report", () => {
    expect(() => assertResultLimit([1, 2], 2, "Report")).not.toThrow();
    expect(() => assertResultLimit([1, 2, 3], 2, "Report")).toThrow(/Narrow/);
  });
});

import { describe, expect, it } from "vitest";
import { createTtlCache } from "./ttl-cache.js";

describe("createTtlCache", () => {
  it("returns null for a missing key", () => {
    const cache = createTtlCache<string>({ ttlMs: 1000 });
    expect(cache.get("missing")).toBeNull();
  });

  it("returns the stored value before expiry", () => {
    let now = 1_000_000;
    const cache = createTtlCache<string>({ ttlMs: 1000, now: () => now });

    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");

    // Still within TTL.
    now += 999;
    expect(cache.get("key")).toBe("value");
  });

  it("returns null after the TTL expires", () => {
    let now = 1_000_000;
    const cache = createTtlCache<string>({ ttlMs: 1000, now: () => now });

    cache.set("key", "value");
    now += 1000;
    expect(cache.get("key")).toBeNull();
  });

  it("isolates different keys", () => {
    const cache = createTtlCache<number>({ ttlMs: 1000 });
    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
  });

  it("invalidates a specific key", () => {
    const cache = createTtlCache<string>({ ttlMs: 1000 });
    cache.set("key", "value");
    cache.invalidate("key");
    expect(cache.get("key")).toBeNull();
  });

  it("clears all entries", () => {
    const cache = createTtlCache<string>({ ttlMs: 1000 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
  });

  it("rejects a non-positive TTL", () => {
    expect(() => createTtlCache({ ttlMs: 0 })).toThrow("ttlMs");
    expect(() => createTtlCache({ ttlMs: -1 })).toThrow("ttlMs");
  });

  it("overwrites an existing entry", () => {
    const cache = createTtlCache<string>({ ttlMs: 1000 });
    cache.set("key", "first");
    cache.set("key", "second");
    expect(cache.get("key")).toBe("second");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSouthAfricaPublicHolidayService,
  decodePublicHolidays,
  publicHolidayUrl,
} from "./public-holidays.js";
import { createTtlCache, type TtlCache } from "./ttl-cache.js";
import type { ExternalApiResult } from "./external-api.js";
import type { PublicHoliday } from "./public-holidays.js";

const validResponse = [
  {
    date: "2026-01-01",
    name: "New Year's Day",
    countryCode: "ZA",
    nationalHoliday: true,
    subdivisionCodes: null,
    holidayTypes: ["Public"],
    upstreamOnly: "discard me",
  },
];

describe("South African public-holiday integration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the official server-side endpoint for the requested year", () => {
    expect(publicHolidayUrl(2026).toString()).toBe(
      "https://nagerholidays.com/api/v4/Holidays/ZA/2026",
    );
    expect(() => publicHolidayUrl(1999)).toThrow("year");
    expect(() => publicHolidayUrl(2026.5)).toThrow("year");
  });

  it("returns only validated public fields after a successful response", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const service = createSouthAfricaPublicHolidayService({
      fetchImplementation,
      timeoutMs: 1_000,
      now: () => new Date("2026-08-14T10:00:00.000Z"),
    });

    await expect(service.execute(2026)).resolves.toEqual({
      source: "external",
      data: [
        {
          date: "2026-01-01",
          name: "New Year's Day",
          countryCode: "ZA",
          nationalHoliday: true,
          holidayTypes: ["Public"],
        },
      ],
      retrievedAt: "2026-08-14T10:00:00.000Z",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL("https://nagerholidays.com/api/v4/Holidays/ZA/2026"),
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns a controlled fallback for an invalid response", async () => {
    const service = createSouthAfricaPublicHolidayService({
      fetchImplementation: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              ...validResponse[0],
              countryCode: "US",
            },
          ]),
          { status: 200 },
        ),
      ),
    });

    await expect(service.execute(2026)).resolves.toEqual({
      source: "fallback",
      data: [],
      retrievedAt: null,
      reason: "invalid-response",
    });
  });

  it("aborts and returns a controlled fallback after a timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const service = createSouthAfricaPublicHolidayService({
      timeoutMs: 100,
      fetchImplementation: vi.fn((_input, init) => {
        signal = init?.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }),
    });

    const result = service.execute(2026);
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toEqual({
      source: "fallback",
      data: [],
      retrievedAt: null,
      reason: "timeout",
    });
    expect(signal?.aborted).toBe(true);
  });

  it("rejects malformed dates and holiday-type arrays", () => {
    expect(
      decodePublicHolidays([{ ...validResponse[0], date: "2026-02-31" }]),
    ).toBeNull();
    expect(
      decodePublicHolidays([{ ...validResponse[0], holidayTypes: [null] }]),
    ).toBeNull();
    expect(decodePublicHolidays({ data: validResponse })).toBeNull();
  });
});

describe("public-holiday caching", () => {
  function mockFetchSuccess() {
    return vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }

  function mockFetchInvalid() {
    return vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ ...validResponse[0], countryCode: "US" }]),
        { status: 200 },
      ),
    );
  }

  it("serves a cached result on the second call without re-fetching", async () => {
    const fetchImplementation = mockFetchSuccess();
    const service = createSouthAfricaPublicHolidayService({
      fetchImplementation,
      now: () => new Date("2026-08-14T10:00:00.000Z"),
    });

    const first = await service.execute(2026);
    const second = await service.execute(2026);

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(second).toEqual(first);
  });

  it("makes a separate fetch for a different year", async () => {
    const fetchImplementation = mockFetchSuccess();
    const service = createSouthAfricaPublicHolidayService({
      fetchImplementation,
      now: () => new Date("2026-08-14T10:00:00.000Z"),
    });

    await service.execute(2026);
    await service.execute(2027);

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("re-fetches after the cache TTL expires", async () => {
    let now = Date.parse("2026-08-14T10:00:00.000Z");
    const fetchImplementation = mockFetchSuccess();
    const service = createSouthAfricaPublicHolidayService({
      fetchImplementation,
      now: () => new Date(now),
      cacheTtlMs: 1000,
    });

    await service.execute(2026);
    expect(fetchImplementation).toHaveBeenCalledOnce();

    // Advance past the TTL.
    now += 1001;
    await service.execute(2026);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("does not cache a fallback result (retries on the next call)", async () => {
    const fetchImplementation = mockFetchInvalid();
    const service = createSouthAfricaPublicHolidayService({
      fetchImplementation,
    });

    const first = await service.execute(2026);
    expect(first.source).toBe("fallback");

    // Second call must still hit the network.
    const second = await service.execute(2026);
    expect(second.source).toBe("fallback");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("preserves the original retrievedAt in cached results", async () => {
    let now = Date.parse("2026-08-14T10:00:00.000Z");
    const fetchImplementation = mockFetchSuccess();
    const service = createSouthAfricaPublicHolidayService({
      fetchImplementation,
      now: () => new Date(now),
      cacheTtlMs: 10_000,
    });

    const first = await service.execute(2026);

    // Advance time within TTL.
    now += 5000;
    const second = await service.execute(2026);

    expect(first.source).toBe("external");
    expect(second.source).toBe("external");
    // The cached result retains the original fetch timestamp.
    if (first.source === "external" && second.source === "external") {
      expect(second.retrievedAt).toBe(first.retrievedAt);
    }
  });

  it("does not send any auth token, secret or database data to the external service", async () => {
    const fetchImplementation = mockFetchSuccess();
    const service = createSouthAfricaPublicHolidayService({
      fetchImplementation,
    });

    await service.execute(2026);

    const [url, init] = fetchImplementation.mock.calls[0] as [
      URL | string,
      RequestInit | undefined,
    ];
    const urlStr = url instanceof URL ? url.toString() : String(url);
    expect(urlStr).toBe("https://nagerholidays.com/api/v4/Holidays/ZA/2026");

    const headers = new Headers(init?.headers as HeadersInit);
    // Only safe, non-sensitive headers should be present.
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("user-agent")).toBe("Tutor-Mx/1.0");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();

    // No request body — the external service must not receive any data.
    expect(init?.body).toBeUndefined();
  });

  it("accepts an injectable cache for full control", async () => {
    const cache: TtlCache<ExternalApiResult<PublicHoliday[]>> =
      createTtlCache({ ttlMs: 60_000 });
    const fetchImplementation = mockFetchSuccess();
    const service = createSouthAfricaPublicHolidayService({
      fetchImplementation,
      cache,
      now: () => new Date("2026-08-14T10:00:00.000Z"),
    });

    // Pre-warm the cache with a synthetic entry.
    cache.set("2026", {
      source: "external",
      data: [{ date: "2026-12-25", name: "Cached Christmas", countryCode: "ZA", nationalHoliday: true, holidayTypes: ["Public"] }],
      retrievedAt: "2026-08-14T09:00:00.000Z",
    });

    const result = await service.execute(2026);

    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(result.source).toBe("external");
    if (result.source === "external") {
      expect(result.data[0].name).toBe("Cached Christmas");
      expect(result.retrievedAt).toBe("2026-08-14T09:00:00.000Z");
    }
  });
});

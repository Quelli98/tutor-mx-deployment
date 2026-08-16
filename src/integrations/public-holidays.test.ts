import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSouthAfricaPublicHolidayService,
  decodePublicHolidays,
  publicHolidayUrl,
} from "./public-holidays.js";

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

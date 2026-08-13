import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJsonExternalApiAdapter,
  executeExternalApi,
  ExternalApiRequestError,
} from "./external-api.js";

interface ExternalPayload {
  message: string;
}

const fallback: ExternalPayload = {
  message: "temporarily unavailable",
};

function decodeExternalPayload(value: unknown): ExternalPayload | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    // Deliberately select only the agreed safe field.
    return { message: value.message };
  }
  return null;
}

describe("executeExternalApi", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns only the decoded safe response with source time", async () => {
    const request = vi.fn().mockResolvedValue({
      message: "service available",
      privateSourceField: "must not escape",
    });

    const result = await executeExternalApi<ExternalPayload>({
      request,
      decode: decodeExternalPayload,
      fallback,
      timeoutMs: 1000,
      now: () => new Date("2030-09-01T12:00:00.000Z"),
    });

    expect(request).toHaveBeenCalledOnce();
    expect(result).toEqual({
      source: "external",
      data: { message: "service available" },
      retrievedAt: "2030-09-01T12:00:00.000Z",
    });
  });

  it("uses the fallback for an invalid response", async () => {
    const result = await executeExternalApi<ExternalPayload>({
      request: vi.fn().mockResolvedValue({ unexpected: true }),
      decode: decodeExternalPayload,
      fallback,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      source: "fallback",
      data: fallback,
      retrievedAt: null,
      reason: "invalid-response",
    });
  });

  it("uses the fallback after a network error", async () => {
    const result = await executeExternalApi<ExternalPayload>({
      request: vi.fn().mockRejectedValue(new Error("Network failure")),
      decode: decodeExternalPayload,
      fallback,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      source: "fallback",
      data: fallback,
      retrievedAt: null,
      reason: "network-error",
    });
  });

  it.each(["rate-limited", "unavailable", "http-error"] as const)(
    "preserves the controlled %s failure reason",
    async (reason) => {
      const result = await executeExternalApi<ExternalPayload>({
        request: vi
          .fn()
          .mockRejectedValue(
            new ExternalApiRequestError(reason, "Safe internal test error"),
          ),
        decode: decodeExternalPayload,
        fallback,
        timeoutMs: 1000,
      });

      expect(result).toEqual({
        source: "fallback",
        data: fallback,
        retrievedAt: null,
        reason,
      });
    },
  );

  it("aborts the request and uses the fallback after a timeout", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;

    const request = vi.fn((signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<never>(() => undefined);
    });

    const resultPromise = executeExternalApi<ExternalPayload>({
      request,
      decode: decodeExternalPayload,
      fallback,
      timeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toEqual({
      source: "fallback",
      data: fallback,
      retrievedAt: null,
      reason: "timeout",
    });
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("rejects an invalid timeout configuration", async () => {
    await expect(
      executeExternalApi({
        request: vi.fn(),
        decode: decodeExternalPayload,
        fallback,
        timeoutMs: 0,
      }),
    ).rejects.toThrow("timeoutMs");
  });
});

describe("createJsonExternalApiAdapter", () => {
  it("maps a successful JSON response and does not return extra fields", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: "safe", upstreamToken: "not returned" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const adapter = createJsonExternalApiAdapter({
      url: "https://service.example.invalid/data",
      decode: decodeExternalPayload,
      fallback,
      timeoutMs: 1000,
      fetchImplementation,
      now: () => new Date("2030-09-01T00:00:00.000Z"),
    });

    await expect(adapter.execute()).resolves.toEqual({
      source: "external",
      data: { message: "safe" },
      retrievedAt: "2030-09-01T00:00:00.000Z",
    });
  });

  it.each([
    [429, "rate-limited"],
    [503, "unavailable"],
    [400, "http-error"],
  ] as const)("maps HTTP %i to %s", async (status, reason) => {
    const adapter = createJsonExternalApiAdapter({
      url: "https://service.example.invalid/data",
      decode: decodeExternalPayload,
      fallback,
      timeoutMs: 1000,
      fetchImplementation: vi
        .fn()
        .mockResolvedValue(new Response("failure", { status })),
    });

    await expect(adapter.execute()).resolves.toEqual({
      source: "fallback",
      data: fallback,
      retrievedAt: null,
      reason,
    });
  });

  it("uses the fallback when the response is not valid JSON", async () => {
    const adapter = createJsonExternalApiAdapter({
      url: "https://service.example.invalid/data",
      decode: decodeExternalPayload,
      fallback,
      timeoutMs: 1000,
      fetchImplementation: vi
        .fn()
        .mockResolvedValue(new Response("not-json", { status: 200 })),
    });

    await expect(adapter.execute()).resolves.toMatchObject({
      source: "fallback",
      reason: "invalid-response",
    });
  });
});

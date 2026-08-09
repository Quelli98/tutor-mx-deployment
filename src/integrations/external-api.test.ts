import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeExternalApi,
  ExternalApiRequestError,
} from "./external-api.js";

interface ExternalPayload {
  message: string;
}

const fallback: ExternalPayload = {
  message: "temporarily unavailable",
};

function isExternalPayload(value: unknown): value is ExternalPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

describe("executeExternalApi", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a validated external response", async () => {
    const request = vi.fn().mockResolvedValue({
      message: "service available",
    });

    const result = await executeExternalApi<ExternalPayload>({
      request,
      validate: isExternalPayload,
      fallback,
      timeoutMs: 1000,
    });

    expect(request).toHaveBeenCalledOnce();
    expect(result).toEqual({
      source: "external",
      data: {
        message: "service available",
      },
    });
  });

  it("uses the fallback for an invalid response", async () => {
    const result = await executeExternalApi<ExternalPayload>({
      request: vi.fn().mockResolvedValue({
        unexpected: true,
      }),
      validate: isExternalPayload,
      fallback,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      source: "fallback",
      data: fallback,
      reason: "invalid-response",
    });
  });

  it("uses the fallback after a network error", async () => {
    const result = await executeExternalApi<ExternalPayload>({
      request: vi.fn().mockRejectedValue(new Error("Network failure")),
      validate: isExternalPayload,
      fallback,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      source: "fallback",
      data: fallback,
      reason: "network-error",
    });
  });

  it("uses the fallback after an HTTP error", async () => {
    const result = await executeExternalApi<ExternalPayload>({
      request: vi
        .fn()
        .mockRejectedValue(
          new ExternalApiRequestError(
            "http-error",
            "External service returned HTTP 503",
          ),
        ),
      validate: isExternalPayload,
      fallback,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      source: "fallback",
      data: fallback,
      reason: "http-error",
    });
  });

  it("aborts the request and uses the fallback after a timeout", async () => {
    vi.useFakeTimers();

    let receivedSignal: AbortSignal | undefined;

    const request = vi.fn((signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<never>(() => undefined);
    });

    const resultPromise = executeExternalApi<ExternalPayload>({
      request,
      validate: isExternalPayload,
      fallback,
      timeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toEqual({
      source: "fallback",
      data: fallback,
      reason: "timeout",
    });

    expect(receivedSignal?.aborted).toBe(true);
  });
});
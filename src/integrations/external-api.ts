export type ExternalApiFailureReason =
  | "timeout"
  | "rate-limited"
  | "unavailable"
  | "invalid-response"
  | "http-error"
  | "network-error";

export type ExternalApiResult<T> =
  | {
      source: "external";
      data: T;
      retrievedAt: string;
    }
  | {
      source: "fallback";
      data: T;
      retrievedAt: null;
      reason: ExternalApiFailureReason;
    };

export type ExternalApiDecoder<T> = (value: unknown) => T | null;

export interface ExternalApiAdapter<TInput, TOutput> {
  execute(input: TInput): Promise<ExternalApiResult<TOutput>>;
}

export interface ExternalApiExecutionOptions<T> {
  request: (signal: AbortSignal) => Promise<unknown>;
  decode: ExternalApiDecoder<T>;
  fallback: T;
  timeoutMs: number;
  now?: () => Date;
}

export interface JsonExternalApiOptions<T> {
  url: string | URL;
  decode: ExternalApiDecoder<T>;
  fallback: T;
  timeoutMs: number;
  headers?: Readonly<Record<string, string>>;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
}

export class ExternalApiRequestError extends Error {
  readonly reason: ExternalApiFailureReason;

  constructor(reason: ExternalApiFailureReason, message: string) {
    super(message);
    this.name = "ExternalApiRequestError";
    this.reason = reason;
  }
}

function failureReasonForStatus(status: number): ExternalApiFailureReason {
  if (status === 429) {
    return "rate-limited";
  }
  if (status >= 500) {
    return "unavailable";
  }
  return "http-error";
}

export async function executeExternalApi<T>(
  options: ExternalApiExecutionOptions<T>,
): Promise<ExternalApiResult<T>> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be greater than zero");
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(
          new ExternalApiRequestError(
            "timeout",
            `External API request timed out after ${options.timeoutMs}ms`,
          ),
        );
      }, options.timeoutMs);
    });

    const value = await Promise.race([
      options.request(controller.signal),
      timeout,
    ]);
    const decoded = options.decode(value);

    if (decoded === null) {
      return {
        source: "fallback",
        data: options.fallback,
        retrievedAt: null,
        reason: "invalid-response",
      };
    }

    return {
      source: "external",
      data: decoded,
      retrievedAt: (options.now ?? (() => new Date()))().toISOString(),
    };
  } catch (error) {
    const reason =
      error instanceof ExternalApiRequestError
        ? error.reason
        : "network-error";

    return {
      source: "fallback",
      data: options.fallback,
      retrievedAt: null,
      reason,
    };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function createJsonExternalApiAdapter<T>(
  options: JsonExternalApiOptions<T>,
): ExternalApiAdapter<void, T> {
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return {
    async execute(): Promise<ExternalApiResult<T>> {
      return executeExternalApi({
        timeoutMs: options.timeoutMs,
        fallback: options.fallback,
        decode: options.decode,
        now: options.now,
        request: async (signal) => {
          const response = await fetchImplementation(options.url, {
            method: "GET",
            headers: options.headers,
            signal,
            redirect: "error",
          });

          if (!response.ok) {
            throw new ExternalApiRequestError(
              failureReasonForStatus(response.status),
              `External service returned HTTP ${response.status}`,
            );
          }

          try {
            return await response.json();
          } catch {
            throw new ExternalApiRequestError(
              "invalid-response",
              "External service did not return valid JSON",
            );
          }
        },
      });
    },
  };
}

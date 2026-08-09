export type ExternalApiFailureReason =
  | "timeout"
  | "invalid-response"
  | "http-error"
  | "network-error";

export type ExternalApiResult<T> =
  | {
      source: "external";
      data: T;
    }
  | {
      source: "fallback";
      data: T;
      reason: ExternalApiFailureReason;
    };

export type ExternalApiValidator<T> = (value: unknown) => value is T;

export interface ExternalApiAdapter<TInput, TOutput> {
  execute(input: TInput): Promise<ExternalApiResult<TOutput>>;
}

export interface ExternalApiExecutionOptions<T> {
  request: (signal: AbortSignal) => Promise<unknown>;
  validate: ExternalApiValidator<T>;
  fallback: T;
  timeoutMs: number;
}

export class ExternalApiRequestError extends Error {
  readonly reason: Exclude<
    ExternalApiFailureReason,
    "invalid-response"
  >;

  constructor(
    reason: Exclude<ExternalApiFailureReason, "invalid-response">,
    message: string,
  ) {
    super(message);
    this.name = "ExternalApiRequestError";
    this.reason = reason;
  }
}
export async function executeExternalApi<T>(
  options: ExternalApiExecutionOptions<T>,
): Promise<ExternalApiResult<T>> {
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

    if (!options.validate(value)) {
      return {
        source: "fallback",
        data: options.fallback,
        reason: "invalid-response",
      };
    }

    return {
      source: "external",
      data: value,
    };
  } catch (error) {
    const reason =
      error instanceof ExternalApiRequestError
        ? error.reason
        : "network-error";

    return {
      source: "fallback",
      data: options.fallback,
      reason,
    };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
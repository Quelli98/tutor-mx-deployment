export type UnhandledErrorSource =
  | "route"
  | "profile_role_middleware"
  | "final_error_handler";

// Nothing mapped this error, so the client gets the generic INTERNAL_ERROR reply
// and the cause would otherwise be lost. It is recorded server-side only: no part
// of this log is added to the response.
export function logUnhandledError(
  source: UnhandledErrorSource,
  request: { method?: string; path?: string } | undefined,
  value: unknown,
) {
  console.error(
    JSON.stringify({
      event: "unhandled_route_error",
      source,
      method: request?.method,
      path: request?.path,
      name: value instanceof Error ? value.name : typeof value,
      message: value instanceof Error ? value.message : String(value),
      code:
        typeof value === "object" && value !== null && "code" in value
          ? String((value as { code?: unknown }).code)
          : undefined,
      stack: value instanceof Error ? value.stack : undefined,
    }),
  );
}

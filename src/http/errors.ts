export interface RouteError extends Error { status: number; code: string; }
// Only deliberately constructed public errors may expose their message.
const publicRouteErrors = new WeakSet<Error>();

export function createRouteError(
  status: number,
  code: string,
  message: string,
): RouteError {
  const routeError = new Error(message) as RouteError;
  routeError.status = status;
  routeError.code = code;
  publicRouteErrors.add(routeError);
  return routeError;
}

export function isRouteError(value: unknown): value is RouteError {
  return (
    typeof value === "object" &&
    value !== null &&
    value instanceof Error &&
    publicRouteErrors.has(value) &&
    "status" in value &&
    typeof (value as RouteError).status === "number" &&
    "code" in value &&
    typeof (value as RouteError).code === "string"
  );
}


export function sanitizeError(value: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (isRouteError(value)) return { status: value.status, body: { error: { code: value.code, message: value.message } } };
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } } };
}

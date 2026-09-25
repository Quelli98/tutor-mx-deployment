import { createRouteError } from "./errors.js";

export const MAX_REPORT_ROWS = 5_000;
export const MAX_PAYROLL_ROWS = 10_000;
export const MAX_CANDIDATES = 2_000;
/** Fail explicitly instead of showing incomplete totals or a partial ranking. */
export function assertResultLimit(rows: readonly unknown[], maximum: number, label: string): void {
  if (rows.length > maximum) throw createRouteError(422, "RESULT_LIMIT_EXCEEDED", `${label} exceeds the safe limit of ${maximum} rows. Narrow the selection before trying again.`);
}

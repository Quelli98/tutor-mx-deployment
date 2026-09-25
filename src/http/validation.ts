/** PostgreSQL integer IDs and bounded offsets; never coerce arrays or objects. */
export const MAX_PAGE = 10_000;
export const MAX_DATABASE_ID = 2_147_483_647;
export function boundedInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}
export function parsePage(value: unknown, fallback = 1, maximum = MAX_PAGE): number | null {
  return value === undefined ? fallback : boundedInteger(value, 1, maximum);
}
export function matchesVersion(actual: string, expected: unknown): boolean {
  return typeof expected === 'string' && expected.length > 0 && expected.length <= 64 && actual === expected;
}
export function permitsTransition(current: string, expected: string, next: string, allowed: Record<string, readonly string[]>): boolean {
  return current === expected && Boolean(allowed[current]?.includes(next));
}

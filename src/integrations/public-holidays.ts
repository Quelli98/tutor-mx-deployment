/**
 * @module integrations/public-holidays
 *
 * S2-M6-2 PRODUCTION CONTRACT
 *
 * ── Backend route ───────────────────────────────────────────────────────
 * Path:  GET /api/public-holidays?year=<YYYY>
 *   • Auth: authenticate + resolveProfileRole + requireTutorMxRole
 *     (all authenticated roles may read public-holiday data).
 *   • Parse `year` from query string (4-digit integer, 2000–2100).
 *   • The server delegates through `AppDependencies` to one cached service
 *     instance created by `createSouthAfricaPublicHolidayService()`.
 *   • Response envelope:  { data: { source, holidays, retrievedAt, reason? } }
 *     where `source` is "external" | "fallback" so the browser knows
 *     whether the data is live or stale.
 *   • The external call is server-only; the browser never contacts
 *     Nager.Date directly.
 *
 * ── Safe fields for the UI ──────────────────────────────────────────────
 * Each holiday object exposes only:
 *   • date           — ISO date string ("2026-01-01")
 *   • name           — "New Year's Day"
 *   • countryCode    — always "ZA"
 *   • nationalHoliday— boolean
 *   • holidayTypes   — string[], e.g. ["Public"]
 * Plus the result envelope:
 *   • source         — "external" | "fallback"
 *   • retrievedAt    — ISO timestamp or null (fallback)
 *   • reason?        — failure reason when source === "fallback"
 * Render a "Data from external service / fallback" badge based on `source`
 * and display `retrievedAt` so the user sees how fresh the list is.
 * NEVER render `reason` as user-facing text — it is an internal code.
 */

import {
  createJsonExternalApiAdapter,
  type ExternalApiAdapter,
  type ExternalApiResult,
} from "./external-api.js";
import { createTtlCache, type TtlCache } from "./ttl-cache.js";

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1 hour — holiday data rarely changes
const MIN_SUPPORTED_YEAR = 2000;
const MAX_SUPPORTED_YEAR = 2100;

export interface PublicHoliday {
  date: string;
  name: string;
  countryCode: "ZA";
  nationalHoliday: boolean;
  holidayTypes: string[];
}

export interface PublicHolidayServiceOptions {
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
  /** Injectable cache; defaults to an in-memory TTL cache (1 hour). */
  cache?: TtlCache<ExternalApiResult<PublicHoliday[]>>;
  /** Override the default cache TTL in milliseconds. */
  cacheTtlMs?: number;
}

export type SouthAfricaPublicHolidayService = ExternalApiAdapter<
  number,
  PublicHoliday[]
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

function decodeHolidayType(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 40
    ? value
    : null;
}

export function decodePublicHolidays(value: unknown): PublicHoliday[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const holidays: PublicHoliday[] = [];

  for (const item of value) {
    if (
      !isRecord(item) ||
      !isIsoDate(item.date) ||
      typeof item.name !== "string" ||
      item.name.length === 0 ||
      item.name.length > 160 ||
      item.countryCode !== "ZA" ||
      typeof item.nationalHoliday !== "boolean" ||
      !Array.isArray(item.holidayTypes)
    ) {
      return null;
    }

    const holidayTypes = item.holidayTypes.map(decodeHolidayType);
    if (holidayTypes.some((type) => type === null)) {
      return null;
    }

    holidays.push({
      date: item.date,
      name: item.name,
      countryCode: "ZA",
      nationalHoliday: item.nationalHoliday,
      holidayTypes: holidayTypes as string[],
    });
  }

  return holidays;
}

function assertSupportedYear(year: number): void {
  if (
    !Number.isInteger(year) ||
    year < MIN_SUPPORTED_YEAR ||
    year > MAX_SUPPORTED_YEAR
  ) {
    throw new RangeError(
      `year must be an integer from ${MIN_SUPPORTED_YEAR} to ${MAX_SUPPORTED_YEAR}`,
    );
  }
}

export function publicHolidayUrl(year: number): URL {
  assertSupportedYear(year);
  return new URL(`https://nagerholidays.com/api/v4/Holidays/ZA/${year}`);
}

export function createSouthAfricaPublicHolidayService(
  options: PublicHolidayServiceOptions = {},
): SouthAfricaPublicHolidayService {
  const nowFn = options.now ?? (() => new Date());
  const cache =
    options.cache ??
    createTtlCache<ExternalApiResult<PublicHoliday[]>>({
      ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      now: () => nowFn().valueOf(),
    });

  return {
    async execute(year: number): Promise<ExternalApiResult<PublicHoliday[]>> {
      const cacheKey = String(year);
      const cached = cache.get(cacheKey);
      if (cached !== null) {
        return cached;
      }

      const adapter = createJsonExternalApiAdapter<PublicHoliday[]>({
        url: publicHolidayUrl(year),
        decode: decodePublicHolidays,
        fallback: [],
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        fetchImplementation: options.fetchImplementation,
        now: nowFn,
        headers: {
          accept: "application/json",
          "user-agent": "Tutor-Mx/1.0",
        },
      });

      const result = await adapter.execute();

      if (result.source === "external") {
        cache.set(cacheKey, result);
      }

      return result;
    },
  };
}

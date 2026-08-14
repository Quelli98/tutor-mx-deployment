import {
  createJsonExternalApiAdapter,
  type ExternalApiAdapter,
  type ExternalApiResult,
} from "./external-api.js";

const DEFAULT_TIMEOUT_MS = 3_000;
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
  return {
    async execute(year: number): Promise<ExternalApiResult<PublicHoliday[]>> {
      const adapter = createJsonExternalApiAdapter<PublicHoliday[]>({
        url: publicHolidayUrl(year),
        decode: decodePublicHolidays,
        fallback: [],
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        fetchImplementation: options.fetchImplementation,
        now: options.now,
        headers: {
          accept: "application/json",
          "user-agent": "Tutor-Mx/1.0",
        },
      });

      return adapter.execute();
    },
  };
}

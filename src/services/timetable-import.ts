/**
 * Timetable import for the tutor schedule (Sprint 3, card S3-M3-1).
 *
 * A tutor can paste or upload a timetable (CSV/TSV, or an .ics file) instead of
 * typing every schedule entry by hand. This module turns that text into the
 * payloads the existing schedule already accepts.
 *
 * Deliberate constraints, so the import does not become a second schedule:
 *
 * - It writes ordinary "TimeSlot" rows with the existing columns. There is no
 *   import-specific column, so an imported entry cannot be told apart from a
 *   hand-entered one by the allocation clash queries, by the tutor's schedule
 *   view, or by anything else.
 * - Every row is validated and normalised by the same rules the manual form
 *   uses (src/services/time-slot-rules.ts). The import cannot invent a rule of
 *   its own, and it cannot accept something the manual form would reject.
 * - It produces UTC instants only. Wall-clock text is interpreted in an
 *   explicit IANA time zone supplied by the caller, so the same file always
 *   means the same instants regardless of where the server runs.
 * - Recurrence stops at the end of the academic term. An open-ended weekly
 *   entry would silently block allocation forever if a repeat-until date were
 *   mistyped or omitted.
 *
 * Rows are reported individually. One bad row never rejects the file: the row
 * carries its own error, and the other rows stay usable.
 */

import {
  checkTimeSlotRules,
  MAX_TIME_SLOT_LABEL_LENGTH,
} from "./time-slot-rules.js";

export type TimetableImportSource = "CSV" | "ICS";

/** Scheduled busy blocks only. Reaches the same payload shape as the manual form. */
export const IMPORT_TIME_SLOT_TYPE = "BUSY" as const;

/** Enough for any realistic personal timetable, and small enough to stay well
 *  inside the API's 32kb JSON body limit. */
export const MAX_IMPORT_ROWS = 400;

/** Approximately 32kb of body minus room for the surrounding JSON envelope. */
export const MAX_IMPORT_TEXT_LENGTH = 30_000;

export interface AcademicTermBounds {
  id: number;
  name: string;
  /** Inclusive first day, YYYY-MM-DD. */
  startsOn: string;
  /** Inclusive last day, YYYY-MM-DD. */
  endsOn: string;
}

/** The exact payload shape the existing schedule write path accepts. */
export interface ImportedTimeSlotPayload {
  type: typeof IMPORT_TIME_SLOT_TYPE;
  startsAt: string;
  endsAt: string;
  recurrence?: "WEEKLY";
  label: string | null;
  recurrenceUntil: string | null;
}

export interface TimetableImportRow {
  /** 1-based source line (CSV/paste) or VEVENT index (ICS). */
  sourceRow: number;
  /** IANA zone this row's wall clock was read in. */
  timeZone: string;
  /** Wall clock exactly as the tutor wrote it, for the preview. */
  localStartsAt: string | null;
  localEndsAt: string | null;
  /** Last day the weekly pattern repeats, as a local calendar date. */
  localRecurrenceUntil: string | null;
  label: string | null;
  recurrence: "WEEKLY" | "ONCE";
  /**
   * True when the schedule already holds this exact entry. Only the persistence
   * layer can know this, so it is always false from the pure parser and is set
   * when the preview or the commit compares against the saved schedule.
   */
  duplicate: boolean;
  /** Null whenever the row has any error; such a row is never saved. */
  slot: ImportedTimeSlotPayload | null;
  errors: string[];
}

export interface TimetableImportPreview {
  source: TimetableImportSource;
  timeZone: string;
  term: AcademicTermBounds;
  rows: TimetableImportRow[];
  /** Rows that can be saved as they stand. */
  validCount: number;
  /** Rows carrying a row-level error. */
  invalidCount: number;
  /** Rows that match an entry already in the schedule. */
  duplicateCount: number;
}

/** A timetable to read, plus the term that bounds how far it may repeat. */
export interface TimetableImportInput {
  source: TimetableImportSource;
  text: string;
  timeZone: string;
  term: AcademicTermBounds;
}

/**
 * What the API accepts. The term is named by id only: the bounds are reloaded
 * from the database so a caller cannot widen a term to smuggle in a
 * repeat-until date that outlives it.
 */
export interface TimetableImportRequest {
  source: TimetableImportSource;
  text: string;
  timeZone: string;
  termId: number;
}

/** Reasonable header aliases, normalised to letters only before matching. */
const LABEL_HEADERS = [
  "label",
  "description",
  "title",
  "name",
  "activity",
  "module",
  "course",
  "subject",
];
const DATE_HEADERS = ["date", "sessiondate", "startdate"];
const START_HEADERS = ["start", "starttime", "from", "begins"];
const END_HEADERS = ["end", "endtime", "to", "finish", "finishes"];
const STARTS_AT_HEADERS = ["startsat", "startdatetime", "startson"];
const ENDS_AT_HEADERS = ["endsat", "enddatetime", "endson"];
const REPEAT_HEADERS = ["repeat", "recurrence", "frequency", "weekly"];
const UNTIL_HEADERS = ["until", "repeatuntil", "repeatsuntil", "lastdate"];
const CATEGORY_HEADERS = ["category", "type", "kind"];

/** Category values that all mean "this time is not available". */
const BUSY_CATEGORIES = new Set(["", "busy", "unavailable", "class", "study"]);

const WEEKLY_VALUES = new Set(["weekly", "every week", "week", "yes", "true", "1"]);
const ONCE_VALUES = new Set(["", "once", "one-off", "oneoff", "no", "false", "0", "single"]);

const HEADER_HINT =
  `Name the columns in the first line. Accepted: date, start, end (or startsAt and endsAt), ` +
  `and optionally ${LABEL_HEADERS[0]}, repeat, until, category.`;

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

/**
 * Returns the zone when the runtime recognises it, otherwise null. Uses Intl
 * itself so the check agrees with the conversion below.
 */
export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return null;
  }
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = zoneFormatters.get(timeZone);
  if (existing) {
    return existing;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  zoneFormatters.set(timeZone, formatter);
  return formatter;
}

/**
 * How far ahead of UTC the zone is at a given instant, in milliseconds.
 */
function zoneOffsetAt(instant: number, timeZone: string): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(instant));
  const read: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      read[part.type] = Number(part.value);
    }
  }
  // "24" appears for midnight under hour12:false in some engines.
  const hour = read.hour === 24 ? 0 : (read.hour ?? 0);
  const wallClock = Date.UTC(
    read.year ?? 1970,
    (read.month ?? 1) - 1,
    read.day ?? 1,
    hour,
    read.minute ?? 0,
    read.second ?? 0,
  );
  return wallClock - Math.floor(instant / 1000) * 1000;
}

/**
 * Turns a wall clock in a named zone into the real instant.
 *
 * The offset is probed twice because the offset at the guessed instant can
 * differ from the offset at the naive reading across a daylight-saving change.
 * Where a wall clock is ambiguous (clocks going back) the earlier instant wins;
 * where it does not exist (clocks going forward) the closest valid instant is
 * used. Both are deterministic, which is what matters for an import preview.
 * Zones without daylight saving, including Africa/Johannesburg, are exact.
 */
export function zonedWallClockToUtc(
  wallClock: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timeZone: string,
): Date {
  const naive = Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute,
    wallClock.second ?? 0,
  );
  const firstGuess = naive - zoneOffsetAt(naive, timeZone);
  const settled = naive - zoneOffsetAt(firstGuess, timeZone);
  return new Date(settled);
}

/**
 * The last representable instant of a local calendar day. Used as the inclusive
 * repeat-until bound, because the clash query includes an occurrence that
 * starts exactly at the bound.
 */
export function lastInstantOfLocalDay(
  dateOnly: string,
  timeZone: string,
): Date | null {
  const parsed = parseDateOnly(dateOnly);
  if (!parsed) {
    return null;
  }
  const nextDay = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day) + 86_400_000,
  );
  const startOfNextDay = zonedWallClockToUtc(
    {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
      hour: 0,
      minute: 0,
    },
    timeZone,
  );
  return new Date(startOfNextDay.valueOf() - 1);
}

// ---------------------------------------------------------------------------
// Scalar parsing
// ---------------------------------------------------------------------------

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseDateOnly(value: string): CalendarDate | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  // Reject 31 February and friends by round-tripping through UTC.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatDateOnly(date: CalendarDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

interface ClockTime {
  hour: number;
  minute: number;
  second: number;
}

function parseClockTime(value: string): ClockTime | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: match[3] ? Number(match[3]) : 0,
  };
}

function formatClockTime(time: ClockTime): string {
  const hour = String(time.hour).padStart(2, "0");
  const minute = String(time.minute).padStart(2, "0");
  return `${hour}:${minute}`;
}

/** Splits "YYYY-MM-DD HH:mm" / "YYYY-MM-DDTHH:mm" into its two halves. */
function splitDateTime(value: string): { date: string; time: string } | null {
  const match = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[T ](\d{1,2}:\d{2}(?::\d{2})?)$/.exec(
    value.trim(),
  );
  if (!match) {
    return null;
  }
  return { date: match[1]!, time: match[2]! };
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstMatchingIndex(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Delimited text (CSV, TSV, spreadsheet paste)
// ---------------------------------------------------------------------------

interface DelimitedRecord {
  /** Physical line where the record starts, 1-based. */
  sourceRow: number;
  fields: string[];
}

/** Picks the delimiter from the header line so a spreadsheet paste just works. */
function detectDelimiter(text: string, delimiterOverride?: string): string {
  if (delimiterOverride) {
    return delimiterOverride;
  }
  const firstLine =
    text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  if (firstLine.includes("\t")) {
    return "\t";
  }
  if (firstLine.includes(";") && !firstLine.includes(",")) {
    return ";";
  }
  return ",";
}

/**
 * Reads delimited text with quoted fields, doubled quotes and embedded
 * newlines. Each record keeps the line it started on so row errors point
 * somewhere the tutor can find.
 */
function readDelimitedRecords(
  text: string,
  delimiter: string,
): DelimitedRecord[] {
  const records: DelimitedRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const pushField = () => {
    fields.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    if (fields.some((value) => value.trim().length > 0)) {
      records.push({ sourceRow: started ? recordLine : line, fields });
    }
    fields = [];
    started = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (!started && character !== "\n" && character !== "\r") {
      started = true;
      recordLine = line;
    }

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (character === "\n") {
          line += 1;
        }
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === delimiter) {
      pushField();
    } else if (character === "\r") {
      // Swallow; the \n branch ends the record.
    } else if (character === "\n") {
      pushRecord();
      line += 1;
    } else {
      field += character;
    }
  }

  if (field.length > 0 || fields.length > 0) {
    pushRecord();
  }

  return records;
}

interface RawRow {
  sourceRow: number;
  timeZone: string;
  label: string;
  date: string;
  start: string;
  end: string;
  repeat: string;
  until: string;
  category: string;
  errors: string[];
}

function readDelimitedRows(
  text: string,
  timeZone: string,
): { rows: RawRow[] } | { error: string } {
  const records = readDelimitedRecords(text, detectDelimiter(text));
  if (records.length === 0) {
    return { error: "There was nothing to import. Paste a timetable or choose a file with rows." };
  }

  const headers = records[0]!.fields.map(normalizeHeader);
  const labelIndex = firstMatchingIndex(headers, LABEL_HEADERS);
  const dateIndex = firstMatchingIndex(headers, DATE_HEADERS);
  const startIndex = firstMatchingIndex(headers, START_HEADERS);
  const endIndex = firstMatchingIndex(headers, END_HEADERS);
  const startsAtIndex = firstMatchingIndex(headers, STARTS_AT_HEADERS);
  const endsAtIndex = firstMatchingIndex(headers, ENDS_AT_HEADERS);
  const repeatIndex = firstMatchingIndex(headers, REPEAT_HEADERS);
  const untilIndex = firstMatchingIndex(headers, UNTIL_HEADERS);
  const categoryIndex = firstMatchingIndex(headers, CATEGORY_HEADERS);

  const combinedForm = startsAtIndex !== -1 && endsAtIndex !== -1;
  const separateForm =
    dateIndex !== -1 && startIndex !== -1 && endIndex !== -1;

  if (!combinedForm && !separateForm) {
    // A missing column cannot be blamed on one row, so this is the only
    // whole-file rejection. Everything else is reported per row.
    return { error: HEADER_HINT };
  }

  const cell = (fields: string[], index: number): string =>
    index === -1 ? "" : (fields[index] ?? "").trim();

  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    return {
      error: `Import at most ${MAX_IMPORT_ROWS} rows at a time. This file had ${dataRecords.length}.`,
    };
  }

  const rows = dataRecords.map((record) => {
    const { fields } = record;
    let date = "";
    let start = "";
    let end = "";

    if (combinedForm) {
      const startValue = cell(fields, startsAtIndex);
      const endValue = cell(fields, endsAtIndex);
      const startsAt = splitDateTime(startValue);
      const endsAt = splitDateTime(endValue);
      if (startsAt) {
        date = startsAt.date;
        start = startsAt.time;
      }
      if (endsAt) {
        // The end may cross midnight; keep only its clock time.
        end = endsAt.time;
      }
      if (!startsAt || !endsAt) {
        return {
          sourceRow: record.sourceRow,
          timeZone,
          label: cell(fields, labelIndex),
          date: startsAt?.date ?? "",
          start: start || cell(fields, startsAtIndex),
          end: end || cell(fields, endsAtIndex),
          repeat: cell(fields, repeatIndex),
          until: cell(fields, untilIndex),
          category: cell(fields, categoryIndex),
          errors: [
            `Enter the start and end as "YYYY-MM-DD HH:MM" (found "${startValue}" and "${endValue}").`,
          ],
        } satisfies RawRow;
      }
    } else {
      date = cell(fields, dateIndex);
      start = cell(fields, startIndex);
      end = cell(fields, endIndex);
    }

    return {
      sourceRow: record.sourceRow,
      timeZone,
      label: cell(fields, labelIndex),
      date,
      start,
      end,
      repeat: cell(fields, repeatIndex),
      until: cell(fields, untilIndex),
      category: cell(fields, categoryIndex),
      errors: [],
    } satisfies RawRow;
  });

  return { rows };
}

// ---------------------------------------------------------------------------
// iCalendar (.ics)
// ---------------------------------------------------------------------------

/** RFC 5545 line folding: a leading space or tab continues the previous line. */
function unfoldIcsLines(text: string): IcsLine[] {
  const lines: IcsLine[] = [];
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    if (/^[ \t]/.test(rawLine) && lines.length > 0) {
      lines[lines.length - 1]!.value += rawLine.slice(1);
      continue;
    }
    lines.push({ value: rawLine, sourceRow: lines.length + 1 });
  }
  return lines;
}

interface IcsLine {
  value: string;
  sourceRow: number;
}

interface IcsProperty {
  name: string;
  parameters: Record<string, string>;
  value: string;
  sourceRow: number;
}

function parseIcsProperty(line: IcsLine): IcsProperty | null {
  const separator = line.value.indexOf(":");
  if (separator === -1) {
    return null;
  }
  const left = line.value.slice(0, separator);
  const value = line.value.slice(separator + 1);
  const segments = left.split(";");
  const name = (segments[0] ?? "").trim().toUpperCase();
  if (!name) {
    return null;
  }
  const parameters: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const equals = segment.indexOf("=");
    if (equals !== -1) {
      parameters[segment.slice(0, equals).trim().toUpperCase()] = segment
        .slice(equals + 1)
        .trim();
    }
  }
  return { name, parameters, value, sourceRow: line.sourceRow };
}

interface IcsDateValue {
  /** UTC instant when the value carried a zone or a Z suffix. */
  instant: Date | null;
  /** Wall clock when the value was floating or carried a TZID. */
  wallClock: { date: CalendarDate; time: ClockTime } | null;
  /** Zone to read wallClock in: a TZID, or null for floating. */
  timeZone: string | null;
  error: string | null;
}

function parseIcsDate(
  property: IcsProperty,
  fallbackTimeZone: string,
): IcsDateValue {
  const value = property.value.trim();
  const valueType = property.parameters.VALUE?.toUpperCase();
  if (valueType === "DATE" || /^\d{8}$/.test(value)) {
    return {
      instant: null,
      wallClock: null,
      timeZone: null,
      error: "All-day entries have no start time. Add times or enter this one by hand.",
    };
  }

  const match = /^(\d{8})T(\d{6})(Z)?$/.exec(value);
  if (!match) {
    return {
      instant: null,
      wallClock: null,
      timeZone: null,
      error: `Could not read the date and time "${value}".`,
    };
  }

  const date = parseDateOnly(
    `${match[1]!.slice(0, 4)}-${match[1]!.slice(4, 6)}-${match[1]!.slice(6, 8)}`,
  );
  const time: ClockTime = {
    hour: Number(match[2]!.slice(0, 2)),
    minute: Number(match[2]!.slice(2, 4)),
    second: Number(match[2]!.slice(4, 6)),
  };
  if (!date || time.hour > 23 || time.minute > 59) {
    return {
      instant: null,
      wallClock: null,
      timeZone: null,
      error: `Could not read the date and time "${value}".`,
    };
  }

  if (match[3]) {
    return {
      instant: zonedWallClockToUtc(
        { ...date, ...time },
        "UTC",
      ),
      wallClock: null,
      timeZone: "UTC",
      error: null,
    };
  }

  const tzid = property.parameters.TZID;
  if (tzid) {
    const zone = normalizeTimeZone(tzid);
    if (!zone) {
      return {
        instant: null,
        wallClock: null,
        timeZone: null,
        error: `The time zone "${tzid}" is not supported. Replace it with a plain time.`,
      };
    }
    return { instant: null, wallClock: { date, time }, timeZone: zone, error: null };
  }

  return {
    instant: null,
    wallClock: { date, time },
    timeZone: fallbackTimeZone,
    error: null,
  };
}

/** ISO-8601 duration limited to days, hours and minutes: P1DT2H30M. */
function parseIcsDuration(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value.trim().toUpperCase());
  if (!match || (!match[1] && !match[2] && !match[3])) {
    return null;
  }
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return days * 86_400_000 + hours * 3_600_000 + minutes * 60_000;
}

function readIcsRows(
  text: string,
  fallbackTimeZone: string,
): { rows: RawRow[] } | { error: string } {
  const lines = unfoldIcsLines(text);
  const rows: RawRow[] = [];
  let eventIndex = 0;
  let inEvent = false;
  let current: { properties: IcsProperty[] } | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    eventIndex += 1;
    rows.push(mapEvent(current, eventIndex, fallbackTimeZone));
    current = null;
  };

  for (const line of lines) {
    const upper = line.value.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inEvent = true;
      current = { properties: [] };
      continue;
    }
    if (upper === "END:VEVENT") {
      flush();
      inEvent = false;
      continue;
    }
    if (!inEvent || !current) {
      // Skips VTIMEZONE and every other block, which carry their own DTSTART.
      continue;
    }
    const property = parseIcsProperty(line);
    if (property) {
      current.properties.push(property);
    }
  }
  flush();

  if (rows.length === 0) {
    return {
      error: "No calendar events were found. Choose a calendar file that contains events with times.",
    };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      error: `Import at most ${MAX_IMPORT_ROWS} events at a time. This file had ${rows.length}.`,
    };
  }

  return { rows };
}

/** Resolves an iCalendar date property to the real instant it denotes. */
function resolveIcsInstant(
  parsed: IcsDateValue,
  fallbackTimeZone: string,
): Date | null {
  if (parsed.instant) {
    return parsed.instant;
  }
  if (parsed.wallClock) {
    return zonedWallClockToUtc(
      { ...parsed.wallClock.date, ...parsed.wallClock.time },
      parsed.timeZone ?? fallbackTimeZone,
    );
  }
  return null;
}

function mapEvent(
  event: { properties: IcsProperty[] },
  eventIndex: number,
  fallbackTimeZone: string,
): RawRow {
  const errors: string[] = [];
  const byName = new Map<string, IcsProperty>();
  for (const property of event.properties) {
    if (!byName.has(property.name)) {
      byName.set(property.name, property);
    }
  }

  const label = (byName.get("SUMMARY")?.value ?? "").replace(/\\,/g, ",").trim();

  const startProperty = byName.get("DTSTART");
  const endProperty = byName.get("DTEND");
  const durationProperty = byName.get("DURATION");

  // The whole event is reported in one zone so the preview shows one coherent
  // window. A DTSTART that carries an explicit TZID or a Z suffix decides it.
  let timeZone = fallbackTimeZone;
  let date = "";
  let startText = "";
  let endText = "";
  let startInstant: Date | null = null;

  if (!startProperty) {
    errors.push("This event has no start time.");
  } else {
    const parsedStart = parseIcsDate(startProperty, fallbackTimeZone);
    if (parsedStart.error) {
      errors.push(parsedStart.error);
    } else {
      if (parsedStart.timeZone) {
        timeZone = parsedStart.timeZone;
      }
      startInstant = resolveIcsInstant(parsedStart, timeZone);
      if (startInstant) {
        const asText = utcInstantToWallClockText(startInstant, timeZone);
        date = asText.date;
        startText = asText.time;
      }
    }
  }

  let endInstant: Date | null = null;
  if (endProperty) {
    const parsedEnd = parseIcsDate(endProperty, fallbackTimeZone);
    if (parsedEnd.error) {
      errors.push(parsedEnd.error);
    } else {
      // An end that names its own zone is resolved there but still shown in the
      // start's zone, so the two halves of the window are directly comparable.
      endInstant = resolveIcsInstant(parsedEnd, timeZone);
    }
  } else if (durationProperty) {
    const durationMs = parseIcsDuration(durationProperty.value);
    if (durationMs === null) {
      errors.push(`Could not read the duration "${durationProperty.value}".`);
    } else if (startInstant) {
      endInstant = new Date(startInstant.valueOf() + durationMs);
    }
  } else if (errors.length === 0) {
    errors.push("This event has no end time or duration.");
  }

  if (endInstant) {
    const endWallClock = utcInstantToWallClockText(endInstant, timeZone);
    if (startInstant && endWallClock.date !== date) {
      // A row carries a single date, so an event that ends on another calendar
      // day would be written down with the wrong end. Say so rather than import
      // a window the tutor never had.
      errors.push(
        "This event ends on another day. Add it by hand so both dates are kept.",
      );
    } else {
      endText = endWallClock.time;
    }
  }

  const repeatProperty = byName.get("RRULE");
  let repeat = "";
  let until = "";
  if (repeatProperty) {
    const rule = repeatProperty.value.toUpperCase();
    const frequency = /(?:^|;)FREQ=([^;]+)/.exec(rule);
    if (frequency && frequency[1] === "WEEKLY") {
      repeat = "weekly";
      const untilMatch = /(?:^|;)UNTIL=([^;]+)/.exec(rule);
      if (untilMatch) {
        until = normalizeIcsUntilText(untilMatch[1]!);
      }
    } else if (frequency) {
      errors.push(
        `Only weekly repeats can be imported; this event repeats ${frequency[1]!.toLowerCase()}.`,
      );
    } else {
      errors.push("The repeat rule could not be read.");
    }
  }

  return {
    sourceRow: eventIndex,
    timeZone,
    label,
    date,
    start: startText,
    end: endText,
    repeat,
    until,
    category: "",
    errors,
  };
}

/**
 * UNTIL is written either in the compact calendar form (20261130) or as a full
 * timestamp (20261130T235959Z). Only the day matters here, because the import
 * repeats to the end of that local day so the day itself is included.
 */
function normalizeIcsUntilText(value: string): string {
  const compact = /^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/.exec(value.trim());
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  return value.trim();
}

/** Renders an instant back into wall-clock text for a zone, for the preview. */
function utcInstantToWallClockText(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = zoneFormatter(timeZone).formatToParts(instant);
  const read: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      read[part.type] = part.value;
    }
  }
  const hour = read.hour === "24" ? "00" : (read.hour ?? "00");
  return {
    date: `${read.year}-${read.month}-${read.day}`,
    time: `${hour}:${read.minute}`,
  };
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

const MAX_REPEAT_UNTIL_TEXT_LENGTH = 32;

function mapRow(raw: RawRow, term: AcademicTermBounds): TimetableImportRow {
  const errors = [...raw.errors];
  const localDate = parseDateOnly(raw.date);
  const localStart = parseClockTime(raw.start);
  const localEnd = parseClockTime(raw.end);

  // A reader that already diagnosed this row (the calendar reader does) knows
  // more than "a value is missing", so its message stands alone. Piling the
  // generic required-field text on top would show the same problem twice.
  const explainMissing = raw.errors.length === 0;

  if (!localDate && explainMissing) {
    errors.push(
      raw.date
        ? `"${raw.date}" is not a valid date. Use YYYY-MM-DD.`
        : "A date is required.",
    );
  }
  if (!localStart && explainMissing) {
    errors.push(
      raw.start
        ? `"${raw.start}" is not a valid start time. Use 24-hour HH:MM.`
        : "A start time is required.",
    );
  }
  if (!localEnd && explainMissing) {
    errors.push(
      raw.end
        ? `"${raw.end}" is not a valid end time. Use 24-hour HH:MM.`
        : "An end time is required.",
    );
  }

  const category = raw.category.trim().toLowerCase();
  if (!BUSY_CATEGORIES.has(category)) {
    errors.push(
      `"${raw.category}" is not a supported category. Use busy, unavailable, class, study, or leave it blank.`,
    );
  }

  const repeatText = raw.repeat.trim().toLowerCase();
  let weekly = false;
  if (WEEKLY_VALUES.has(repeatText)) {
    weekly = true;
  } else if (!ONCE_VALUES.has(repeatText)) {
    errors.push(
      `"${raw.repeat}" is not a supported repeat value. Use weekly, once, or leave it blank.`,
    );
  }

  const label = raw.label.trim();
  if (label.length > MAX_TIME_SLOT_LABEL_LENGTH) {
    errors.push(
      `The description is longer than ${MAX_TIME_SLOT_LABEL_LENGTH} characters.`,
    );
  }

  const base: TimetableImportRow = {
    sourceRow: raw.sourceRow,
    timeZone: raw.timeZone,
    localStartsAt:
      localDate && localStart
        ? `${formatDateOnly(localDate)}T${formatClockTime(localStart)}`
        : null,
    localEndsAt:
      localDate && localEnd
        ? `${formatDateOnly(localDate)}T${formatClockTime(localEnd)}`
        : null,
    localRecurrenceUntil: null,
    label: label || null,
    recurrence: weekly ? "WEEKLY" : "ONCE",
    duplicate: false,
    slot: null,
    errors,
  };

  const termStart = parseDateOnly(term.startsOn);
  const termEnd = parseDateOnly(term.endsOn);
  if (!localDate || !localStart || !localEnd || errors.length > 0) {
    return base;
  }

  const localDateText = formatDateOnly(localDate);

  // Term containment, compared as calendar dates so the boundary does not
  // depend on the server's timezone.
  if (termStart && localDateText < formatDateOnly(termStart)) {
    base.errors.push(`This falls before ${term.name} starts on ${term.startsOn}.`);
    return base;
  }
  if (termEnd && localDateText > formatDateOnly(termEnd)) {
    base.errors.push(`This falls after ${term.name} ends on ${term.endsOn}.`);
    return base;
  }

  let repeatUntilDate: string | null = null;
  if (weekly) {
    // Repeat to the end of the term unless the row asks to stop sooner, so a
    // missing repeat-until can never produce an open-ended weekly block.
    repeatUntilDate = term.endsOn;
    if (raw.until.trim()) {
      const untilText = raw.until.trim().slice(0, MAX_REPEAT_UNTIL_TEXT_LENGTH);
      const combined = splitDateTime(untilText);
      const untilDate = parseDateOnly(combined ? combined.date : untilText);
      if (!untilDate) {
        base.errors.push(
          `"${raw.until}" is not a valid repeat-until date. Use YYYY-MM-DD.`,
        );
        return base;
      }
      const untilDateText = formatDateOnly(untilDate);
      if (untilDateText < localDateText) {
        base.errors.push("The repeat-until date is before the first occurrence.");
        return base;
      }
      if (termEnd && untilDateText > formatDateOnly(termEnd)) {
        base.errors.push(
          `The weekly repeat cannot run past ${term.name}, which ends on ${term.endsOn}.`,
        );
        return base;
      }
      repeatUntilDate = untilDateText;
    }
  } else if (raw.until.trim()) {
    base.errors.push("A repeat-until date only makes sense with weekly repeats.");
    return base;
  }

  const startsAt = zonedWallClockToUtc(
    { ...localDate, ...localStart },
    raw.timeZone,
  );
  const endsAt = zonedWallClockToUtc(
    { ...localDate, ...localEnd },
    raw.timeZone,
  );
  const recurrenceUntil = repeatUntilDate
    ? lastInstantOfLocalDay(repeatUntilDate, raw.timeZone)
    : null;

  const checked = checkTimeSlotRules({
    type: IMPORT_TIME_SLOT_TYPE,
    startsAt,
    endsAt,
    recurrence: weekly ? "WEEKLY" : undefined,
    labelSupplied: true,
    label: label || null,
    recurrenceUntilSupplied: true,
    recurrenceUntilProvided: recurrenceUntil !== null,
    recurrenceUntil,
  });
  if ("error" in checked) {
    base.errors.push(checked.error);
    return base;
  }

  base.localRecurrenceUntil = repeatUntilDate;
  base.slot = {
    type: IMPORT_TIME_SLOT_TYPE,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    ...(weekly ? { recurrence: "WEEKLY" as const } : {}),
    label: label || null,
    recurrenceUntil: recurrenceUntil ? recurrenceUntil.toISOString() : null,
  };
  return base;
}

/**
 * Parses a timetable into per-row results. Never throws for a bad row: the row
 * carries its own errors and the caller decides what to save.
 */
export function parseTimetableImport(
  selection: TimetableImportInput,
): TimetableImportPreview | { error: string } {
  const text = selection.text;
  if (text.trim().length === 0) {
    return { error: "There was nothing to import." };
  }
  if (text.length > MAX_IMPORT_TEXT_LENGTH) {
    return {
      error: `That timetable is too large to import. Keep it under ${MAX_IMPORT_TEXT_LENGTH} characters.`,
    };
  }

  const timeZone = normalizeTimeZone(selection.timeZone);
  if (!timeZone) {
    return { error: "A valid time zone is required to place the entries on the calendar." };
  }

  const read =
    selection.source === "ICS"
      ? readIcsRows(text, timeZone)
      : readDelimitedRows(text, timeZone);
  if ("error" in read) {
    return read;
  }

  const rows = read.rows.map((raw) => mapRow(raw, selection.term));
  return {
    source: selection.source,
    timeZone,
    term: selection.term,
    rows,
    validCount: rows.filter((row) => row.slot !== null).length,
    invalidCount: rows.filter((row) => row.slot === null).length,
    duplicateCount: 0,
  };
}

/**
 * Identity of a schedule entry for duplicate detection: two rows describing the
 * same block of time with the same description are the same entry, whether one
 * of them was imported or typed by hand.
 */
export function timeSlotDedupeKey(slot: {
  startsAt: string;
  endsAt: string;
  recurrence?: string | null;
  label?: string | null;
}): string {
  return [
    new Date(slot.startsAt).toISOString(),
    new Date(slot.endsAt).toISOString(),
    slot.recurrence ?? "",
    slot.label ?? "",
  ].join("|");
}

/**
 * Reads the request that carries a timetable. Structural problems (unknown
 * source, missing text, bad zone shape, bad term) are request-level; everything
 * the tutor can fix per row is reported by parseTimetableImport instead.
 */
export function parseTimetableImportRequest(body: unknown):
  | { error: string }
  | { value: TimetableImportRequest } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Provide the timetable text, its format and the academic term." };
  }
  const payload = body as Record<string, unknown>;
  const allowed = ["source", "text", "timeZone", "termId"];
  if (!Object.keys(payload).every((key) => allowed.includes(key))) {
    return { error: "Provide only the timetable source, text, time zone and term." };
  }

  const source = payload.source;
  if (source !== "CSV" && source !== "ICS") {
    return { error: "Choose either a CSV/pasted timetable or a calendar (.ics) file." };
  }
  if (typeof payload.text !== "string") {
    return { error: "Provide the timetable text to import." };
  }
  const timeZone = normalizeTimeZone(payload.timeZone);
  if (!timeZone) {
    return { error: "A valid time zone is required to place the entries on the calendar." };
  }
  const termId = payload.termId;
  if (typeof termId !== "number" || !Number.isInteger(termId) || termId <= 0) {
    return { error: "Choose the academic term this timetable belongs to." };
  }

  return { value: { source, text: payload.text, timeZone, termId } };
}

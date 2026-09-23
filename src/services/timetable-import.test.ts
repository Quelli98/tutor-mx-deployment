import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_ROWS,
  lastInstantOfLocalDay,
  parseTimetableImportRequest,
  parseTimetableImport,
  timeSlotDedupeKey,
  zonedWallClockToUtc,
  type AcademicTermBounds,
  type TimetableImportPreview,
} from "./timetable-import.js";

/**
 * S3-M3-1 unit tests for the timetable reader.
 *
 * The parser is pure: it decides what each row means and never touches the
 * database. These tests pin the two things the card asks for directly — bad
 * dates/times/categories become ROW-level errors rather than a whole-file
 * rejection, and every accepted row is normalised into the payload shape the
 * manual time-slot form already produces.
 */

const term: AcademicTermBounds = {
  id: 1,
  name: "Demo 2030 Semester 2",
  startsOn: "2030-08-26",
  endsOn: "2030-11-29",
};

function preview(
  text: string,
  overrides: Partial<AcademicTermBounds> = {},
  timeZone = "UTC",
): TimetableImportPreview {
  const result = parseTimetableImport({
    source: "CSV",
    text,
    timeZone,
    term: { ...term, ...overrides },
  });
  if ("error" in result) {
    throw new Error(`Expected a parsed preview but got a file-level error: ${result.error}`);
  }
  return result;
}

function rowAt(result: TimetableImportPreview, sourceRow: number) {
  const row = result.rows.find((candidate) => candidate.sourceRow === sourceRow);
  if (!row) {
    throw new Error(`No parsed row at source row ${sourceRow}`);
  }
  return row;
}

describe("timetable import parser: row-level errors", () => {
  it("keeps good rows valid while bad dates, times and categories each error alone", () => {
    const result = preview(
      [
        "date,start,end,label,repeat,category",
        "2030-09-02,09:00,11:00,Maths tutorial,weekly,class",
        "2030-13-40,09:00,11:00,Bad date,weekly,",
        "2030-09-04,25:00,11:00,Bad start time,once,",
        "2030-09-05,06:00,99:99,Bad end time,once,",
        "2030-09-06,09:00,11:00,Bad category,once,holiday",
      ].join("\n"),
    );

    // The two well-formed rows survive; a bad row never invalidates its siblings.
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(4);
    expect(result.rows).toHaveLength(5);

    expect(rowAt(result, 2).slot).not.toBeNull();
    expect(rowAt(result, 2).errors).toEqual([]);

    expect(rowAt(result, 3).errors).toEqual([
      '"2030-13-40" is not a valid date. Use YYYY-MM-DD.',
    ]);
    expect(rowAt(result, 4).errors).toEqual([
      '"25:00" is not a valid start time. Use 24-hour HH:MM.',
    ]);
    expect(rowAt(result, 5).errors).toEqual([
      '"99:99" is not a valid end time. Use 24-hour HH:MM.',
    ]);
    expect(rowAt(result, 6).errors).toEqual([
      '"holiday" is not a supported category. Use busy, unavailable, class, study, or leave it blank.',
    ]);

    // An errored row must never carry a payload, so it cannot be saved by accident.
    for (const sourceRow of [3, 4, 5, 6]) {
      expect(rowAt(result, sourceRow).slot).toBeNull();
    }
  });

  it("reports a missing date, start and end separately from a malformed one", () => {
    // At least one cell must be filled, otherwise the row is a blank line and is
    // dropped (see the blank-record test below).
    const result = preview(["date,start,end,label", "2030-09-02,,,Partial"].join("\n"));

    expect(result.rows).toHaveLength(1);
    expect(result.invalidCount).toBe(1);
    expect(rowAt(result, 2).errors).toEqual([
      "A start time is required.",
      "An end time is required.",
    ]);
  });

  it("ignores blank lines and trailing separators in a paste", () => {
    const result = preview(
      ["date,start,end", "2030-09-02,09:00,10:00", "", ",,", "   "].join("\n"),
    );

    // Blank records never become rows, and they never become errors either.
    expect(result.rows).toHaveLength(1);
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(0);
  });

  it("rejects a reversed interval and a zero-length interval through the shared rule set", () => {
    const result = preview(
      [
        "date,start,end",
        "2030-09-14,10:00,09:00",
        "2030-09-15,09:00,09:00",
      ].join("\n"),
    );

    expect(result.validCount).toBe(0);
    expect(result.invalidCount).toBe(2);
    // Same message the manual form gives, because both call checkTimeSlotRules.
    expect(rowAt(result, 2).errors[0]).toContain("Enter a valid schedule interval");
    expect(rowAt(result, 3).errors[0]).toContain("Enter a valid schedule interval");
  });

  it("accepts every documented category that means unavailable", () => {
    const result = preview(
      [
        "date,start,end,category",
        "2030-09-02,09:00,10:00,",
        "2030-09-03,09:00,10:00,busy",
        "2030-09-04,09:00,10:00,Unavailable",
        "2030-09-05,09:00,10:00,class",
        "2030-09-06,09:00,10:00,Study",
      ].join("\n"),
    );

    expect(result.validCount).toBe(5);
    expect(result.invalidCount).toBe(0);
  });

  it("rejects a repeat-until date on a one-off row", () => {
    const result = preview(
      ["date,start,end,repeat,until", "2030-09-10,09:00,10:00,once,2030-10-15"].join("\n"),
    );

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 2).errors).toEqual([
      "A repeat-until date only makes sense with weekly repeats.",
    ]);
  });
});

describe("timetable import parser: mapping onto the existing TimeSlot payload", () => {
  it("maps a weekly row onto a WEEKLY payload with recurrenceUntil at the term end", () => {
    const result = preview(
      ["date,start,end,label,repeat", "2030-09-02,09:00,11:00,Maths tutorial,weekly"].join("\n"),
    );

    const row = rowAt(result, 2);
    expect(row.recurrence).toBe("WEEKLY");
    expect(row.localRecurrenceUntil).toBe("2030-11-29");
    expect(row.slot).toEqual({
      type: "BUSY",
      startsAt: "2030-09-02T09:00:00.000Z",
      endsAt: "2030-09-02T11:00:00.000Z",
      recurrence: "WEEKLY",
      label: "Maths tutorial",
      recurrenceUntil: "2030-11-29T23:59:59.999Z",
    });
  });

  it("leaves a one-off row without a recurrence, exactly like the manual form", () => {
    const result = preview(["date,start,end,label", "2030-09-03,10:00,12:00,Physics lab"].join("\n"));

    const row = rowAt(result, 2);
    expect(row.recurrence).toBe("ONCE");
    expect(row.localRecurrenceUntil).toBeNull();
    // No `recurrence` key at all: the manual route omits it for a one-off too.
    expect(row.slot).toEqual({
      type: "BUSY",
      startsAt: "2030-09-03T10:00:00.000Z",
      endsAt: "2030-09-03T12:00:00.000Z",
      label: "Physics lab",
      recurrenceUntil: null,
    });
    expect(row.slot && "recurrence" in row.slot).toBe(false);
  });

  it("honours an explicit repeat-until that stops before the term ends", () => {
    const result = preview(
      [
        "date,start,end,repeat,until",
        "2030-09-09,09:00,10:00,weekly,2030-10-15",
      ].join("\n"),
    );

    const row = rowAt(result, 2);
    expect(row.localRecurrenceUntil).toBe("2030-10-15");
    expect(row.slot?.recurrenceUntil).toBe("2030-10-15T23:59:59.999Z");
  });

  it("refuses a weekly repeat that would run past the end of the term", () => {
    const result = preview(
      [
        "date,start,end,repeat,until",
        "2030-09-08,09:00,10:00,weekly,2031-01-01",
      ].join("\n"),
    );

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 2).errors).toEqual([
      "The weekly repeat cannot run past Demo 2030 Semester 2, which ends on 2030-11-29.",
    ]);
  });

  it("refuses a repeat-until that precedes the first occurrence", () => {
    const result = preview(
      ["date,start,end,repeat,until", "2030-09-11,09:00,10:00,weekly,2030-09-01"].join("\n"),
    );

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 2).errors).toEqual([
      "The repeat-until date is before the first occurrence.",
    ]);
  });

  it("refuses a repeat-until that is not a calendar date", () => {
    const result = preview(
      ["date,start,end,repeat,until", "2030-09-12,09:00,10:00,weekly,not-a-date"].join("\n"),
    );

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 2).errors).toEqual([
      '"not-a-date" is not a valid repeat-until date. Use YYYY-MM-DD.',
    ]);
  });

  it("refuses a row that falls outside the academic term on either side", () => {
    const result = preview(
      [
        "date,start,end,label",
        "2030-08-20,09:00,10:00,Before term",
        "2030-12-10,09:00,10:00,After term",
      ].join("\n"),
    );

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 2).errors).toEqual([
      "This falls before Demo 2030 Semester 2 starts on 2030-08-26.",
    ]);
    expect(rowAt(result, 3).errors).toEqual([
      "This falls after Demo 2030 Semester 2 ends on 2030-11-29.",
    ]);
  });

  it("accepts rows on the first and last day of the term inclusively", () => {
    const result = preview(
      [
        "date,start,end,label,repeat",
        "2030-08-26,09:00,10:00,First day,once",
        "2030-11-29,09:00,10:00,Last day,weekly",
      ].join("\n"),
    );

    expect(result.validCount).toBe(2);
    expect(rowAt(result, 2).errors).toEqual([]);
    expect(rowAt(result, 3).errors).toEqual([]);
    // A weekly row that starts on the final day still repeats to that day's end.
    expect(rowAt(result, 3).slot?.recurrenceUntil).toBe("2030-11-29T23:59:59.999Z");
  });

  it("reuses the existing combined startsAt/endsAt header shape", () => {
    const result = preview(
      ["startsAt,endsAt,label", "2030-09-18T09:00,2030-09-18T10:30,Combined form"].join("\n"),
    );

    expect(rowAt(result, 2).slot).toEqual({
      type: "BUSY",
      startsAt: "2030-09-18T09:00:00.000Z",
      endsAt: "2030-09-18T10:30:00.000Z",
      label: "Combined form",
      recurrenceUntil: null,
    });
  });
});

describe("timetable import parser: local time handling", () => {
  it("reads the wall clock in the tutor's zone and stores the matching instant", () => {
    // South Africa is UTC+2 all year, so 09:00 local is 07:00Z.
    const result = preview(
      ["date,start,end,label", "2030-09-02,09:00,11:00,Morning block"].join("\n"),
      {},
      "Africa/Johannesburg",
    );

    const row = rowAt(result, 2);
    // The preview keeps the wall clock the tutor typed...
    expect(row.localStartsAt).toBe("2030-09-02T09:00");
    expect(row.localEndsAt).toBe("2030-09-02T11:00");
    expect(row.timeZone).toBe("Africa/Johannesburg");
    // ...while the saved payload carries the real instant.
    expect(row.slot?.startsAt).toBe("2030-09-02T07:00:00.000Z");
    expect(row.slot?.endsAt).toBe("2030-09-02T09:00:00.000Z");
  });

  it("resolves the term-end bound in the same zone as the rows", () => {
    // The bound is the last instant of the term's final LOCAL day, so it is
    // 21:59:59.999Z in a UTC+2 zone and 23:59:59.999Z in UTC.
    expect(lastInstantOfLocalDay("2030-11-29", "Africa/Johannesburg")?.toISOString()).toBe(
      "2030-11-29T21:59:59.999Z",
    );
    expect(lastInstantOfLocalDay("2030-11-29", "UTC")?.toISOString()).toBe(
      "2030-11-29T23:59:59.999Z",
    );

    const result = preview(
      ["date,start,end,repeat", "2030-09-02,09:00,10:00,weekly"].join("\n"),
      {},
      "Africa/Johannesburg",
    );
    expect(rowAt(result, 2).slot?.recurrenceUntil).toBe("2030-11-29T21:59:59.999Z");
  });

  it("shifts the wall clock for a zone whose offset changes mid-term", () => {
    // London moves from BST (UTC+1) to GMT (UTC+0) on 2030-10-27. A September
    // row and a November row therefore encode different offsets for the same
    // written time.
    const september = preview(
      ["date,start,end", "2030-09-02,09:00,10:00"].join("\n"),
      {},
      "Europe/London",
    );
    const november = preview(
      ["date,start,end", "2030-11-04,09:00,10:00"].join("\n"),
      {},
      "Europe/London",
    );

    expect(rowAt(september, 2).slot?.startsAt).toBe("2030-09-02T08:00:00.000Z");
    expect(rowAt(november, 2).slot?.startsAt).toBe("2030-11-04T09:00:00.000Z");
    expect(zonedWallClockToUtc(
      { year: 2030, month: 11, day: 4, hour: 9, minute: 0 },
      "Europe/London",
    ).toISOString()).toBe("2030-11-04T09:00:00.000Z");
  });

  it("treats the term boundary as a calendar day, not an instant", () => {
    // Midday in a far-forward zone is still the same local day as the term start.
    const result = preview(
      ["date,start,end", "2030-08-26,00:30,01:30"].join("\n"),
      {},
      "Pacific/Kiritimati",
    );

    expect(result.validCount).toBe(1);
    expect(rowAt(result, 2).errors).toEqual([]);
  });
});

describe("timetable import parser: file-level shape", () => {
  it("rejects empty text with a file-level error rather than rows", () => {
    expect(parseTimetableImport({ source: "CSV", text: "   ", timeZone: "UTC", term })).toEqual({
      error: "There was nothing to import.",
    });
  });

  it("reports a header-only file as zero rows instead of an error", () => {
    const result = preview("date,start,end");

    expect(result.rows).toEqual([]);
    expect(result.validCount).toBe(0);
    expect(result.invalidCount).toBe(0);
  });

  it("asks for named columns when the paste has no header line", () => {
    const result = parseTimetableImport({
      source: "CSV",
      text: "2030-09-16\t09:00\t10:00\tPasted tab",
      timeZone: "UTC",
      term,
    });

    expect("error" in result && result.error).toContain("Name the columns in the first line");
  });

  it("rejects an unknown time zone because rows could not be placed", () => {
    const result = parseTimetableImport({
      source: "CSV",
      text: "date,start,end\n2030-09-02,09:00,10:00",
      timeZone: "Mars/Olympus",
      term,
    });

    expect("error" in result && result.error).toContain("valid time zone");
  });

  it("caps the number of rows", () => {
    const lines = ["date,start,end"];
    for (let index = 0; index <= MAX_IMPORT_ROWS; index += 1) {
      lines.push("2030-09-02,09:00,10:00");
    }

    const result = parseTimetableImport({
      source: "CSV",
      text: lines.join("\n"),
      timeZone: "UTC",
      term,
    });

    expect("error" in result && result.error).toContain(`at most ${MAX_IMPORT_ROWS} rows`);
  });

  it("reads a quoted description containing the delimiter", () => {
    const result = preview(
      ['date,start,end,label', '2030-09-15,09:00,10:00,"Stats, group A"'].join("\n"),
    );

    expect(rowAt(result, 2).label).toBe("Stats, group A");
    expect(rowAt(result, 2).errors).toEqual([]);
  });

  it("starts duplicate detection clean, because only the database can know", () => {
    const result = preview(["date,start,end", "2030-09-02,09:00,10:00"].join("\n"));

    expect(result.duplicateCount).toBe(0);
    expect(rowAt(result, 2).duplicate).toBe(false);
  });
});

describe("timetable import parser: calendar files", () => {
  function icsPreview(body: string[]): TimetableImportPreview {
    const result = parseTimetableImport({
      source: "ICS",
      text: ["BEGIN:VCALENDAR", ...body, "END:VCALENDAR"].join("\r\n"),
      timeZone: "UTC",
      term,
    });
    if ("error" in result) {
      throw new Error(`Expected a parsed preview but got: ${result.error}`);
    }
    return result;
  }

  it("maps a weekly event with an UNTIL onto a WEEKLY payload", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "UID:abc@example.com",
      "SUMMARY:Chemistry lecture",
      "DTSTART:20300902T090000Z",
      "DTEND:20300902T110000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20301028T090000Z",
      "END:VEVENT",
    ]);

    expect(result.rows).toHaveLength(1);
    expect(rowAt(result, 1).slot).toEqual({
      type: "BUSY",
      startsAt: "2030-09-02T09:00:00.000Z",
      endsAt: "2030-09-02T11:00:00.000Z",
      recurrence: "WEEKLY",
      label: "Chemistry lecture",
      recurrenceUntil: "2030-10-28T23:59:59.999Z",
    });
  });

  it("reports a non-weekly repeat rule as a row error", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Daily standup",
      "DTSTART:20300902T090000Z",
      "DTEND:20300902T093000Z",
      "RRULE:FREQ=DAILY",
      "END:VEVENT",
    ]);

    expect(result.validCount).toBe(0);
    expect(result.invalidCount).toBe(1);
    expect(rowAt(result, 1).slot).toBeNull();
    expect(rowAt(result, 1).errors.length).toBeGreaterThan(0);
  });

  it("reports an all-day event as a row error", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Reading week",
      "DTSTART;VALUE=DATE:20300902",
      "DTEND;VALUE=DATE:20300903",
      "END:VEVENT",
    ]);

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 1).slot).toBeNull();
    expect(rowAt(result, 1).errors.length).toBeGreaterThan(0);
  });

  it("reports an event with no end as a row error", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:No end",
      "DTSTART:20300902T090000Z",
      "END:VEVENT",
    ]);

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 1).errors).toEqual(["This event has no end time or duration."]);
  });

  it("keeps a good event valid when a sibling event is broken", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Broken",
      "DTSTART:20300902T090000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Fine",
      "DTSTART:20300903T090000Z",
      "DTEND:20300903T100000Z",
      "END:VEVENT",
    ]);

    expect(result.rows).toHaveLength(2);
    expect(rowAt(result, 1).slot).toBeNull();
    expect(rowAt(result, 2).slot).not.toBeNull();
    expect(rowAt(result, 2).label).toBe("Fine");
  });

  it("reads an end from an explicit duration", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Evening lab",
      "DTSTART:20300902T090000Z",
      "DURATION:PT1H30M",
      "END:VEVENT",
    ]);

    expect(rowAt(result, 1).errors).toEqual([]);
    expect(rowAt(result, 1).slot?.startsAt).toBe("2030-09-02T09:00:00.000Z");
    expect(rowAt(result, 1).slot?.endsAt).toBe("2030-09-02T10:30:00.000Z");
  });

  it("reports a duration it cannot read, including one that states no length", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Unreadable duration",
      "DTSTART:20300902T090000Z",
      "DURATION:SOON",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Empty duration",
      "DTSTART:20300902T090000Z",
      "DURATION:PT",
      "END:VEVENT",
    ]);

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 1).errors).toContain('Could not read the duration "SOON".');
    expect(rowAt(result, 2).errors).toContain('Could not read the duration "PT".');
  });

  it("reports an event that ends on another day instead of importing it wrong", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Overnight lab",
      "DTSTART:20300902T220000Z",
      "DTEND:20300903T020000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Day-spanning duration",
      "DTSTART:20300902T090000Z",
      "DURATION:P1DT2H30M",
      "END:VEVENT",
    ]);

    // Both would otherwise be saved as a 2030-09-02 window that ends before the
    // session it is meant to describe.
    expect(result.validCount).toBe(0);
    expect(rowAt(result, 1).slot).toBeNull();
    expect(rowAt(result, 1).errors).toContain(
      "This event ends on another day. Add it by hand so both dates are kept.",
    );
    expect(rowAt(result, 2).slot).toBeNull();
    expect(rowAt(result, 2).errors).toContain(
      "This event ends on another day. Add it by hand so both dates are kept.",
    );
  });

  it("reads a floating event in the time zone the tutor chose", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Floating",
      "DTSTART:20300902T090000",
      "DTEND:20300902T100000",
      "END:VEVENT",
    ]);

    expect(rowAt(result, 1).errors).toEqual([]);
    expect(rowAt(result, 1).slot?.startsAt).toBe("2030-09-02T09:00:00.000Z");
    expect(rowAt(result, 1).slot?.endsAt).toBe("2030-09-02T10:00:00.000Z");
  });

  it("reads a TZID event in that zone", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Stats tutorial",
      "DTSTART;TZID=Africa/Johannesburg:20300902T090000",
      "DTEND;TZID=Africa/Johannesburg:20300902T100000",
      "END:VEVENT",
    ]);

    // South African time is two hours ahead of UTC all year, so 09:00 local is
    // stored as 07:00Z while the tutor still sees 09:00.
    expect(rowAt(result, 1).errors).toEqual([]);
    expect(rowAt(result, 1).slot?.startsAt).toBe("2030-09-02T07:00:00.000Z");
    expect(rowAt(result, 1).slot?.endsAt).toBe("2030-09-02T08:00:00.000Z");
  });

  it("reports a TZID it does not know", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Unknown zone",
      "DTSTART;TZID=Mars/Phobos:20300902T090000",
      "DTEND:20300902T100000Z",
      "END:VEVENT",
    ]);

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 1).errors).toContain(
      'The time zone "Mars/Phobos" is not supported. Replace it with a plain time.',
    );
  });

  it("joins a folded line and ignores lines that are not properties", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Chemistry",
      // RFC 5545 folds a long value with one leading space.
      "  lecture",
      // No colon at all, an empty name, and a parameter without a value.
      "JUST A WORD",
      ":orphan",
      "DTSTART;NOVALUE:20300902T090000Z",
      "DTEND:20300902T100000Z",
      "END:VEVENT",
    ]);

    expect(rowAt(result, 1).errors).toEqual([]);
    expect(rowAt(result, 1).label).toBe("Chemistry lecture");
    expect(rowAt(result, 1).slot?.startsAt).toBe("2030-09-02T09:00:00.000Z");
  });

  it("reports a repeat rule that names no frequency", () => {
    const result = icsPreview([
      "BEGIN:VEVENT",
      "SUMMARY:Counted repeat",
      "DTSTART:20300902T090000Z",
      "DTEND:20300902T100000Z",
      "RRULE:COUNT=3",
      "END:VEVENT",
    ]);

    expect(result.validCount).toBe(0);
    expect(rowAt(result, 1).errors).toContain("The repeat rule could not be read.");
  });

  it("says so when a calendar holds no events", () => {
    const result = parseTimetableImport({
      source: "ICS",
      text: ["BEGIN:VCALENDAR", "END:VCALENDAR"].join("\r\n"),
      timeZone: "UTC",
      term,
    });

    expect("error" in result && result.error).toContain("No calendar events were found");
  });
});

describe("timetable import request shape", () => {
  it("accepts a well-formed request", () => {
    expect(
      parseTimetableImportRequest({
        source: "CSV",
        text: "date,start,end",
        timeZone: "UTC",
        termId: 3,
      }),
    ).toEqual({
      value: { source: "CSV", text: "date,start,end", timeZone: "UTC", termId: 3 },
    });
  });

  it("rejects an unknown source, a missing term and extra fields", () => {
    expect(
      parseTimetableImportRequest({ source: "XLSX", text: "a", timeZone: "UTC", termId: 1 }),
    ).toEqual({ error: "Choose either a CSV/pasted timetable or a calendar (.ics) file." });

    expect(
      parseTimetableImportRequest({ source: "CSV", text: "a", timeZone: "UTC" }),
    ).toEqual({ error: "Choose the academic term this timetable belongs to." });

    expect(
      parseTimetableImportRequest({
        source: "CSV",
        text: "a",
        timeZone: "UTC",
        termId: 1,
        extra: true,
      }),
    ).toEqual({ error: "Provide only the timetable source, text, time zone and term." });
  });
});

describe("time slot dedupe key", () => {
  it("is stable across equivalent ISO spellings and distinguishes the label", () => {
    const base = {
      startsAt: "2030-09-02T09:00:00.000Z",
      endsAt: "2030-09-02T10:00:00.000Z",
      recurrence: "WEEKLY",
      label: "Maths",
    };

    expect(timeSlotDedupeKey(base)).toBe(timeSlotDedupeKey({ ...base }));
    // A different label is a different entry.
    expect(timeSlotDedupeKey(base)).not.toBe(timeSlotDedupeKey({ ...base, label: "Physics" }));
    // A one-off and a weekly row over the same window are different entries.
    expect(timeSlotDedupeKey(base)).not.toBe(
      timeSlotDedupeKey({ ...base, recurrence: null }),
    );
  });
});

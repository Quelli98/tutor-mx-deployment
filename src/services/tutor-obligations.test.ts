import { describe, expect, it } from "vitest";
import { computeTutorObligations, type ObligationSession } from "./tutor-obligations.js";

// Monday 6 October 2026, 12:00 SAST.
const now = new Date("2026-10-06T10:00:00.000Z");

function session(overrides: Partial<ObligationSession> = {}): ObligationSession {
  return {
    id: 1,
    courseCode: "COMS3011",
    startsAt: new Date("2026-10-01T08:00:00.000Z"),
    endsAt: new Date("2026-10-01T10:00:00.000Z"),
    status: "CONFIRMED",
    workLogEligible: true,
    logged: false,
    ...overrides,
  };
}

describe("computeTutorObligations", () => {
  it("asks for hours on an ended, unlogged session, for the week it belongs to", () => {
    const [owed] = computeTutorObligations({ now, sessions: [session()], timesheets: [] });

    expect(owed).toMatchObject({
      kind: "LOG_HOURS",
      weekEnding: "2026-10-04",
      dueAt: null,
      overdue: true,
      allocationId: 1,
      timesheetId: null,
    });
    expect(owed!.title).toBe("Log your hours for COMS3011 on Thu 1 Oct");
  });

  it("does not ask yet within the session's own week", () => {
    const [owed] = computeTutorObligations({
      now,
      sessions: [session({ startsAt: new Date("2026-10-06T06:00:00.000Z"), endsAt: new Date("2026-10-06T08:00:00.000Z") })],
      timesheets: [],
    });
    expect(owed).toMatchObject({ weekEnding: "2026-10-11", overdue: false });
  });

  it.each([
    ["already logged", { logged: true }],
    ["not finished", { endsAt: new Date("2026-10-06T11:00:00.000Z") }],
    ["only proposed", { status: "PROPOSED" }],
    ["excused as sick", { workLogEligible: false }],
  ])("owes nothing for a session that is %s", (_name, overrides) => {
    expect(computeTutorObligations({ now, sessions: [session(overrides)], timesheets: [] })).toEqual([]);
  });

  it("asks to submit a draft with hours once its week has ended", () => {
    const owed = computeTutorObligations({
      now,
      sessions: [],
      timesheets: [
        { id: 3, weekStart: new Date("2026-09-28T00:00:00.000Z"), status: "DRAFT", reviewedAt: null, workLogCount: 2 },
        { id: 4, weekStart: new Date("2026-10-05T00:00:00.000Z"), status: "DRAFT", reviewedAt: null, workLogCount: 1 },
        { id: 5, weekStart: new Date("2026-09-21T00:00:00.000Z"), status: "DRAFT", reviewedAt: null, workLogCount: 0 },
      ],
    });
    expect(owed).toEqual([expect.objectContaining({ kind: "SUBMIT_TIMESHEET", timesheetId: 3, weekEnding: "2026-10-04" })]);
  });

  it("dates a returned timesheet by the reminder job's resubmit threshold", () => {
    const owed = computeTutorObligations({
      now,
      sessions: [],
      timesheets: [
        { id: 6, weekStart: new Date("2026-09-28T00:00:00.000Z"), status: "RETURNED", reviewedAt: new Date("2026-10-05T08:00:00.000Z"), workLogCount: 1 },
        { id: 7, weekStart: new Date("2026-09-21T00:00:00.000Z"), status: "RETURNED", reviewedAt: new Date("2026-10-01T08:00:00.000Z"), workLogCount: 1 },
        { id: 8, weekStart: new Date("2026-09-14T00:00:00.000Z"), status: "RETURNED", reviewedAt: null, workLogCount: 1 },
      ],
    });

    expect(owed.map((item) => [item.timesheetId, item.dueAt, item.overdue])).toEqual([
      [7, "2026-10-04T08:00:00.000Z", true],
      // No review time: dated by its (older) week instead.
      [8, null, false],
      [6, "2026-10-08T08:00:00.000Z", false],
    ]);
  });

  it("ignores submitted and approved timesheets and honours a custom threshold", () => {
    const owed = computeTutorObligations({
      now,
      resubmitHours: 1,
      sessions: [],
      timesheets: [
        { id: 9, weekStart: new Date("2026-09-28T00:00:00.000Z"), status: "SUBMITTED", reviewedAt: null, workLogCount: 1 },
        { id: 10, weekStart: new Date("2026-09-28T00:00:00.000Z"), status: "APPROVED", reviewedAt: null, workLogCount: 1 },
        { id: 11, weekStart: new Date("2026-09-28T00:00:00.000Z"), status: "RETURNED", reviewedAt: new Date("2026-10-06T08:00:00.000Z"), workLogCount: 1 },
      ],
    });
    expect(owed).toEqual([expect.objectContaining({ timesheetId: 11, dueAt: "2026-10-06T09:00:00.000Z", overdue: true })]);
  });
});

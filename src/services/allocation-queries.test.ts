import { describe, expect, it, vi } from "vitest";
import {
  allocationReasonCodesFor,
  busySlotClashes,
  findAllocationCandidates,
  getTutorHourSummary,
  listOpenWork,
  hasEnoughRemainingHours,
  compareEligibleCandidates,
  rankAllocationCandidates,
  type AllocationCandidate,
  meetsMinimumMark,
  timeRangesOverlap,
  type QueryClient,
} from "./allocation-queries.js";

function queryClientWith(rows: unknown[]): {
  client: QueryClient;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue({ rows });
  return {
    client: { query },
    query,
  };
}

describe("allocation queries", () => {
  const startsAt = new Date("2030-09-04T14:00:00.000Z");
  const endsAt = new Date("2030-09-04T16:00:00.000Z");

  it("treats exact mark and hour thresholds as eligible", () => {
    expect(meetsMinimumMark(50, 50)).toBe(true);
    expect(hasEnoughRemainingHours(2, 2)).toBe(true);
  });

  it("returns no reasons at the exact mark and hour boundaries", () => {
    expect(
      allocationReasonCodesFor({
        mark: 50,
        minimumMark: 50,
        hasClash: false,
        remainingHours: 2,
        requestedHours: 2,
      }),
    ).toEqual([]);
  });

  it.each([
    {
      check: {
        mark: 49,
        minimumMark: 50,
        hasClash: false,
        remainingHours: 2,
        requestedHours: 2,
      },
      reason: "insufficient-mark",
    },
    {
      check: {
        mark: 50,
        minimumMark: 50,
        hasClash: true,
        remainingHours: 2,
        requestedHours: 2,
      },
      reason: "schedule-clash",
    },
    {
      check: {
        mark: 50,
        minimumMark: 50,
        hasClash: false,
        remainingHours: 1,
        requestedHours: 2,
      },
      reason: "hour-limit-exceeded",
    },
  ] as const)("returns only $reason for that failed rule", ({ check, reason }) => {
    expect(allocationReasonCodesFor(check)).toEqual([reason]);
  });

  it("returns multiple reasons in stable mark, clash and hour order", () => {
    expect(
      allocationReasonCodesFor({
        mark: 49,
        minimumMark: 50,
        hasClash: true,
        remainingHours: 1,
        requestedHours: 2,
      }),
    ).toEqual([
      "insufficient-mark",
      "schedule-clash",
      "hour-limit-exceeded",
    ]);
  });

  it("fails closed when allocation rule data is missing", () => {
    expect(
      allocationReasonCodesFor({
        mark: undefined,
        minimumMark: 50,
        hasClash: undefined,
        remainingHours: null,
        requestedHours: 2,
      }),
    ).toEqual([
      "insufficient-mark",
      "schedule-clash",
      "hour-limit-exceeded",
    ]);
  });

  it("treats touching time ranges as non-overlapping and overlapping ranges as clashes", () => {
    expect(
      timeRangesOverlap(
        startsAt,
        endsAt,
        new Date("2030-09-04T16:00:00.000Z"),
        new Date("2030-09-04T18:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      timeRangesOverlap(
        startsAt,
        endsAt,
        new Date("2030-09-04T15:00:00.000Z"),
        new Date("2030-09-04T17:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("rejects requests that exceed the remaining hours boundary", () => {
    expect(hasEnoughRemainingHours(1, 2)).toBe(false);
  });

  it("returns unknown instead of silently approving missing rule data", () => {
    expect(meetsMinimumMark(undefined, 50)).toBeNull();
    expect(hasEnoughRemainingHours(null, 2)).toBeNull();
    expect(
      timeRangesOverlap(
        startsAt,
        endsAt,
        undefined,
        new Date("2030-09-04T18:00:00.000Z"),
      ),
    ).toBeNull();
  });

  describe("busySlotClashes", () => {
    // A window on the same afternoon as the examples above.
    const slotStart = new Date("2030-09-04T14:00:00.000Z");
    const slotEnd = new Date("2030-09-04T16:00:00.000Z");

    it("flags a one-off busy slot only when its own window overlaps", () => {
      expect(
        busySlotClashes(
          slotStart,
          slotEnd,
          null,
          new Date("2030-09-04T15:00:00.000Z"),
          new Date("2030-09-04T17:00:00.000Z"),
        ),
      ).toBe(true);
      // Touching at 16:00 is not a clash (half-open interval).
      expect(
        busySlotClashes(
          slotStart,
          slotEnd,
          null,
          new Date("2030-09-04T16:00:00.000Z"),
          new Date("2030-09-04T18:00:00.000Z"),
        ),
      ).toBe(false);
      // A week later the one-off slot no longer applies.
      expect(
        busySlotClashes(
          slotStart,
          slotEnd,
          null,
          new Date("2030-09-11T14:00:00.000Z"),
          new Date("2030-09-11T16:00:00.000Z"),
        ),
      ).toBe(false);
    });

    it("projects a WEEKLY slot onto later weeks so recurring clashes are caught", () => {
      // Same weekday and time, several weeks after the first occurrence.
      expect(
        busySlotClashes(
          slotStart,
          slotEnd,
          "WEEKLY",
          new Date("2030-09-25T14:00:00.000Z"),
          new Date("2030-09-25T16:00:00.000Z"),
        ),
      ).toBe(true);
      // Later week, different time on that weekday: no clash.
      expect(
        busySlotClashes(
          slotStart,
          slotEnd,
          "WEEKLY",
          new Date("2030-09-25T16:00:00.000Z"),
          new Date("2030-09-25T18:00:00.000Z"),
        ),
      ).toBe(false);
    });

    it("never reports a clash for occurrences before the slot's first week", () => {
      expect(
        busySlotClashes(
          slotStart,
          slotEnd,
          "WEEKLY",
          new Date("2030-08-28T14:00:00.000Z"),
          new Date("2030-08-28T16:00:00.000Z"),
        ),
      ).toBe(false);
    });

    it("fails safe (no clash) for degenerate or missing inputs", () => {
      expect(busySlotClashes(slotEnd, slotStart, null, slotStart, slotEnd)).toBe(
        false,
      );
      expect(
        busySlotClashes(undefined, slotEnd, null, slotStart, slotEnd),
      ).toBe(false);
    });
  });

  it("returns stable candidate reason codes", async () => {
    const { client, query } = queryClientWith([
      {
        tutorId: 1,
        fullName: "Eligible Tutor",
        mark: 80,
        weeklyLimit: 8,
        usedHours: 2,
        remainingHours: 6,
        hasClash: false,
        isEligible: true,
      },
      {
        tutorId: 2,
        fullName: "Ineligible Tutor",
        mark: 49,
        weeklyLimit: 8,
        usedHours: 7,
        remainingHours: 1,
        hasClash: true,
        isEligible: false,
      },
    ]);

    const candidates = await findAllocationCandidates(client, {
      courseId: 10,
      startsAt,
      endsAt,
      minimumMark: 50,
      requestedHours: 2,
    });

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual([
      10,
      "2030-09-04 14:00:00.000",
      "2030-09-04 16:00:00.000",
      50,
      2,
      null,
    ]);
    expect(candidates[0]?.reasonCodes).toEqual([]);
    expect(candidates[1]?.reasonCodes).toEqual([
      "insufficient-mark",
      "schedule-clash",
      "hour-limit-exceeded",
    ]);
  });

  it("excludes the edited allocation from hour and clash checks", async () => {
    const { client, query } = queryClientWith([]);

    await findAllocationCandidates(client, {
      courseId: 10,
      startsAt,
      endsAt,
      minimumMark: 50,
      requestedHours: 2,
      excludeAllocationId: 11,
    });

    expect(query.mock.calls[0]?.[1]).toEqual([
      10,
      "2030-09-04 14:00:00.000",
      "2030-09-04 16:00:00.000",
      50,
      2,
      11,
    ]);
    expect(query.mock.calls[0]?.[0]).toContain('a."id" <> $6');
    expect(query.mock.calls[0]?.[0]).toContain('clash."id" <> $6');
  });

  it("keeps an exactly qualified candidate eligible", async () => {
    const { client } = queryClientWith([
      {
        tutorId: 3,
        fullName: "Exact Threshold Tutor",
        mark: 50,
        weeklyLimit: 8,
        usedHours: 6,
        remainingHours: 2,
        hasClash: false,
        isEligible: true,
      },
    ]);

    const candidates = await findAllocationCandidates(client, {
      courseId: 10,
      startsAt,
      endsAt,
      minimumMark: 50,
      requestedHours: 2,
    });

    expect(candidates).toEqual([
      {
        tutorId: 3,
        fullName: "Exact Threshold Tutor",
        mark: 50,
        weeklyLimit: 8,
        usedHours: 6,
        remainingHours: 2,
        hasClash: false,
        isEligible: true,
        reasonCodes: [],
        // 50 sits in the 50s band; 6 of 8 hours is three quarters of the limit.
        markBand: 50,
        capacityShare: 0.75,
      },
    ]);
  });

  it("returns an eligible candidate with clashDetails when no conflicts exist", async () => {
    const { client } = queryClientWith([
      {
        tutorId: 7,
        fullName: "Raquel",
        mark: 80,
        weeklyLimit: 15,
        usedHours: 0,
        remainingHours: 15,
        hasClash: false,
        isEligible: true,
        clashDetails: [],
      },
    ]);

    const candidates = await findAllocationCandidates(client, {
      courseId: 3,
      startsAt: new Date("2026-09-21T08:00:00.000Z"),
      endsAt: new Date("2026-09-21T10:00:00.000Z"),
      minimumMark: 65,
      requestedHours: 2,
    });

    expect(candidates).toEqual([
      {
        tutorId: 7,
        fullName: "Raquel",
        mark: 80,
        weeklyLimit: 15,
        usedHours: 0,
        remainingHours: 15,
        hasClash: false,
        isEligible: true,
        reasonCodes: [],
        clashDetails: [],
        markBand: 80,
        capacityShare: 0,
      },
    ]);
  });

  it("returns clashDetails with specific conflict information", async () => {
    const { client } = queryClientWith([
      {
        tutorId: 7,
        fullName: "Raquel",
        mark: 80,
        weeklyLimit: 15,
        usedHours: 0,
        remainingHours: 15,
        hasClash: true,
        isEligible: false,
        clashDetails: [
          {
            kind: "busy",
            label: "Lecture",
            startsAt: "2026-09-21T08:00:00.000Z",
            endsAt: "2026-09-21T09:45:00.000Z",
            recurrence: "WEEKLY",
          },
        ],
      },
    ]);

    const candidates = await findAllocationCandidates(client, {
      courseId: 3,
      startsAt: new Date("2026-09-21T08:00:00.000Z"),
      endsAt: new Date("2026-09-21T10:00:00.000Z"),
      minimumMark: 65,
      requestedHours: 2,
    });

    expect(candidates[0]?.hasClash).toBe(true);
    expect(candidates[0]?.isEligible).toBe(false);
    expect(candidates[0]?.reasonCodes).toEqual(["schedule-clash"]);
    expect(candidates[0]?.clashDetails).toEqual([
      {
        kind: "busy",
        label: "Lecture",
        startsAt: "2026-09-21T08:00:00.000Z",
        endsAt: "2026-09-21T09:45:00.000Z",
        recurrence: "WEEKLY",
      },
    ]);
  });

  it("handles null recurrence in clashDetails", async () => {
    const { client } = queryClientWith([
      {
        tutorId: 7,
        fullName: "Raquel",
        mark: 80,
        weeklyLimit: 15,
        usedHours: 0,
        remainingHours: 15,
        hasClash: true,
        isEligible: false,
        clashDetails: [
          {
            kind: "allocation",
            label: "COMS3011",
            startsAt: "2026-09-21T08:00:00.000Z",
            endsAt: "2026-09-21T10:00:00.000Z",
            recurrence: null,
          },
        ],
      },
    ]);

    const candidates = await findAllocationCandidates(client, {
      courseId: 3,
      startsAt: new Date("2026-09-21T08:00:00.000Z"),
      endsAt: new Date("2026-09-21T10:00:00.000Z"),
      minimumMark: 65,
      requestedHours: 2,
    });

    expect(candidates[0]?.clashDetails[0]?.recurrence).toBeNull();
  });

  it("makes a candidate eligible when the only clash is the excluded allocation", async () => {
    const { client } = queryClientWith([
      {
        tutorId: 7,
        fullName: "Self-Conflict Tutor",
        mark: 80,
        weeklyLimit: 15,
        usedHours: 0,
        remainingHours: 15,
        hasClash: false,
        isEligible: true,
        clashDetails: [],
      },
    ]);

    const candidates = await findAllocationCandidates(client, {
      courseId: 3,
      startsAt: new Date("2026-09-21T08:00:00.000Z"),
      endsAt: new Date("2026-09-21T10:00:00.000Z"),
      minimumMark: 65,
      requestedHours: 2,
      excludeAllocationId: 42,
    });

    expect(candidates[0]?.isEligible).toBe(true);
    expect(candidates[0]?.reasonCodes).toEqual([]);
  });

  it("still flags other clashes when excludeAllocationId removes only one conflict", async () => {
    const { client } = queryClientWith([
      {
        tutorId: 9,
        fullName: "Partial Exclude Tutor",
        mark: 80,
        weeklyLimit: 15,
        usedHours: 0,
        remainingHours: 15,
        hasClash: true,
        isEligible: false,
        clashDetails: [
          {
            kind: "busy",
            label: "Other Lecture",
            startsAt: "2026-09-21T08:00:00.000Z",
            endsAt: "2026-09-21T09:45:00.000Z",
            recurrence: "ONCE",
          },
        ],
      },
    ]);

    const candidates = await findAllocationCandidates(client, {
      courseId: 3,
      startsAt: new Date("2026-09-21T08:00:00.000Z"),
      endsAt: new Date("2026-09-21T10:00:00.000Z"),
      minimumMark: 65,
      requestedHours: 2,
      excludeAllocationId: 42,
    });

    expect(candidates[0]?.hasClash).toBe(true);
    expect(candidates[0]?.isEligible).toBe(false);
    expect(candidates[0]?.reasonCodes).toEqual(["schedule-clash"]);
  });

  it.each([
    { excludeAllocationId: 0, message: "excludeAllocationId" },
    { excludeAllocationId: -1, message: "excludeAllocationId" },
    { excludeAllocationId: 1.5, message: "excludeAllocationId" },
  ])(
    "rejects invalid excludeAllocationId ($excludeAllocationId)",
    async (invalid) => {
      const { client, query } = queryClientWith([]);

      await expect(
        findAllocationCandidates(client, {
          courseId: 1,
          startsAt,
          endsAt,
          minimumMark: 50,
          requestedHours: 2,
          excludeAllocationId: invalid.excludeAllocationId,
        }),
      ).rejects.toThrow(invalid.message);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([
    { courseId: 0, minimumMark: 50, requestedHours: 2, message: "courseId" },
    { courseId: 1, minimumMark: -1, requestedHours: 2, message: "minimumMark" },
    {
      courseId: 1,
      minimumMark: 50,
      requestedHours: 0,
      message: "requestedHours",
    },
  ])("rejects invalid candidate input: $message", async (invalid) => {
    const { client, query } = queryClientWith([]);

    await expect(
      findAllocationCandidates(client, {
        courseId: invalid.courseId,
        startsAt,
        endsAt,
        minimumMark: invalid.minimumMark,
        requestedHours: invalid.requestedHours,
      }),
    ).rejects.toThrow(invalid.message);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an inverted candidate period", async () => {
    const { client } = queryClientWith([]);

    await expect(
      findAllocationCandidates(client, {
        courseId: 1,
        startsAt: endsAt,
        endsAt: startsAt,
        minimumMark: 50,
        requestedHours: 2,
      }),
    ).rejects.toThrow("endsAt");
  });

  it("returns a tutor hour summary and null for an unknown tutor", async () => {
    const monday = new Date("2030-09-02T00:00:00.000Z");
    const summary = {
      tutorId: 3,
      weeklyLimit: 8,
      usedHours: 2,
      remainingHours: 6,
    };
    const first = queryClientWith([summary]);
    const missing = queryClientWith([]);

    await expect(getTutorHourSummary(first.client, 3, monday)).resolves.toEqual(
      summary,
    );
    await expect(
      getTutorHourSummary(missing.client, 99, monday),
    ).resolves.toBeNull();
  });

  it("requires a positive tutor id and Monday week boundary", async () => {
    const { client, query } = queryClientWith([]);

    await expect(
      getTutorHourSummary(client, 0, new Date("2030-09-02T00:00:00.000Z")),
    ).rejects.toThrow("tutorId");
    await expect(
      getTutorHourSummary(client, 1, new Date("2030-09-03T00:00:00.000Z")),
    ).rejects.toThrow("Monday");
    expect(query).not.toHaveBeenCalled();
  });

  it("returns only the safe open-work projection", async () => {
    const row = {
      id: 7,
      courseCode: "DEMO101",
      courseName: "Demo course",
      startsAt,
      endsAt,
      hours: 2,
      status: "OPEN",
      closesAt: null,
    };
    const { client, query } = queryClientWith([row]);
    const now = new Date("2030-09-01T00:00:00.000Z");

    await expect(listOpenWork(client, now)).resolves.toEqual([row]);
    expect(query.mock.calls[0]?.[1]).toEqual(["2030-09-01 00:00:00.000"]);
  });
});

describe("ranking eligible candidates", () => {
  function candidate(
    overrides: Partial<AllocationCandidate> & { tutorId: number },
  ): AllocationCandidate {
    const mark = overrides.mark ?? 80;
    const weeklyLimit = overrides.weeklyLimit ?? 10;
    const usedHours = overrides.usedHours ?? 0;

    return {
      fullName: `Tutor ${overrides.tutorId}`,
      mark,
      weeklyLimit,
      usedHours,
      remainingHours: Math.max(weeklyLimit - usedHours, 0),
      hasClash: false,
      isEligible: true,
      clashDetails: [],
      reasonCodes: [],
      markBand: Math.floor(mark / 10) * 10,
      capacityShare: weeklyLimit > 0 ? usedHours / weeklyLimit : Number.POSITIVE_INFINITY,
      ...overrides,
    };
  }

  const order = (candidates: AllocationCandidate[]) =>
    rankAllocationCandidates(candidates).map((entry) => entry.tutorId);

  it("puts the better mark band first, even when the lower band is less busy", () => {
    const lowerBandIdle = candidate({ tutorId: 1, mark: 89, usedHours: 0 });
    const higherBandBusy = candidate({ tutorId: 2, mark: 91, usedHours: 9 });

    expect(order([lowerBandIdle, higherBandBusy])).toEqual([2, 1]);
  });

  it("keeps marks inside one band together rather than splitting them", () => {
    // 91 and 96 are both "excellent", so the busier one yields to the freer one
    // instead of taking every session until full.
    const topOfBandBusy = candidate({ tutorId: 1, mark: 96, usedHours: 8 });
    const sameBandIdle = candidate({ tutorId: 2, mark: 91, usedHours: 1 });

    expect(order([topOfBandBusy, sameBandIdle])).toEqual([2, 1]);
  });

  it("compares share of the weekly limit, not raw hours used", () => {
    // Three hours used is the busier tutor at a limit of five, and the freer one
    // at a limit of twenty.
    const smallLimit = candidate({ tutorId: 1, mark: 85, weeklyLimit: 5, usedHours: 3 });
    const largeLimit = candidate({ tutorId: 2, mark: 85, weeklyLimit: 20, usedHours: 3 });

    expect(order([smallLimit, largeLimit])).toEqual([2, 1]);
  });

  it("falls back to the exact mark when band and share match", () => {
    const lower = candidate({ tutorId: 1, mark: 82, usedHours: 4 });
    const higher = candidate({ tutorId: 2, mark: 87, usedHours: 4 });

    expect(order([lower, higher])).toEqual([2, 1]);
  });

  it("breaks a complete tie by tutor id so the order never drifts", () => {
    const later = candidate({ tutorId: 9, mark: 80, usedHours: 2 });
    const earlier = candidate({ tutorId: 4, mark: 80, usedHours: 2 });

    expect(order([later, earlier])).toEqual([4, 9]);
  });

  it("gives the same order however the input arrives", () => {
    const candidates = [
      candidate({ tutorId: 1, mark: 91, usedHours: 9 }),
      candidate({ tutorId: 2, mark: 85, usedHours: 0 }),
      candidate({ tutorId: 3, mark: 85, usedHours: 0 }),
      candidate({ tutorId: 4, mark: 88, usedHours: 5 }),
      candidate({ tutorId: 5, mark: 74, usedHours: 0 }),
    ];
    const expected = [1, 2, 3, 4, 5];

    expect(order(candidates)).toEqual(expected);
    expect(order([...candidates].reverse())).toEqual(expected);
    expect(order([candidates[3]!, candidates[0]!, candidates[4]!, candidates[2]!, candidates[1]!]))
      .toEqual(expected);
  });

  it("ranks only eligible tutors and leaves the rest in the order they arrived", () => {
    const eligibleBusy = candidate({ tutorId: 1, mark: 95, usedHours: 9 });
    const eligibleFree = candidate({ tutorId: 2, mark: 95, usedHours: 0 });
    const blockedHighMark = candidate({
      tutorId: 3,
      mark: 99,
      isEligible: false,
      hasClash: true,
      reasonCodes: ["schedule-clash"],
    });
    const blockedLowMark = candidate({
      tutorId: 4,
      mark: 40,
      isEligible: false,
      reasonCodes: ["insufficient-mark"],
    });

    const ranked = rankAllocationCandidates([
      eligibleBusy,
      blockedHighMark,
      blockedLowMark,
      eligibleFree,
    ]);

    // Eligible tutors are ranked and come first; the ineligible pair keeps the
    // order the query returned, high mark before low, untouched.
    expect(ranked.map((entry) => entry.tutorId)).toEqual([2, 1, 3, 4]);
    expect(ranked.slice(2).map((entry) => entry.reasonCodes)).toEqual([
      ["schedule-clash"],
      ["insufficient-mark"],
    ]);
  });

  it("returns a stable comparison for a candidate against itself", () => {
    const only = candidate({ tutorId: 1 });
    expect(compareEligibleCandidates(only, only)).toBe(0);
  });
});

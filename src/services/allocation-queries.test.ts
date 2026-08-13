import { describe, expect, it, vi } from "vitest";
import {
  findAllocationCandidates,
  getTutorHourSummary,
  listOpenWork,
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
      startsAt,
      endsAt,
      50,
      2,
    ]);
    expect(candidates[0]?.reasonCodes).toEqual([]);
    expect(candidates[1]?.reasonCodes).toEqual([
      "insufficient-mark",
      "schedule-clash",
      "hour-limit-exceeded",
    ]);
  });

  it.each([
    { courseId: 0, minimumMark: 50, requestedHours: 2, message: "courseId" },
    { courseId: 1, minimumMark: -1, requestedHours: 2, message: "minimumMark" },
    { courseId: 1, minimumMark: 50, requestedHours: 0, message: "requestedHours" },
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
    await expect(getTutorHourSummary(missing.client, 99, monday)).resolves.toBeNull();
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
    expect(query.mock.calls[0]?.[1]).toEqual([now]);
  });
});

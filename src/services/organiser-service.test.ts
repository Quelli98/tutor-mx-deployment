import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AllocationWriteInput } from "../app.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createOrganiserService } from "./organiser-service.js";
import { busySlotClashes, timeRangesOverlap } from "./allocation-queries.js";

const startsAt = new Date("2030-09-04T14:00:00.000Z");
const endsAt = new Date("2030-09-04T16:00:00.000Z");

function allocationInput(
  overrides: Partial<AllocationWriteInput> = {},
): AllocationWriteInput {
  return {
    tutorId: 7,
    courseId: 9,
    startsAt,
    endsAt,
    minimumMark: 65,
    requestedHours: 2,
    ...overrides,
  };
}

function allocationRow(
  overrides: Partial<{
    id: number;
    tutorId: number;
    courseId: number;
    startsAt: Date;
    endsAt: Date;
    allocatedHours: unknown;
    status: "PROPOSED" | "CONFIRMED" | "CANCELLED";
  }> = {},
) {
  return {
    id: 11,
    tutorId: 7,
    courseId: 9,
    startsAt,
    endsAt,
    allocatedHours: "2.00",
    status: "PROPOSED" as const,
    ...overrides,
  };
}

function createHarness() {
  const transaction = {
    profile: {
      findUnique: vi.fn(),
    },
    course: {
      findUnique: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
    allocation: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    timesheet: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    volunteerClaim: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const client = {
    ...transaction,
    $transaction: vi.fn(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  };

  return {
    client,
    transaction,
    service: createOrganiserService(client as unknown as PrismaClient),
  };
}

type Harness = ReturnType<typeof createHarness>;

function arrangePassingAllocationRules(
  harness: Harness,
  options: {
    mark?: number | null;
    weeklyHours?: number | null;
    usedHours?: number | null;
    busySlots?: Array<{
      startsAt: Date;
      endsAt: Date;
      recurrence?: string | null;
    }>;
    confirmedAllocations?: Array<{ startsAt: Date; endsAt: Date }>;
  } = {},
) {
  const {
    mark = 65,
    weeklyHours = 8,
    usedHours = 6,
    busySlots = [],
    confirmedAllocations = [],
  } = options;
  const { transaction } = harness;

  transaction.profile.findUnique.mockImplementation(async ({ where }) =>
    where.auth0Id === "auth0|organiser"
      ? { id: 21, role: "ORGANISER" }
      : { role: "TUTOR" },
  );
  transaction.course.findUnique.mockResolvedValue({ id: 9 });
  transaction.$queryRawUnsafe.mockImplementation(
    async (sql: string, ...params: unknown[]) => {
      if (typeof sql === "string" && sql.includes("candidate_data")) {
        if (mark === null) {
          return [];
        }
        const usedHoursValue = usedHours ?? 0;
        const remaining =
          weeklyHours === null
            ? 0
            : Math.round(Math.max(weeklyHours - usedHoursValue, 0) * 1e10) /
              1e10;

        const clashDetails: Array<{
          kind: "busy" | "allocation";
          label: string | null;
          startsAt: string;
          endsAt: string;
          recurrence: "WEEKLY" | null;
        }> = [];
        for (const slot of busySlots) {
          if (
            busySlotClashes(
              slot.startsAt,
              slot.endsAt,
              slot.recurrence ?? undefined,
              startsAt,
              endsAt,
            )
          ) {
            clashDetails.push({
              kind: "busy",
              label: null,
              startsAt: slot.startsAt.toISOString(),
              endsAt: slot.endsAt.toISOString(),
              recurrence: (slot.recurrence ?? null) as "WEEKLY" | null,
            });
          }
        }
        for (const alloc of confirmedAllocations) {
          if (
            timeRangesOverlap(
              alloc.startsAt,
              alloc.endsAt,
              startsAt,
              endsAt,
            ) === true
          ) {
            clashDetails.push({
              kind: "allocation",
              label: null,
              startsAt: alloc.startsAt.toISOString(),
              endsAt: alloc.endsAt.toISOString(),
              recurrence: null,
            });
          }
        }

        const hasClash = clashDetails.length > 0;
        const minimumMark = (params[3] as number) ?? 65;
        const requestedHours = (params[4] as number) ?? 2;

        return [
          {
            tutorId: 7,
            fullName: "Test Tutor",
            mark,
            weeklyLimit: weeklyHours ?? 0,
            usedHours: usedHoursValue,
            remainingHours: remaining,
            hasClash,
            isEligible:
              mark >= minimumMark && !hasClash && remaining >= requestedHours,
            clashDetails,
          },
        ];
      }
      return [];
    },
  );
}

describe("organiser allocation service", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it("lists active allocations with safe tutor and course details", async () => {
    harness.transaction.allocation.findMany.mockResolvedValue([
      {
        ...allocationRow({ status: "CONFIRMED" }),
        tutor: { fullName: "Sam Tutor", email: "sam@tutormx.example" },
        course: { code: "COMS3011", name: "Software Design Project" },
      },
    ]);

    await expect(harness.service.listAllocations()).resolves.toEqual([
      {
        id: 11,
        tutorId: 7,
        courseId: 9,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        allocatedHours: 2,
        status: "CONFIRMED",
        tutorName: "Sam Tutor",
        tutorEmail: "sam@tutormx.example",
        courseCode: "COMS3011",
        courseName: "Software Design Project",
      },
    ]);
  });

  it("lists submitted timesheets and pending overflow claims with review details", async () => {
    harness.transaction.timesheet.findMany.mockResolvedValue([
      {
        id: 31,
        tutorId: 7,
        tutor: { fullName: "Sam Tutor", email: "sam@tutormx.example" },
        weekStart: new Date("2030-09-02T00:00:00.000Z"),
        submittedAt: new Date("2030-09-07T10:00:00.000Z"),
        workLogs: [
          {
            id: 41,
            allocationId: 11,
            workDate: new Date("2030-09-04T00:00:00.000Z"),
            hours: "2.00",
            description: "Tutorial",
            allocation: { course: { code: "COMS3011", name: "Software Design Project" } },
          },
        ],
      },
    ]);
    harness.transaction.volunteerClaim.findMany.mockResolvedValue([
      {
        id: 51,
        overflowWorkId: 61,
        studentId: 9,
        createdAt: new Date("2030-09-08T10:00:00.000Z"),
        student: { fullName: "Ada Student", email: "ada@tutormx.example" },
        overflowWork: {
          startsAt: new Date("2030-09-10T14:00:00.000Z"),
          endsAt: new Date("2030-09-10T16:00:00.000Z"),
          hours: "2.00",
          course: { code: "COMS3011", name: "Software Design Project" },
        },
      },
    ]);

    const result = await harness.service.listApprovals();
    expect(result.timesheets[0]).toMatchObject({
      id: 31,
      tutorName: "Sam Tutor",
      totalHours: 2,
      workLogs: [{ courseCode: "COMS3011", hours: 2 }],
    });
    expect(result.volunteerClaims[0]).toMatchObject({
      id: 51,
      studentName: "Ada Student",
      courseCode: "COMS3011",
      hours: 2,
    });
  });

  it("creates a proposed allocation at exact mark/hour thresholds with touching ranges", async () => {
    arrangePassingAllocationRules(harness, {
      busySlots: [
        {
          startsAt: new Date("2030-09-04T12:00:00.000Z"),
          endsAt: startsAt,
        },
      ],
      confirmedAllocations: [
        {
          startsAt: endsAt,
          endsAt: new Date("2030-09-04T18:00:00.000Z"),
        },
      ],
    });
    harness.transaction.allocation.create.mockResolvedValue(allocationRow());

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).resolves.toEqual({
      id: 11,
      tutorId: 7,
      courseId: 9,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      allocatedHours: 2,
      status: "PROPOSED",
    });
    expect(harness.transaction.allocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tutorId: 7,
          courseId: 9,
          startsAt,
          endsAt,
          allocatedHours: 2,
        },
      }),
    );
    expect(harness.transaction.allocation.update).not.toHaveBeenCalled();
    expect(harness.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });

  it("keeps an exact fractional weekly-hour boundary eligible", async () => {
    arrangePassingAllocationRules(harness, {
      weeklyHours: 0.3,
      usedHours: 0.2,
    });
    harness.transaction.allocation.create.mockResolvedValue(
      allocationRow({ allocatedHours: "0.10" }),
    );

    await expect(
      harness.service.createAllocation(

        "auth0|organiser",
        allocationInput({ requestedHours: 0.1 }),
      ),
    ).resolves.toMatchObject({ allocatedHours: 0.1 });
  });

  it("creates then confirms an allocation without bypassing the proposed initial state", async () => {
    arrangePassingAllocationRules(harness);
    harness.transaction.allocation.create.mockResolvedValue(allocationRow());
    harness.transaction.allocation.update.mockResolvedValue(
      allocationRow({ status: "CONFIRMED" }),
    );

    const result = await harness.service.createAllocation(


      "auth0|organiser",
      allocationInput({ status: "CONFIRMED" }),
    );

    expect(result.status).toBe("CONFIRMED");
    expect(harness.transaction.allocation.create.mock.calls[0]?.[0].data).not
      .toHaveProperty("status");
    expect(harness.transaction.allocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: { status: "CONFIRMED", reviewedById: 21, reviewedAt: expect.any(Date) },
      }),
    );
  });

  it.each([null, { id: 7, role: "TUTOR" }])("rejects confirmation without an organiser profile: %j", async (profile) => {
    arrangePassingAllocationRules(harness);
    harness.transaction.profile.findUnique.mockImplementation(async ({ where }) =>
      where.auth0Id ? profile : { role: "TUTOR" },
    );
    harness.transaction.allocation.create.mockResolvedValue(allocationRow());

    await expect(harness.service.createAllocation(
      "auth0|organiser", allocationInput({ status: "CONFIRMED" }),
    )).rejects.toMatchObject({ code: "ORGANISER_PROFILE_NOT_FOUND" });
    expect(harness.transaction.allocation.update).not.toHaveBeenCalled();
  });

  it("rejects an allocation below the mark requirement with the canonical reason code", async () => {
    arrangePassingAllocationRules(harness, { mark: 64 });

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).rejects.toMatchObject({ status: 409, code: "insufficient-mark" });
    expect(harness.transaction.allocation.create).not.toHaveBeenCalled();
  });

  it("rejects an overlapping allocation with the canonical clash reason code", async () => {
    arrangePassingAllocationRules(harness, {
      confirmedAllocations: [
        {
          startsAt: new Date("2030-09-04T15:00:00.000Z"),
          endsAt: new Date("2030-09-04T17:00:00.000Z"),
        },
      ],
    });

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).rejects.toMatchObject({ status: 409, code: "schedule-clash" });
    expect(harness.transaction.allocation.create).not.toHaveBeenCalled();
  });

  it("rejects a WEEKLY busy slot whose earlier occurrence recurs into the request", async () => {
    // The slot's own window is a week before the request and never overlaps it,
    // so only the recurrence rule can detect the clash. This is the create-path
    // twin of the candidate board's WEEKLY branch.
    arrangePassingAllocationRules(harness, {
      busySlots: [
        {
          startsAt: new Date("2030-08-28T14:00:00.000Z"),
          endsAt: new Date("2030-08-28T16:00:00.000Z"),
          recurrence: "WEEKLY",
        },
      ],
    });

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).rejects.toMatchObject({ status: 409, code: "schedule-clash" });
    expect(harness.transaction.allocation.create).not.toHaveBeenCalled();
  });

  it("allows a WEEKLY busy slot whose occurrences never meet the request window", async () => {
    // WEEKLY on a different time-of-day: no occurrence overlaps the request.
    arrangePassingAllocationRules(harness, {
      busySlots: [
        {
          startsAt: new Date("2030-08-28T18:00:00.000Z"),
          endsAt: new Date("2030-08-28T19:00:00.000Z"),
          recurrence: "WEEKLY",
        },
      ],
    });
    harness.transaction.allocation.create.mockResolvedValue(allocationRow());

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).resolves.toMatchObject({ status: "PROPOSED" });
    expect(harness.transaction.allocation.create).toHaveBeenCalled();
  });

  it("rejects an allocation over the weekly-hour limit with the canonical reason code", async () => {
    arrangePassingAllocationRules(harness, {
      weeklyHours: 8,
      usedHours: 6.01,
    });

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).rejects.toMatchObject({ status: 409, code: "hour-limit-exceeded" });
    expect(harness.transaction.allocation.create).not.toHaveBeenCalled();
  });

  it("fails closed when a tutor has no weekly-hour rule", async () => {
    arrangePassingAllocationRules(harness, { weeklyHours: null });

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).rejects.toMatchObject({ status: 409, code: "hour-limit-exceeded" });
  });

  it("fails closed when the tutor has no course mark", async () => {
    arrangePassingAllocationRules(harness, { mark: null, usedHours: null });

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).rejects.toMatchObject({ status: 409, code: "insufficient-mark" });
  });

  it.each([null, { role: "STUDENT" }])(
    "returns a non-revealing missing-tutor error for %o",
    async (profile) => {
      harness.transaction.profile.findUnique.mockResolvedValue(profile);

      await expect(
        harness.service.createAllocation("auth0|organiser", allocationInput()),
      ).rejects.toMatchObject({ status: 404, code: "TUTOR_NOT_FOUND" });
      expect(harness.transaction.course.findUnique).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing course before persistence", async () => {
    harness.transaction.profile.findUnique.mockResolvedValue({ role: "TUTOR" });
    harness.transaction.course.findUnique.mockResolvedValue(null);

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).rejects.toMatchObject({ status: 404, code: "COURSE_NOT_FOUND" });
    expect(harness.transaction.allocation.create).not.toHaveBeenCalled();
  });

  it("maps expected Prisma allocation conflicts to a safe route error", async () => {
    arrangePassingAllocationRules(harness);
    harness.transaction.allocation.create.mockRejectedValue(
      Object.assign(new Error("private constraint details"), { code: "P2004" }),
    );

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).rejects.toMatchObject({
      status: 409,
      code: "ALLOCATION_CONFLICT",
      message:
        "The allocation conflicts with current tutor, course or workflow data.",
    });
  });

  it("preserves an unexpected allocation dependency error", async () => {
    const unexpected = new Error("unexpected dependency failure");
    arrangePassingAllocationRules(harness);
    harness.transaction.allocation.create.mockRejectedValue(unexpected);

    await expect(
      harness.service.createAllocation("auth0|organiser", allocationInput()),
    ).rejects.toBe(unexpected);
  });

  it("updates a proposed allocation to confirmed while excluding itself from both rules", async () => {
    arrangePassingAllocationRules(harness);
    harness.transaction.allocation.findUnique
      .mockResolvedValueOnce({ id: 11, status: "PROPOSED" })
      .mockResolvedValueOnce(allocationRow({ status: "CONFIRMED" }));
    harness.transaction.allocation.updateMany.mockResolvedValue({ count: 1 });

    const result = await harness.service.updateAllocation(


      "auth0|organiser",
      11,
      allocationInput({ status: "CONFIRMED" }),
    );

    expect(result.status).toBe("CONFIRMED");
    expect(harness.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
      11,
    );
    expect(harness.transaction.allocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11, status: "PROPOSED" },
        data: expect.objectContaining({ status: "CONFIRMED", reviewedById: 21, reviewedAt: expect.any(Date) }),
      }),
    );
  });

  it("returns not found when updating a missing allocation", async () => {
    harness.transaction.allocation.findUnique.mockResolvedValue(null);

    await expect(
      harness.service.updateAllocation("auth0|organiser", 404, allocationInput()),
    ).rejects.toMatchObject({ status: 404, code: "ALLOCATION_NOT_FOUND" });
  });

  it.each([
    {
      current: "CANCELLED",
      requested: undefined,
      name: "cancelled allocation",
    },
    {
      current: "CONFIRMED",
      requested: "PROPOSED" as const,
      name: "invalid confirmed-to-proposed transition",
    },
  ])("rejects an update for a $name", async ({ current, requested }) => {
    harness.transaction.allocation.findUnique.mockResolvedValue({
      id: 11,
      status: current,
    });

    await expect(
      harness.service.updateAllocation(

        "auth0|organiser",
        11,
        allocationInput(requested ? { status: requested } : {}),
      ),
    ).rejects.toMatchObject({ status: 409, code: "ALLOCATION_CONFLICT" });
    expect(harness.transaction.allocation.updateMany).not.toHaveBeenCalled();
  });

  it("reports a stale allocation update when the conditional update changes no row", async () => {
    arrangePassingAllocationRules(harness);
    harness.transaction.allocation.findUnique.mockResolvedValue({
      id: 11,
      status: "PROPOSED",
    });
    harness.transaction.allocation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      harness.service.updateAllocation("auth0|organiser", 11, allocationInput()),
    ).rejects.toMatchObject({ status: 409, code: "ALLOCATION_CONFLICT" });
  });

  it("reports a stale allocation update when the changed row disappears", async () => {
    arrangePassingAllocationRules(harness);
    harness.transaction.allocation.findUnique
      .mockResolvedValueOnce({ id: 11, status: "PROPOSED" })
      .mockResolvedValueOnce(null);
    harness.transaction.allocation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      harness.service.updateAllocation("auth0|organiser", 11, allocationInput()),
    ).rejects.toMatchObject({ status: 409, code: "ALLOCATION_CONFLICT" });
  });

  it("soft-removes an allocation and releases its hours without an eligibility recheck", async () => {
    harness.transaction.profile.findUnique.mockResolvedValue({
      id: 21,
      role: "ORGANISER",
    });
    harness.transaction.allocation.findUnique.mockResolvedValue(
      allocationRow({ status: "CONFIRMED" }),
    );
    harness.transaction.allocation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      harness.service.removeAllocation("auth0|organiser", 11),
    ).resolves.toBeUndefined();
    expect(harness.transaction.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(harness.transaction.allocation.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: "CONFIRMED" },
      data: { status: "CANCELLED", reviewedById: 21, reviewedAt: expect.any(Date) },
    });
  });

  it("still removes an allocation when the tutor's eligibility later changes", async () => {
    arrangePassingAllocationRules(harness, { mark: 64 });
    harness.transaction.allocation.findUnique.mockResolvedValue(allocationRow());
    harness.transaction.allocation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      harness.service.removeAllocation("auth0|organiser", 11),
    ).resolves.toBeUndefined();
    expect(harness.transaction.allocation.updateMany).toHaveBeenCalledTimes(1);
  });

  it("returns not found when removing a missing allocation", async () => {
    harness.transaction.allocation.findUnique.mockResolvedValue(null);

    await expect(
      harness.service.removeAllocation("auth0|organiser", 404),
    ).rejects.toMatchObject({ status: 404, code: "ALLOCATION_NOT_FOUND" });
  });

  it("rejects duplicate removal of a cancelled allocation", async () => {
    harness.transaction.allocation.findUnique.mockResolvedValue(
      allocationRow({ status: "CANCELLED" }),
    );

    await expect(
      harness.service.removeAllocation("auth0|organiser", 11),
    ).rejects.toMatchObject({ status: 409, code: "ALLOCATION_CONFLICT" });
  });

  it("reports a stale allocation removal when the conditional update changes no row", async () => {
    arrangePassingAllocationRules(harness);
    harness.transaction.allocation.findUnique.mockResolvedValue(allocationRow());
    harness.transaction.allocation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      harness.service.removeAllocation("auth0|organiser", 11),
    ).rejects.toMatchObject({ status: 409, code: "ALLOCATION_CONFLICT" });
  });
});

describe("organiser timesheet decisions", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  function arrangeSubmittedTimesheet() {
    harness.transaction.profile.findUnique.mockResolvedValue({
      id: 21,
      role: "ORGANISER",
    });
    harness.transaction.timesheet.findUnique
      .mockResolvedValueOnce({ status: "SUBMITTED" })
      .mockResolvedValueOnce({
        id: 31,
        tutorId: 7,
        weekStart: new Date("2030-09-02T00:00:00.000Z"),
        status: "APPROVED",
        reviewedAt: new Date("2030-09-08T10:00:00.000Z"),
        reviewedById: 21,
        reviewReason: null,
      });
    harness.transaction.timesheet.updateMany.mockResolvedValue({ count: 1 });
  }

  it("approves a submitted timesheet using the trusted organiser subject", async () => {
    arrangeSubmittedTimesheet();

    const result = await harness.service.decideTimesheet(
      "auth0|trusted-organiser",
      31,
      { decision: "APPROVE" },
    );

    expect(result).toMatchObject({
      id: 31,
      tutorId: 7,
      weekStart: "2030-09-02",
      status: "APPROVED",
      reviewedById: 21,
      reviewReason: null,
    });
    expect(harness.transaction.profile.findUnique).toHaveBeenCalledWith({
      where: { auth0Id: "auth0|trusted-organiser" },
      select: { id: true, role: true },
    });
    expect(harness.transaction.timesheet.updateMany).toHaveBeenCalledWith({
      where: { id: 31, status: "SUBMITTED" },
      data: {
        status: "APPROVED",
        reviewedAt: expect.any(Date),
        reviewedById: 21,
        reviewReason: null,
      },
    });
  });

  it("returns a submitted timesheet with the required review reason", async () => {
    arrangeSubmittedTimesheet();
    harness.transaction.timesheet.findUnique.mockReset();
    harness.transaction.timesheet.findUnique
      .mockResolvedValueOnce({ status: "SUBMITTED" })
      .mockResolvedValueOnce({
        id: 31,
        tutorId: 7,
        weekStart: new Date("2030-09-02T00:00:00.000Z"),
        status: "RETURNED",
        reviewedAt: new Date("2030-09-08T10:00:00.000Z"),
        reviewedById: 21,
        reviewReason: "Please clarify Friday's hours.",
      });

    const result = await harness.service.decideTimesheet(
      "auth0|trusted-organiser",
      31,
      { decision: "RETURN", reason: "Please clarify Friday's hours." },
    );

    expect(result).toMatchObject({
      status: "RETURNED",
      reviewReason: "Please clarify Friday's hours.",
    });
    expect(harness.transaction.timesheet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "RETURNED",
          reviewReason: "Please clarify Friday's hours.",
        }),
      }),
    );
  });

  it.each([null, { id: 21, role: "TUTOR" }])(
    "rejects an untrusted organiser profile: %o",
    async (profile) => {
      harness.transaction.profile.findUnique.mockResolvedValue(profile);

      await expect(
        harness.service.decideTimesheet("auth0|not-organiser", 31, {
          decision: "APPROVE",
        }),
      ).rejects.toMatchObject({
        status: 404,
        code: "ORGANISER_PROFILE_NOT_FOUND",
      });
      expect(harness.transaction.timesheet.findUnique).not.toHaveBeenCalled();
    },
  );

  it("returns not found for a missing timesheet", async () => {
    harness.transaction.profile.findUnique.mockResolvedValue({
      id: 21,
      role: "ORGANISER",
    });
    harness.transaction.timesheet.findUnique.mockResolvedValue(null);

    await expect(
      harness.service.decideTimesheet("auth0|organiser", 404, {
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject({ status: 404, code: "TIMESHEET_NOT_FOUND" });
  });

  it.each(["DRAFT", "APPROVED", "RETURNED"])(
    "rejects an invalid or duplicate decision for a %s timesheet",
    async (status) => {
      harness.transaction.profile.findUnique.mockResolvedValue({
        id: 21,
        role: "ORGANISER",
      });
      harness.transaction.timesheet.findUnique.mockResolvedValue({ status });

      await expect(
        harness.service.decideTimesheet("auth0|organiser", 31, {
          decision: "APPROVE",
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "TIMESHEET_DECISION_CONFLICT",
      });
      expect(harness.transaction.timesheet.updateMany).not.toHaveBeenCalled();
    },
  );

  it("reports a stale timesheet decision when the conditional update changes no row", async () => {
    arrangeSubmittedTimesheet();
    harness.transaction.timesheet.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      harness.service.decideTimesheet("auth0|organiser", 31, {
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "TIMESHEET_DECISION_CONFLICT",
    });
  });

  it("reports a stale timesheet decision when the decided row disappears", async () => {
    arrangeSubmittedTimesheet();
    harness.transaction.timesheet.findUnique.mockReset();
    harness.transaction.timesheet.findUnique
      .mockResolvedValueOnce({ status: "SUBMITTED" })
      .mockResolvedValueOnce(null);

    await expect(
      harness.service.decideTimesheet("auth0|organiser", 31, {
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "TIMESHEET_DECISION_CONFLICT",
    });
  });

  it("maps expected Prisma timesheet conflicts without exposing details", async () => {
    arrangeSubmittedTimesheet();
    harness.transaction.timesheet.updateMany.mockRejectedValue(
      Object.assign(new Error("private trigger details"), { code: "P2004" }),
    );

    await expect(
      harness.service.decideTimesheet("auth0|organiser", 31, {
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "TIMESHEET_DECISION_CONFLICT",
      message:
        "The timesheet decision conflicts with its current workflow state.",
    });
  });
});

describe("organiser volunteer-claim decisions", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  function arrangePendingClaim(
    decidedStatus: "ACCEPTED" | "REJECTED" = "ACCEPTED",
    reviewReason: string | null = null,
  ) {
    harness.transaction.volunteerClaim.findUnique
      .mockResolvedValueOnce({
        status: "PENDING",
        overflowWorkId: 51,
        overflowWork: {
          status: "OPEN",
          startsAt: new Date("2030-09-04T14:00:00.000Z"),
          closesAt: null,
        },
      })
      .mockResolvedValueOnce({
        id: 41,
        overflowWorkId: 51,
        studentId: 61,
        status: decidedStatus,
        reviewReason,
      });
    harness.transaction.volunteerClaim.updateMany.mockResolvedValue({ count: 1 });
  }

  it("maps an approved volunteer request to the persisted ACCEPTED state", async () => {
    arrangePendingClaim();

    await expect(
      harness.service.decideVolunteerClaim(41, { decision: "APPROVE" }),
    ).resolves.toEqual({
      id: 41,
      overflowWorkId: 51,
      studentId: 61,
      status: "ACCEPTED",
      reviewReason: null,
    });
    expect(harness.transaction.volunteerClaim.updateMany).toHaveBeenCalledWith({
      where: { id: 41, status: "PENDING" },
      data: { status: "ACCEPTED", reviewReason: null },
    });
    expect(harness.transaction.volunteerClaim.updateMany).toHaveBeenCalledWith({
      where: {
        overflowWorkId: 51,
        id: { not: 41 },
        status: "PENDING",
      },
      data: {
        status: "REJECTED",
        reviewReason: "Another volunteer was selected.",
      },
    });
  });

  it.each([
    {
      label: "already-filled work",
      overflowWork: {
        status: "FILLED",
        startsAt: new Date("2030-09-04T14:00:00.000Z"),
        closesAt: null,
      },
    },
    {
      label: "expired work",
      overflowWork: {
        status: "OPEN",
        startsAt: new Date("2020-09-04T14:00:00.000Z"),
        closesAt: null,
      },
    },
  ])("rejects approval for $label before persistence", async ({ overflowWork }) => {
    harness.transaction.volunteerClaim.findUnique.mockResolvedValue({
      status: "PENDING",
      overflowWork,
    });

    await expect(
      harness.service.decideVolunteerClaim(41, { decision: "APPROVE" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_CLAIM_DECISION_CONFLICT",
    });
    expect(
      harness.transaction.volunteerClaim.updateMany,
    ).not.toHaveBeenCalled();
  });

  it("rejects a volunteer request with its review reason", async () => {
    arrangePendingClaim("REJECTED", "The work has already been reassigned.");

    const result = await harness.service.decideVolunteerClaim(41, {
      decision: "REJECT",
      reason: "The work has already been reassigned.",
    });

    expect(result).toMatchObject({
      status: "REJECTED",
      reviewReason: "The work has already been reassigned.",
    });
    expect(harness.transaction.volunteerClaim.updateMany).toHaveBeenCalledWith({
      where: { id: 41, status: "PENDING" },
      data: {
        status: "REJECTED",
        reviewReason: "The work has already been reassigned.",
      },
    });
  });

  it("returns not found for a missing volunteer claim", async () => {
    harness.transaction.volunteerClaim.findUnique.mockResolvedValue(null);

    await expect(
      harness.service.decideVolunteerClaim(404, { decision: "APPROVE" }),
    ).rejects.toMatchObject({
      status: 404,
      code: "VOLUNTEER_CLAIM_NOT_FOUND",
    });
  });

  it.each(["ACCEPTED", "REJECTED", "WITHDRAWN"])(
    "rejects an invalid or duplicate decision for a %s claim",
    async (status) => {
      harness.transaction.volunteerClaim.findUnique.mockResolvedValue({ status });

      await expect(
        harness.service.decideVolunteerClaim(41, { decision: "APPROVE" }),
      ).rejects.toMatchObject({
        status: 409,
        code: "VOLUNTEER_CLAIM_DECISION_CONFLICT",
      });
      expect(
        harness.transaction.volunteerClaim.updateMany,
      ).not.toHaveBeenCalled();
    },
  );

  it("reports a stale claim decision when the conditional update changes no row", async () => {
    arrangePendingClaim();
    harness.transaction.volunteerClaim.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      harness.service.decideVolunteerClaim(41, { decision: "APPROVE" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_CLAIM_DECISION_CONFLICT",
    });
  });

  it("reports a stale claim decision when the decided row disappears", async () => {
    arrangePendingClaim();
    harness.transaction.volunteerClaim.findUnique.mockReset();
    harness.transaction.volunteerClaim.findUnique
      .mockResolvedValueOnce({
        status: "PENDING",
        overflowWork: {
          status: "OPEN",
          startsAt: new Date("2030-09-04T14:00:00.000Z"),
          closesAt: null,
        },
      })
      .mockResolvedValueOnce(null);

    await expect(
      harness.service.decideVolunteerClaim(41, { decision: "APPROVE" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_CLAIM_DECISION_CONFLICT",
    });
  });

  it("maps expected Prisma claim conflicts without exposing details", async () => {
    arrangePendingClaim();
    harness.transaction.volunteerClaim.updateMany.mockRejectedValue(
      Object.assign(new Error("private index details"), { code: "P2034" }),
    );

    await expect(
      harness.service.decideVolunteerClaim(41, { decision: "APPROVE" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_CLAIM_DECISION_CONFLICT",
      message:
        "The volunteer-claim decision conflicts with its current workflow state.",
    });
  });

  it("maps the adapter's PostgreSQL trigger error to a safe claim conflict", async () => {
    arrangePendingClaim();
    harness.transaction.volunteerClaim.updateMany.mockRejectedValue(
      Object.assign(new Error("private PostgreSQL trigger details"), {
        code: "P2039",
        meta: {
          driverAdapterError: {
            cause: { originalCode: "23514" },
          },
        },
      }),
    );

    await expect(
      harness.service.decideVolunteerClaim(41, { decision: "APPROVE" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_CLAIM_DECISION_CONFLICT",
      message:
        "The volunteer-claim decision conflicts with its current workflow state.",
    });
  });

  it("preserves an unexpected volunteer-claim dependency error", async () => {
    const unexpected = new Error("unexpected dependency failure");
    arrangePendingClaim();
    harness.transaction.volunteerClaim.updateMany.mockRejectedValue(unexpected);

    await expect(
      harness.service.decideVolunteerClaim(41, { decision: "APPROVE" }),
    ).rejects.toBe(unexpected);
  });
});

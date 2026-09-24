import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createOrganiserOverflowWorkService } from "./organiser-overflow-service.js";

const START = new Date("2030-09-04T14:00:00.000Z");
const END = new Date("2030-09-04T18:00:00.000Z");
const VERSION = new Date("2026-09-23T09:00:00.000Z");
const NEW_VERSION = new Date("2026-09-23T10:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    courseId: 3,
    startsAt: START,
    endsAt: END,
    hours: 4,
    status: "OPEN",
    closesAt: null,
    sourceRequirementId: null,
    slotIndex: null,
    createdAt: new Date("2026-09-20T09:00:00.000Z"),
    updatedAt: VERSION,
    course: { code: "COMS3011", name: "Software Design Project" },
    volunteerClaims: [] as { status: string }[],
    ...overrides,
  };
}

interface HarnessOptions {
  course?: { id: number } | null;
  requirement?: {
    id: number;
    courseId?: number;
    startsAt?: Date;
    endsAt?: Date;
    tutorsNeeded?: number;
    status?: string;
  } | null;
  overflowWork?: ReturnType<typeof row> | null;
  /** Rows the compare-and-set write reports having changed. */
  updateCount?: number;
  /** Confirmed hours the shortage query reports for requirement 12. */
  assignedHours?: number;
}

function createHarness(options: HarnessOptions = {}) {
  const {
    course = { id: 3 },
    requirement = {
      id: 12,
      courseId: 3,
      startsAt: START,
      endsAt: END,
      tutorsNeeded: 2,
      status: "OPEN",
    },
    overflowWork = row(),
    updateCount = 1,
    assignedHours = 0,
  } = options;

  const transaction = {
    course: { findUnique: vi.fn().mockResolvedValue(course) },
    staffingRequirement: {
      findUnique: vi.fn().mockResolvedValue(requirement),
    },
    overflowWork: {
      findMany: vi.fn().mockImplementation((args?: { where?: unknown }) => {
        // When checking for existing items during create, return empty array
        if (args?.where) {
          return Promise.resolve([]);
        }
        // When listing all items, return the mock row
        return Promise.resolve([overflowWork]);
      }),
      findUnique: vi.fn().mockResolvedValue(overflowWork),
      create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve(row({
          sourceRequirementId: args.data.sourceRequirementId ?? null,
          slotIndex: args.data.slotIndex ?? null,
          hours: args.data.hours ?? 4,
        }))
      ),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
    },
    $queryRawUnsafe: vi.fn(async (_sql: string, requirementIds?: number[]) =>
      (requirementIds ?? []).map((requirementId) => ({
        requirementId,
        assignedHours,
      }))),
  };

  const client = {
    ...transaction,
    $transaction: vi.fn(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  };

  // Stands in for the grouped query that reports confirmed hours per
  // requirement; its SQL is covered against Postgres in staffing-shortage.test.ts.
  const queryClient = {
    query: vi.fn(async (_sql: string, parameters?: unknown[]) => ({
      rows: ((parameters?.[0] as number[]) ?? []).map((requirementId) => ({
        requirementId,
        assignedHours,
      })),
    })),
  };

  return {
    client,
    transaction,
    queryClient,
    service: createOrganiserOverflowWorkService(
      client as unknown as PrismaClient,
    ),
  };
}

type Harness = ReturnType<typeof createHarness>;

const createInput = {
  courseId: 3,
  startsAt: START,
  endsAt: END,
  hours: 4,
  closesAt: null,
  sourceRequirementId: null,
};

const updateInput = {
  courseId: 3,
  startsAt: START,
  endsAt: END,
  hours: 3,
  closesAt: null,
  expectedUpdatedAt: VERSION,
};

describe("organiser overflow work service", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("listing", () => {
    it("returns every item with claim counts, window hours and source link", async () => {
      harness = createHarness({
        overflowWork: row({
          sourceRequirementId: 12,
          volunteerClaims: [
            { status: "PENDING" },
            { status: "PENDING" },
            { status: "ACCEPTED" },
            { status: "REJECTED" },
          ],
        }),
      });

      await expect(harness.service.listOverflowWork()).resolves.toEqual([
        {
          id: 4,
          courseId: 3,
          courseCode: "COMS3011",
          courseName: "Software Design Project",
          startsAt: "2030-09-04T14:00:00.000Z",
          endsAt: "2030-09-04T18:00:00.000Z",
          hours: 4,
          windowHours: 4,
          status: "OPEN",
          closesAt: null,
          sourceRequirementId: 12,
          pendingClaims: 2,
          acceptedClaims: 1,
          createdAt: "2026-09-20T09:00:00.000Z",
          updatedAt: "2026-09-23T09:00:00.000Z",
        },
      ]);
    });

    it("reads every status, oldest first, with course and claims in one query", async () => {
      await harness.service.listOverflowWork();

      expect(harness.transaction.overflowWork.findMany).toHaveBeenCalledWith({
        include: {
          course: { select: { code: true, name: true } },
          volunteerClaims: { select: { status: true } },
        },
        orderBy: { startsAt: "asc" },
      });
    });

    it("reads decimal hours as numbers", async () => {
      harness = createHarness({ overflowWork: row({ hours: "2.50" }) });

      await expect(harness.service.listOverflowWork()).resolves.toMatchObject([
        { hours: 2.5 },
      ]);
    });
  });

  describe("posting by hand", () => {
    it("creates the item without a source requirement", async () => {
      const summaries = await harness.service.createOverflowWork(createInput);

      expect(harness.transaction.overflowWork.create).toHaveBeenCalledWith({
        data: {
          courseId: 3,
          startsAt: START,
          endsAt: END,
          hours: 4,
          closesAt: null,
          sourceRequirementId: null,
          slotIndex: undefined,
        },
        include: {
          course: { select: { code: true, name: true } },
          volunteerClaims: { select: { status: true } },
        },
      });
      expect(summaries).toHaveLength(1);
      expect(summaries[0].sourceRequirementId).toBeNull();
      expect(harness.client.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: "Serializable" },
      );
    });

    it("reports a course that does not exist", async () => {
      harness = createHarness({ course: null });

      await expect(
        harness.service.createOverflowWork(createInput),
      ).rejects.toMatchObject({ status: 404, code: "COURSE_NOT_FOUND" });
      expect(harness.transaction.overflowWork.create).not.toHaveBeenCalled();
    });
  });

  describe("converting a staffing requirement", () => {
    it("keeps the source link and asks the shortage query about that requirement", async () => {
      await harness.service.createOverflowWork({
        ...createInput,
        hours: 8,
        sourceRequirementId: 12,
      });

      expect(harness.transaction.overflowWork.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sourceRequirementId: 12 }),
        }),
      );
      const [sql, requirementIds] = harness.transaction.$queryRawUnsafe.mock.calls[0];
      expect(String(sql)).toContain("requirementId");
      expect(requirementIds).toEqual([12]);
    });

    it("reports a requirement that does not exist", async () => {
      harness = createHarness({ requirement: null });

      await expect(
        harness.service.createOverflowWork({
          ...createInput,
          sourceRequirementId: 99,
        }),
      ).rejects.toMatchObject({
        status: 404,
        code: "STAFFING_REQUIREMENT_NOT_FOUND",
      });
      expect(harness.transaction.overflowWork.create).not.toHaveBeenCalled();
    });

    it("refuses a requirement that is no longer open", async () => {
      harness = createHarness({
        requirement: {
          id: 12,
          courseId: 3,
          startsAt: START,
          endsAt: END,
          tutorsNeeded: 2,
          status: "CANCELLED",
        },
      });

      await expect(
        harness.service.createOverflowWork({
          ...createInput,
          sourceRequirementId: 12,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "OVERFLOW_SOURCE_NOT_OPEN",
      });
    });

    it.each([
      ["a different course", { courseId: 9 }],
      ["a different start time", { startsAt: new Date("2030-09-04T13:00:00.000Z") }],
      ["a different end time", { endsAt: new Date("2030-09-04T17:00:00.000Z") }],
    ])("refuses a conversion with %s", async (_label, change) => {
      harness = createHarness({
        requirement: {
          id: 12,
          courseId: 3,
          startsAt: START,
          endsAt: END,
          tutorsNeeded: 2,
          status: "OPEN",
          ...change,
        },
      });

      await expect(
        harness.service.createOverflowWork({
          ...createInput,
          sourceRequirementId: 12,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "OVERFLOW_SOURCE_MISMATCH",
      });
    });

    it("refuses a requirement that is already covered", async () => {
      harness = createHarness({ assignedHours: 8 });

      await expect(
        harness.service.createOverflowWork({
          ...createInput,
          sourceRequirementId: 12,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "OVERFLOW_SOURCE_FILLED",
      });
      expect(harness.transaction.overflowWork.create).not.toHaveBeenCalled();
    });

    it("creates multiple items for multi-tutor shortages, each no larger than the window", async () => {
      // 2 tutors needed, 4-hour window, 0 assigned = 8 tutor-hours shortage
      // Should create 2 items, each with 4 hours (one per tutor slot)
      harness = createHarness({ assignedHours: 0 });

      const summaries = await harness.service.createOverflowWork({
        ...createInput,
        sourceRequirementId: 12,
      });

      expect(summaries).toHaveLength(2);
      expect(summaries[0]).toMatchObject({ hours: 4, sourceRequirementId: 12 });
      expect(summaries[1]).toMatchObject({ hours: 4, sourceRequirementId: 12 });
      expect(harness.transaction.overflowWork.create).toHaveBeenCalledTimes(2);
    });

    it("creates a partial final item when the shortage is not a multiple of the window", async () => {
      // 2 tutors needed, 4-hour window, 5 assigned = 8-5 = 3 tutor-hours shortage
      // Should create 1 item with 3 hours (partial slot)
      harness = createHarness({ assignedHours: 5 });

      const summaries = await harness.service.createOverflowWork({
        ...createInput,
        sourceRequirementId: 12,
      });

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({ hours: 3, sourceRequirementId: 12 });
    });

    it("maps the unique index violation to an already-sent conflict", async () => {
      harness.client.$transaction.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

      await expect(
        harness.service.createOverflowWork({
          ...createInput,
          sourceRequirementId: 12,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "OVERFLOW_SOURCE_ALREADY_SENT",
      });
    });

    it("leaves other transaction failures alone", async () => {
      harness.client.$transaction.mockRejectedValueOnce(new Error("boom"));

      await expect(
        harness.service.createOverflowWork(createInput),
      ).rejects.toThrow("boom");
    });
  });

  describe("editing", () => {
    it("writes only against the version the organiser was shown", async () => {
      harness.transaction.overflowWork.findUnique
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(row({ hours: 3, updatedAt: NEW_VERSION }));

      const summary = await harness.service.updateOverflowWork(
        4,
        updateInput,
      );

      expect(harness.transaction.overflowWork.updateMany).toHaveBeenCalledWith({
        where: { id: 4, updatedAt: VERSION },
        data: {
          courseId: 3,
          startsAt: START,
          endsAt: END,
          hours: 3,
          closesAt: null,
          updatedAt: expect.any(Date),
        },
      });
      expect(summary.hours).toBe(3);
      expect(summary.updatedAt).toBe("2026-09-23T10:00:00.000Z");
    });

    it("rejects an edit from a second session, without a second read", async () => {
      harness = createHarness({ updateCount: 0 });

      await expect(
        harness.service.updateOverflowWork(4, updateInput),
      ).rejects.toMatchObject({ status: 409, code: "OVERFLOW_WORK_STALE" });
      expect(
        harness.transaction.overflowWork.findUnique,
      ).toHaveBeenCalledTimes(1);
    });

    it("reports work that does not exist", async () => {
      harness = createHarness({ overflowWork: null });

      await expect(
        harness.service.updateOverflowWork(999, updateInput),
      ).rejects.toMatchObject({ status: 404, code: "OVERFLOW_WORK_NOT_FOUND" });
      expect(harness.transaction.overflowWork.updateMany).not.toHaveBeenCalled();
    });

    it.each(["FILLED", "CLOSED", "CANCELLED"])(
      "refuses to edit %s work",
      async (status) => {
        harness = createHarness({ overflowWork: row({ status }) });

        await expect(
          harness.service.updateOverflowWork(4, updateInput),
        ).rejects.toMatchObject({
          status: 409,
          code: "OVERFLOW_WORK_CONFLICT",
          message: "Only open overflow work can be edited.",
        });
      },
    );

    it.each(["PENDING", "ACCEPTED"])(
      "refuses to edit once a student claim is %s",
      async (status) => {
        harness = createHarness({
          overflowWork: row({ volunteerClaims: [{ status }] }),
        });

        await expect(
          harness.service.updateOverflowWork(4, updateInput),
        ).rejects.toMatchObject({
          status: 409,
          code: "OVERFLOW_WORK_HAS_CLAIMS",
        });
        expect(
          harness.transaction.overflowWork.updateMany,
        ).not.toHaveBeenCalled();
      },
    );

    it("edits again once every claim has been decided", async () => {
      harness = createHarness({
        overflowWork: row({
          volunteerClaims: [{ status: "REJECTED" }, { status: "WITHDRAWN" }],
        }),
      });

      await expect(
        harness.service.updateOverflowWork(4, updateInput),
      ).resolves.toMatchObject({ id: 4 });
    });

    it("reports a course that no longer exists", async () => {
      harness = createHarness({ course: null });

      await expect(
        harness.service.updateOverflowWork(4, updateInput),
      ).rejects.toMatchObject({ status: 404, code: "COURSE_NOT_FOUND" });
      expect(harness.transaction.overflowWork.updateMany).not.toHaveBeenCalled();
    });

    it("revalidates the source requirement link on edit", async () => {
      harness = createHarness({
        overflowWork: row({ sourceRequirementId: 12 }),
      });

      await expect(
        harness.service.updateOverflowWork(4, {
          ...updateInput,
          courseId: 9,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "OVERFLOW_SOURCE_MISMATCH",
      });
      expect(harness.transaction.overflowWork.updateMany).not.toHaveBeenCalled();
    });

    it("refuses edited hours that exceed the current shortage", async () => {
      harness = createHarness({
        overflowWork: row({ sourceRequirementId: 12 }),
        assignedHours: 5,
      });

      await expect(
        harness.service.updateOverflowWork(4, {
          ...updateInput,
          hours: 4,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "OVERFLOW_SOURCE_HOURS",
        message: "Only 3 hours of that staffing requirement are still unfilled.",
      });
    });

    it("allows edits that stay within the current shortage", async () => {
      harness = createHarness({
        overflowWork: row({ sourceRequirementId: 12 }),
        assignedHours: 5,
      });

      await expect(
        harness.service.updateOverflowWork(4, {
          ...updateInput,
          hours: 3,
        }),
      ).resolves.toMatchObject({ id: 4 });
    });
  });

  describe("closing", () => {
    it("closes open work against the expected version", async () => {
      harness.transaction.overflowWork.findUnique
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(row({ status: "CLOSED", updatedAt: NEW_VERSION }));

      const summary = await harness.service.closeOverflowWork(4, {
        expectedUpdatedAt: VERSION,
      });

      expect(harness.transaction.overflowWork.updateMany).toHaveBeenCalledWith({
        where: { id: 4, updatedAt: VERSION },
        data: { status: "CLOSED", updatedAt: expect.any(Date) },
      });
      expect(summary.status).toBe("CLOSED");
    });

    it("refuses to close filled work (terminal state)", async () => {
      harness.transaction.overflowWork.findUnique
        .mockResolvedValueOnce(row({ status: "FILLED" }));

      await expect(
        harness.service.closeOverflowWork(4, { expectedUpdatedAt: VERSION }),
      ).rejects.toMatchObject({
        status: 409,
        code: "OVERFLOW_WORK_CONFLICT",
        message: "This overflow work has an accepted student and cannot be closed.",
      });
    });

    it.each(["CLOSED", "CANCELLED"])(
      "refuses to close %s work twice",
      async (status) => {
        harness = createHarness({ overflowWork: row({ status }) });

        await expect(
          harness.service.closeOverflowWork(4, { expectedUpdatedAt: VERSION }),
        ).rejects.toMatchObject({
          status: 409,
          code: "OVERFLOW_WORK_CONFLICT",
          message: "This overflow work is already closed.",
        });
      },
    );

    it("refuses to close while a claim is pending", async () => {
      harness = createHarness({
        overflowWork: row({ volunteerClaims: [{ status: "PENDING" }] }),
      });

      await expect(
        harness.service.closeOverflowWork(4, { expectedUpdatedAt: VERSION }),
      ).rejects.toMatchObject({
        status: 409,
        code: "OVERFLOW_WORK_HAS_CLAIMS",
      });
    });

    it("closes again once claims are decided", async () => {
      harness = createHarness({
        overflowWork: row({ volunteerClaims: [{ status: "ACCEPTED" }] }),
      });

      await expect(
        harness.service.closeOverflowWork(4, { expectedUpdatedAt: VERSION }),
      ).resolves.toMatchObject({ id: 4 });
    });

    it("rejects a close from a second session", async () => {
      harness = createHarness({ updateCount: 0 });

      await expect(
        harness.service.closeOverflowWork(4, { expectedUpdatedAt: VERSION }),
      ).rejects.toMatchObject({ status: 409, code: "OVERFLOW_WORK_STALE" });
    });

    it("reports work that does not exist", async () => {
      harness = createHarness({ overflowWork: null });

      await expect(
        harness.service.closeOverflowWork(999, { expectedUpdatedAt: VERSION }),
      ).rejects.toMatchObject({ status: 404, code: "OVERFLOW_WORK_NOT_FOUND" });
      expect(harness.transaction.overflowWork.updateMany).not.toHaveBeenCalled();
    });
  });
});

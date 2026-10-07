import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { QueryClient } from "./allocation-queries.js";
import { createStaffingRequirementService } from "./staffing-requirement-service.js";

const START = new Date("2030-09-04T14:00:00.000Z");
const END = new Date("2030-09-04T18:00:00.000Z");
const CREATED = new Date("2026-09-21T09:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    courseId: 3,
    startsAt: START,
    endsAt: END,
    tutorsNeeded: 2,
    status: "OPEN",
    notes: "Two extra tutors for the lab",
    createdById: 8,
    createdAt: CREATED,
    updatedAt: CREATED,
    course: { code: "COMS3011", name: "Software Design Project" },
    ...overrides,
  };
}

interface HarnessOptions {
  organiser?: { id: number; role: string } | null;
  course?: { id: number } | null;
  requirement?: { id: number; status?: string; endsAt?: Date } | null;
  /** Confirmed hours the shortage query reports for requirement 12. */
  assignedHours?: number;
}

function createHarness(options: HarnessOptions = {}) {
  const {
    organiser = { id: 8, role: "ORGANISER" },
    course = { id: 3 },
    requirement = { id: 12, status: "OPEN", endsAt: END },
    assignedHours = 0,
  } = options;

  const transaction = {
    profile: { findUnique: vi.fn().mockResolvedValue(organiser) },
    course: { findUnique: vi.fn().mockResolvedValue(course) },
    staffingRequirement: {
      findUnique: vi.fn().mockResolvedValue(requirement),
      findMany: vi.fn().mockResolvedValue([row()]),
      create: vi.fn().mockResolvedValue(row()),
      update: vi.fn().mockResolvedValue(row()),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const client = {
    ...transaction,
    $transaction: vi.fn(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  };

  // Stands in for the one grouped query that reports confirmed hours per
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
    service: createStaffingRequirementService(
      client as unknown as PrismaClient,
      queryClient as unknown as QueryClient,
    ),
  };
}

type Harness = ReturnType<typeof createHarness>;

const validInput = {
  courseId: 3,
  startsAt: START,
  endsAt: END,
  tutorsNeeded: 2,
};

describe("staffing requirement service", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("listing", () => {
    it.each([
      ["a whole-hour window", "2030-09-04T18:00:00.000Z", 2, 4, 8],
      ["one tutor", "2030-09-04T18:00:00.000Z", 1, 4, 4],
      ["a half-hour window", "2030-09-04T16:30:00.000Z", 2, 2.5, 5],
      ["a twenty-minute window", "2030-09-04T14:20:00.000Z", 3, 0.33, 0.99],
      ["the maximum tutors", "2030-09-04T18:00:00.000Z", 20, 4, 80],
    ])(
      "derives required hours from the window and tutor count for %s",
      async (_label, endsAt, tutorsNeeded, windowHours, requiredHours) => {
        harness.transaction.staffingRequirement.findMany.mockResolvedValue([
          row({ endsAt: new Date(endsAt), tutorsNeeded }),
        ]);

        await expect(
          harness.service.listStaffingRequirements({}),
        ).resolves.toMatchObject([{ tutorsNeeded, windowHours, requiredHours }]);
      },
    );


    it("automatically closes open sessions whose end time has passed before listing", async () => {
      harness.transaction.staffingRequirement.findMany.mockResolvedValue([
        row({
          endsAt: new Date("2020-09-04T18:00:00.000Z"),
          status: "CLOSED",
        }),
      ]);

      await expect(harness.service.listStaffingRequirements({})).resolves.toMatchObject([
        { status: "CLOSED", shortageHours: 0, fillState: "not-being-filled" },
      ]);

      expect(harness.transaction.staffingRequirement.updateMany).toHaveBeenCalledWith({
        where: {
          status: "OPEN",
          endsAt: { lte: expect.any(Date) },
        },
        data: { status: "CLOSED" },
      });
    });

    it("returns summaries with ISO times, numeric hours and course details", async () => {
      await expect(harness.service.listStaffingRequirements({})).resolves.toEqual([
        {
          id: 12,
          courseId: 3,
          courseCode: "COMS3011",
          courseName: "Software Design Project",
          startsAt: "2030-09-04T14:00:00.000Z",
          endsAt: "2030-09-04T18:00:00.000Z",
          tutorsNeeded: 2,
          windowHours: 4,
          requiredHours: 8,
          assignedHours: 0,
          shortageHours: 8,
          shortageTutors: 2,
          fillState: "unfilled",
          status: "OPEN",
          notes: "Two extra tutors for the lab",
          createdById: 8,
          createdAt: "2026-09-21T09:00:00.000Z",
          updatedAt: "2026-09-21T09:00:00.000Z",
        },
      ]);
    });

    it.each([
      ["nothing assigned", 0, 8, 2, "unfilled"],
      ["part of it assigned", 5, 3, 1, "partially-filled"],
      ["half a tutor short", 6, 2, 1, "partially-filled"],
      ["exactly covered", 8, 0, 0, "fully-filled"],
      ["over-covered", 12, 0, 0, "fully-filled"],
    ])(
      "reports the shortage when %s",
      async (_label, assigned, shortageHours, shortageTutors, fillState) => {
        harness = createHarness({ assignedHours: assigned });

        await expect(
          harness.service.listStaffingRequirements({}),
        ).resolves.toMatchObject([
          { assignedHours: assigned, shortageHours, shortageTutors, fillState },
        ]);
      },
    );

    it.each([
      // A twenty-minute window is 0.33 hours once rounded, so a booking that
      // covers it completely can land a hundredth of an hour short. That is
      // rounding noise, not unfilled work: it must never read as "0.01 tutor
      // hours short, 1 more tutor needed".
      ["a twenty-minute window", "2030-09-04T14:20:00.000Z", 1, 0.32],
      ["a twenty-minute window for three tutors", "2030-09-04T14:20:00.000Z", 3, 0.98],
      ["a fifty-minute window", "2030-09-04T14:50:00.000Z", 1, 0.82],
      ["a whole-hour window", "2030-09-04T15:00:00.000Z", 1, 1],
    ])(
      "treats %s as fully filled when bookings cover it",
      async (_label, endsAt, tutorsNeeded, assigned) => {
        harness = createHarness({ assignedHours: assigned });
        harness.transaction.staffingRequirement.findMany.mockResolvedValue([
          row({ endsAt: new Date(endsAt), tutorsNeeded }),
        ]);

        await expect(
          harness.service.listStaffingRequirements({}),
        ).resolves.toMatchObject([
          { shortageHours: 0, shortageTutors: 0, fillState: "fully-filled" },
        ]);
      },
    );

    it.each(["CLOSED", "CANCELLED"] as const)(
      "reports no shortage for a %s requirement but still shows what is assigned",
      async (status) => {
        harness = createHarness({ assignedHours: 3 });
        harness.transaction.staffingRequirement.findMany.mockResolvedValue([
          row({ status }),
        ]);

        await expect(
          harness.service.listStaffingRequirements({}),
        ).resolves.toMatchObject([
          {
            assignedHours: 3,
            shortageHours: 0,
            shortageTutors: 0,
            fillState: "not-being-filled",
          },
        ]);
      },
    );

    it("asks for the assigned hours of every listed requirement in one query", async () => {
      harness.transaction.staffingRequirement.findMany.mockResolvedValue([
        row({ id: 12 }),
        row({ id: 13 }),
        row({ id: 14 }),
      ]);

      await harness.service.listStaffingRequirements({});

      expect(harness.queryClient.query).toHaveBeenCalledTimes(1);
      expect(harness.queryClient.query.mock.calls[0]![1]).toEqual([[12, 13, 14]]);
    });

    it("asks the database nothing when no requirements are listed", async () => {
      harness.transaction.staffingRequirement.findMany.mockResolvedValue([]);

      await expect(harness.service.listStaffingRequirements({})).resolves.toEqual([]);
      expect(harness.queryClient.query).not.toHaveBeenCalled();
    });

    it.each([
      ["no filters", {}, {}],
      ["course only", { courseId: 3 }, { courseId: 3 }],
      ["status only", { status: "OPEN" as const }, { status: "OPEN" }],
      [
        "both filters",
        { courseId: 3, status: "CLOSED" as const },
        { courseId: 3, status: "CLOSED" },
      ],
    ])("applies %s to the query", async (_label, query, expected) => {
      await harness.service.listStaffingRequirements(query);
      expect(harness.transaction.staffingRequirement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expected,
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        }),
      );
    });
  });

  describe("creating", () => {
    it("records the signed-in organiser as the author and starts OPEN", async () => {
      await expect(
        harness.service.createStaffingRequirement("auth0|organiser", validInput),
      ).resolves.toMatchObject({ id: 12, status: "OPEN" });

      expect(harness.transaction.profile.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: "auth0|organiser" },
        select: { id: true, role: true },
      });
      const { data } = harness.transaction.staffingRequirement.create.mock.calls[0]![0]!;
      expect(data).toMatchObject({
        courseId: 3,
        startsAt: START,
        endsAt: END,
        tutorsNeeded: 2,
        notes: null,
        createdById: 8,
      });
      // The status is never supplied, so the database default of OPEN applies.
      expect(data).not.toHaveProperty("status");
    });

    it("stores a supplied note", async () => {
      await harness.service.createStaffingRequirement("auth0|organiser", {
        ...validInput,
        notes: "Lab cover",
      });
      expect(
        harness.transaction.staffingRequirement.create.mock.calls[0]![0]!.data.notes,
      ).toBe("Lab cover");
    });

    it("refuses when the account has no organiser profile", async () => {
      harness = createHarness({ organiser: null });
      await expect(
        harness.service.createStaffingRequirement("auth0|ghost", validInput),
      ).rejects.toMatchObject({
        status: 404,
        code: "ORGANISER_PROFILE_NOT_FOUND",
      });
      expect(harness.transaction.staffingRequirement.create).not.toHaveBeenCalled();
    });

    it("refuses when the signed-in account is not an organiser", async () => {
      harness = createHarness({ organiser: { id: 7, role: "TUTOR" } });
      await expect(
        harness.service.createStaffingRequirement("auth0|tutor", validInput),
      ).rejects.toMatchObject({
        status: 404,
        code: "ORGANISER_PROFILE_NOT_FOUND",
      });
      expect(harness.transaction.staffingRequirement.create).not.toHaveBeenCalled();
    });

    it("refuses when the course does not exist", async () => {
      harness = createHarness({ course: null });
      await expect(
        harness.service.createStaffingRequirement("auth0|organiser", validInput),
      ).rejects.toMatchObject({ status: 404, code: "COURSE_NOT_FOUND" });
      expect(harness.transaction.staffingRequirement.create).not.toHaveBeenCalled();
    });
  });

  describe("updating details", () => {
    it("replaces the details without touching the status", async () => {
      await expect(
        harness.service.updateStaffingRequirement(12, validInput),
      ).resolves.toMatchObject({ id: 12 });

      const call = harness.transaction.staffingRequirement.update.mock.calls[0]![0]!;
      expect(call.where).toEqual({ id: 12 });
      expect(call.data).toMatchObject({
        courseId: 3,
        startsAt: START,
        endsAt: END,
        tutorsNeeded: 2,
      });
      expect(call.data).not.toHaveProperty("status");
      // An absent note leaves the stored note untouched.
      expect(call.data).not.toHaveProperty("notes");
    });

    it("clears the note when null is supplied", async () => {
      await harness.service.updateStaffingRequirement(12, {
        ...validInput,
        notes: null,
      });
      expect(
        harness.transaction.staffingRequirement.update.mock.calls[0]![0]!.data.notes,
      ).toBeNull();
    });

    it.each(["CLOSED", "CANCELLED"])(
      "still edits a %s requirement",
      async (status) => {
        harness = createHarness({ requirement: { id: 12, status, endsAt: END } });
        await expect(
          harness.service.updateStaffingRequirement(12, validInput),
        ).resolves.toBeDefined();
        expect(harness.transaction.staffingRequirement.update).toHaveBeenCalled();
      },
    );

    it("reports an unknown requirement", async () => {
      harness = createHarness({ requirement: null });
      await expect(
        harness.service.updateStaffingRequirement(999, validInput),
      ).rejects.toMatchObject({
        status: 404,
        code: "STAFFING_REQUIREMENT_NOT_FOUND",
      });
      expect(harness.transaction.staffingRequirement.update).not.toHaveBeenCalled();
    });

    it("reports a course that no longer exists", async () => {
      harness = createHarness({ course: null });
      await expect(
        harness.service.updateStaffingRequirement(12, validInput),
      ).rejects.toMatchObject({ status: 404, code: "COURSE_NOT_FOUND" });
      expect(harness.transaction.staffingRequirement.update).not.toHaveBeenCalled();
    });
  });

  describe("changing status", () => {
    it.each(["CLOSED", "CANCELLED"] as const)(
      "moves an open requirement to %s",
      async (status) => {
        harness = createHarness({ requirement: { id: 12, status: "OPEN", endsAt: END } });
        harness.transaction.staffingRequirement.update.mockResolvedValue(
          row({ status }),
        );
        await expect(
          harness.service.setStaffingRequirementStatus(12, status),
        ).resolves.toMatchObject({ status });
        expect(harness.transaction.staffingRequirement.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 12 }, data: { status } }),
        );
      },
    );

    it.each(["CLOSED", "CANCELLED"])(
      "reopens a %s requirement",
      async (status) => {
        harness = createHarness({ requirement: { id: 12, status, endsAt: END } });
        harness.transaction.staffingRequirement.update.mockResolvedValue(
          row({ status: "OPEN" }),
        );
        await expect(
          harness.service.setStaffingRequirementStatus(12, "OPEN"),
        ).resolves.toMatchObject({ status: "OPEN" });
      },
    );

    it.each(["OPEN", "CLOSED", "CANCELLED"] as const)(
      "refuses to set %s twice",
      async (status) => {
        harness = createHarness({ requirement: { id: 12, status, endsAt: END } });
        await expect(
          harness.service.setStaffingRequirementStatus(12, status),
        ).rejects.toMatchObject({
          status: 409,
          code: "STAFFING_REQUIREMENT_CONFLICT",
          message: expect.stringContaining(status.toLowerCase()),
        });
        expect(harness.transaction.staffingRequirement.update).not.toHaveBeenCalled();
      },
    );

    it("does not reopen a session whose end time has already passed", async () => {
      harness = createHarness({
        requirement: { id: 12, status: "CLOSED", endsAt: new Date("2020-09-04T18:00:00.000Z") },
      });

      await expect(
        harness.service.setStaffingRequirementStatus(12, "OPEN"),
      ).rejects.toMatchObject({
        status: 409,
        code: "STAFFING_REQUIREMENT_CONFLICT",
        message: expect.stringContaining("already ended"),
      });
      expect(harness.transaction.staffingRequirement.update).not.toHaveBeenCalled();
    });

    it("reports an unknown requirement", async () => {
      harness = createHarness({ requirement: null });
      await expect(
        harness.service.setStaffingRequirementStatus(999, "CLOSED"),
      ).rejects.toMatchObject({
        status: 404,
        code: "STAFFING_REQUIREMENT_NOT_FOUND",
      });
      expect(harness.transaction.staffingRequirement.update).not.toHaveBeenCalled();
    });
  });

  it("runs every write inside a single transaction", async () => {
    await harness.service.createStaffingRequirement("auth0|organiser", validInput);
    await harness.service.updateStaffingRequirement(12, validInput);
    harness.transaction.staffingRequirement.findUnique.mockResolvedValue({
      id: 12,
      status: "OPEN",
      endsAt: END,
    });
    await harness.service.setStaffingRequirementStatus(12, "CLOSED");
    expect(harness.client.$transaction).toHaveBeenCalledTimes(3);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
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
    // Prisma returns Decimal columns as objects, so the service must convert.
    requiredHours: { toString: () => "4.5" },
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
  requirement?: { id: number; status?: string } | null;
}

function createHarness(options: HarnessOptions = {}) {
  const {
    organiser = { id: 8, role: "ORGANISER" },
    course = { id: 3 },
    requirement = { id: 12, status: "OPEN" },
  } = options;

  const transaction = {
    profile: { findUnique: vi.fn().mockResolvedValue(organiser) },
    course: { findUnique: vi.fn().mockResolvedValue(course) },
    staffingRequirement: {
      findUnique: vi.fn().mockResolvedValue(requirement),
      findMany: vi.fn().mockResolvedValue([row()]),
      create: vi.fn().mockResolvedValue(row()),
      update: vi.fn().mockResolvedValue(row()),
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
    service: createStaffingRequirementService(client as unknown as PrismaClient),
  };
}

type Harness = ReturnType<typeof createHarness>;

const validInput = {
  courseId: 3,
  startsAt: START,
  endsAt: END,
  requiredHours: 4.5,
};

describe("staffing requirement service", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("listing", () => {
    it("returns summaries with ISO times, numeric hours and course details", async () => {
      await expect(harness.service.listStaffingRequirements({})).resolves.toEqual([
        {
          id: 12,
          courseId: 3,
          courseCode: "COMS3011",
          courseName: "Software Design Project",
          startsAt: "2030-09-04T14:00:00.000Z",
          endsAt: "2030-09-04T18:00:00.000Z",
          requiredHours: 4.5,
          status: "OPEN",
          notes: "Two extra tutors for the lab",
          createdById: 8,
          createdAt: "2026-09-21T09:00:00.000Z",
          updatedAt: "2026-09-21T09:00:00.000Z",
        },
      ]);
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
        requiredHours: 4.5,
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
        requiredHours: 4.5,
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
        harness = createHarness({ requirement: { id: 12, status } });
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
        harness = createHarness({ requirement: { id: 12, status: "OPEN" } });
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
        harness = createHarness({ requirement: { id: 12, status } });
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
        harness = createHarness({ requirement: { id: 12, status } });
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
    });
    await harness.service.setStaffingRequirementStatus(12, "CLOSED");
    expect(harness.client.$transaction).toHaveBeenCalledTimes(3);
  });
});

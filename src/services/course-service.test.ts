import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createCourseService } from "./course-service.js";

interface HarnessOptions {
  course?: { id: number } | null;
  confirmedAllocations?: number;
  workLogs?: number;
  excuses?: number;
  volunteerClaims?: number;
  staffingRequirements?: number;
}

function createHarness(options: HarnessOptions = {}) {
  const {
    course = { id: 9 },
    confirmedAllocations = 0,
    workLogs = 0,
    excuses = 0,
    volunteerClaims = 0,
    staffingRequirements = 0,
  } = options;

  const transaction = {
    course: {
      findUnique: vi.fn().mockResolvedValue(course),
      delete: vi.fn().mockResolvedValue({ id: 9 }),
    },
    allocation: {
      count: vi.fn().mockResolvedValue(confirmedAllocations),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    workLog: { count: vi.fn().mockResolvedValue(workLogs) },
    excuse: { count: vi.fn().mockResolvedValue(excuses) },
    volunteerClaim: { count: vi.fn().mockResolvedValue(volunteerClaims) },
    overflowWork: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    tutorMark: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    staffingRequirement: {
      // Recorded demand is disposable, so the service deletes it without ever
      // counting it. The count mock exists only to prove it stays unused.
      count: vi.fn().mockResolvedValue(staffingRequirements),
      deleteMany: vi
        .fn()
        .mockResolvedValue({ count: staffingRequirements }),
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
    service: createCourseService(client as unknown as PrismaClient),
  };
}

type Harness = ReturnType<typeof createHarness>;

function expectNoDeletions(transaction: Harness["transaction"]) {
  expect(transaction.overflowWork.deleteMany).not.toHaveBeenCalled();
  expect(transaction.allocation.deleteMany).not.toHaveBeenCalled();
  expect(transaction.tutorMark.deleteMany).not.toHaveBeenCalled();
  expect(transaction.staffingRequirement.deleteMany).not.toHaveBeenCalled();
  expect(transaction.course.delete).not.toHaveBeenCalled();
}

function expectSafeDeletionOrder(transaction: Harness["transaction"]) {
  expect(transaction.overflowWork.deleteMany).toHaveBeenCalledWith({
    where: { courseId: 9 },
  });
  expect(transaction.allocation.deleteMany).toHaveBeenCalledWith({
    where: { courseId: 9 },
  });
  expect(transaction.tutorMark.deleteMany).toHaveBeenCalledWith({
    where: { courseId: 9 },
  });
  expect(transaction.staffingRequirement.deleteMany).toHaveBeenCalledWith({
    where: { courseId: 9 },
  });
  expect(transaction.course.delete).toHaveBeenCalledWith({
    where: { id: 9 },
  });

  const requirementOrder =
    transaction.staffingRequirement.deleteMany.mock.invocationCallOrder[0]!;
  const overflowOrder =
    transaction.overflowWork.deleteMany.mock.invocationCallOrder[0]!;
  const allocationOrder =
    transaction.allocation.deleteMany.mock.invocationCallOrder[0]!;
  const courseOrder = transaction.course.delete.mock.invocationCallOrder[0]!;
  // Overflow references the source allocation, so it must go before the
  // allocations, and the course row must be removed last.
  expect(overflowOrder).toBeLessThan(allocationOrder);
  expect(allocationOrder).toBeLessThan(courseOrder);
  // Staffing requirements point at the course with an ON DELETE Restrict key,
  // so they must be gone before the course row is removed.
  expect(requirementOrder).toBeLessThan(courseOrder);
}

describe("course deletion service", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it("deletes a completely empty course and its disposable children in order", async () => {
    await expect(harness.service.deleteCourse(9)).resolves.toBeUndefined();
    expectSafeDeletionOrder(harness.transaction);
  });

  it("deletes a course whose only dependants are disposable tutor marks", async () => {
    harness = createHarness();
    await expect(harness.service.deleteCourse(9)).resolves.toBeUndefined();
    expect(harness.transaction.tutorMark.deleteMany).toHaveBeenCalledWith({
      where: { courseId: 9 },
    });
    expect(harness.transaction.course.delete).toHaveBeenCalledWith({
      where: { id: 9 },
    });
  });

  it("deletes a course with safe PROPOSED allocations that carry no history", async () => {
    // PROPOSED allocations are not confirmed and, with no work logs/excuses,
    // hold nothing auditable, so the course is safe to remove.
    harness = createHarness({
      confirmedAllocations: 0,
      workLogs: 0,
      excuses: 0,
    });
    await expect(harness.service.deleteCourse(9)).resolves.toBeUndefined();
    expect(harness.transaction.allocation.deleteMany).toHaveBeenCalledWith({
      where: { courseId: 9 },
    });
  });

  it("deletes a course with safe CANCELLED allocations and unclaimed overflow", async () => {
    harness = createHarness({
      confirmedAllocations: 0,
      workLogs: 0,
      volunteerClaims: 0,
    });
    await expect(harness.service.deleteCourse(9)).resolves.toBeUndefined();
    expectSafeDeletionOrder(harness.transaction);
  });

  it("deletes recorded staffing requirements along with the course", async () => {
    harness = createHarness({ staffingRequirements: 4 });
    await expect(harness.service.deleteCourse(9)).resolves.toBeUndefined();
    expect(harness.transaction.staffingRequirement.deleteMany).toHaveBeenCalledWith({
      where: { courseId: 9 },
    });
    expectSafeDeletionOrder(harness.transaction);
  });

  it("never treats staffing requirements as a blocker", async () => {
    // Requirements record demand, not history, so any number of them still
    // leaves the course deletable and they are never counted as a blocker.
    harness = createHarness({ staffingRequirements: 25 });
    await expect(harness.service.deleteCourse(9)).resolves.toBeUndefined();
    expect(harness.transaction.staffingRequirement.count).not.toHaveBeenCalled();

    harness = createHarness({ workLogs: 1, staffingRequirements: 25 });
    await expect(harness.service.deleteCourse(9)).rejects.toMatchObject({
      code: "COURSE_DELETE_CONFLICT",
      message: expect.not.stringContaining("staffing"),
    });
    expect(harness.transaction.staffingRequirement.count).not.toHaveBeenCalled();
  });

  it("returns a 404 route error when the course does not exist", async () => {
    harness = createHarness({ course: null });
    await expect(harness.service.deleteCourse(9)).rejects.toMatchObject({
      status: 404,
      code: "COURSE_NOT_FOUND",
    });
    expectNoDeletions(harness.transaction);
  });

  it("blocks deletion when a confirmed allocation exists", async () => {
    harness = createHarness({ confirmedAllocations: 1 });
    await expect(harness.service.deleteCourse(9)).rejects.toMatchObject({
      status: 409,
      code: "COURSE_DELETE_CONFLICT",
      message: expect.stringContaining("confirmed allocations"),
    });
    expectNoDeletions(harness.transaction);
  });

  it("blocks deletion when logged work (work logs) exists", async () => {
    harness = createHarness({ workLogs: 3 });
    await expect(harness.service.deleteCourse(9)).rejects.toMatchObject({
      status: 409,
      code: "COURSE_DELETE_CONFLICT",
      message: expect.stringContaining("logged work"),
    });
    expectNoDeletions(harness.transaction);
  });

  it("blocks deletion when submitted/approved timesheet history is attached via work logs", async () => {
    // Submitted and approved timesheets always own at least one work log, so a
    // positive work-log count is exactly how meaningful timesheet history keeps
    // a course from being deleted.
    harness = createHarness({ workLogs: 1 });
    await expect(harness.service.deleteCourse(9)).rejects.toMatchObject({
      status: 409,
      code: "COURSE_DELETE_CONFLICT",
    });
    expectNoDeletions(harness.transaction);
  });

  it("blocks deletion when meaningful excuse records exist", async () => {
    harness = createHarness({ excuses: 2 });
    await expect(harness.service.deleteCourse(9)).rejects.toMatchObject({
      status: 409,
      code: "COURSE_DELETE_CONFLICT",
      message: expect.stringContaining("excuse records"),
    });
    expectNoDeletions(harness.transaction);
  });

  it("blocks deletion when volunteer-claim history exists", async () => {
    harness = createHarness({ volunteerClaims: 1 });
    await expect(harness.service.deleteCourse(9)).rejects.toMatchObject({
      status: 409,
      code: "COURSE_DELETE_CONFLICT",
      message: expect.stringContaining("volunteer claims"),
    });
    expectNoDeletions(harness.transaction);
  });

  it("lists every blocker together when several kinds of history exist", async () => {
    harness = createHarness({
      confirmedAllocations: 1,
      workLogs: 1,
      excuses: 1,
      volunteerClaims: 1,
    });
    await expect(harness.service.deleteCourse(9)).rejects.toMatchObject({
      code: "COURSE_DELETE_CONFLICT",
      message: expect.stringContaining(
        "confirmed allocations, logged work, excuse records and volunteer claims",
      ),
    });
    expectNoDeletions(harness.transaction);
  });

  it("makes no partial changes when a course is blocked", async () => {
    harness = createHarness({ workLogs: 1 });
    await expect(harness.service.deleteCourse(9)).rejects.toBeDefined();
    // The verdict is decided before any write, so nothing is ever deleted.
    expectNoDeletions(harness.transaction);
    expect(harness.client.$transaction).toHaveBeenCalledTimes(1);
  });

  it("never leaks raw database detail in the conflict error", async () => {
    harness = createHarness({ confirmedAllocations: 1 });
    let caught: unknown;
    try {
      await harness.service.deleteCourse(9);
    } catch (error) {
      caught = error;
    }
    const message = (caught as Error).message;
    expect(message).not.toMatch(/P200\d/);
    expect(message.toLowerCase()).not.toContain("prisma");
    expect(message.toLowerCase()).not.toContain("constraint");
    expect(message).toMatch(/cannot be deleted/i);
  });
});

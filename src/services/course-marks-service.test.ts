import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createCourseMarksService } from "./course-marks-service.js";

const tutorsWithMarks = [
  { id: 7, fullName: "Ada Tutor", email: "ada@tutormx.example", tutorMarks: [{ mark: "81.50" }] },
  { id: 8, fullName: "Ben Tutor", email: "ben@tutormx.example", tutorMarks: [] },
];

function createHarness() {
  const transaction = {
    course: { findUnique: vi.fn().mockResolvedValue({ id: 3 }) },
    profile: {
      findMany: vi.fn(async (args: { where: { id?: { in: number[] } } }) =>
        args.where.id
          ? args.where.id.in.filter((id) => id === 7 || id === 8).map((id) => ({ id }))
          : tutorsWithMarks,
      ),
    },
    tutorMark: { upsert: vi.fn().mockResolvedValue({ id: 1 }) },
  };
  const client = {
    ...transaction,
    $transaction: vi.fn(async (operation: (value: typeof transaction) => Promise<unknown>) => operation(transaction)),
  };
  return {
    transaction,
    client,
    service: createCourseMarksService(client as unknown as PrismaClient),
  };
}

describe("course marks service", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it("lists every tutor with their mark for the course, or null", async () => {
    await expect(harness.service.listCourseMarks(3)).resolves.toEqual([
      { tutorId: 7, fullName: "Ada Tutor", email: "ada@tutormx.example", mark: 81.5 },
      { tutorId: 8, fullName: "Ben Tutor", email: "ben@tutormx.example", mark: null },
    ]);
    expect(harness.transaction.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "TUTOR" },
        select: expect.objectContaining({ tutorMarks: { where: { courseId: 3 }, select: { mark: true } } }),
      }),
    );
  });

  it("reports an unknown course", async () => {
    harness.transaction.course.findUnique.mockResolvedValue(null);
    await expect(harness.service.listCourseMarks(99)).rejects.toMatchObject({ status: 404, code: "COURSE_NOT_FOUND" });
  });

  it("saves the whole list in one transaction and returns the updated list", async () => {
    const result = await harness.service.saveCourseMarks(3, [
      { tutorId: 7, mark: 90 },
      { tutorId: 8, mark: 64 },
    ]);

    expect(harness.client.$transaction).toHaveBeenCalledTimes(1);
    expect(harness.transaction.tutorMark.upsert).toHaveBeenCalledTimes(2);
    expect(harness.transaction.tutorMark.upsert).toHaveBeenCalledWith({
      where: { tutorId_courseId: { tutorId: 8, courseId: 3 } },
      create: { tutorId: 8, courseId: 3, mark: 64 },
      update: { mark: 64 },
      select: { id: true },
    });
    expect(result).toHaveLength(2);
  });

  it("saves nothing when any tutor is unknown", async () => {
    await expect(
      harness.service.saveCourseMarks(3, [
        { tutorId: 7, mark: 90 },
        { tutorId: 41, mark: 70 },
        { tutorId: 42, mark: 70 },
      ]),
    ).rejects.toMatchObject({
      status: 404,
      code: "TUTOR_NOT_FOUND",
      message: "No marks were saved. These tutors could not be found: 41, 42.",
    });
    expect(harness.transaction.tutorMark.upsert).not.toHaveBeenCalled();
  });

  it("saves nothing for an unknown course", async () => {
    harness.transaction.course.findUnique.mockResolvedValue(null);
    await expect(harness.service.saveCourseMarks(99, [{ tutorId: 7, mark: 90 }])).rejects.toMatchObject({
      code: "COURSE_NOT_FOUND",
    });
    expect(harness.transaction.tutorMark.upsert).not.toHaveBeenCalled();
  });
});

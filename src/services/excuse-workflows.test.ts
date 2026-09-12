import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createExcuseWorkflowService,
  type ExcuseWorkflowStatus,
} from "./excuse-workflows.js";

const mocks = {
  excuseFindFirst: vi.fn(),
  excuseFindUnique: vi.fn(),
  excuseUpdateMany: vi.fn(),
  profileFindUnique: vi.fn(),
  transaction: vi.fn(),
};

const prismaClient = {
  profile: { findUnique: mocks.profileFindUnique },
  excuse: {
    findFirst: mocks.excuseFindFirst,
    findUnique: mocks.excuseFindUnique,
    updateMany: mocks.excuseUpdateMany,
  },
  $transaction: mocks.transaction,
} as unknown as PrismaClient;

const createdAt = new Date("2030-09-01T08:00:00.000Z");
const updatedAt = new Date("2030-09-02T09:00:00.000Z");

function excuseRecord(
  status: ExcuseWorkflowStatus,
  reviewReason: string | null = null,
) {
  return {
    id: 12,
    allocationId: 4,
    reason: "Medical appointment",
    status,
    reviewReason,
    createdAt,
    updatedAt,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(
    async (callback: (transaction: PrismaClient) => Promise<unknown>) =>
      callback(prismaClient),
  );
});

describe("excuse workflow service", () => {
  it("returns only the authenticated tutor's excuse status", async () => {
    mocks.profileFindUnique.mockResolvedValueOnce({ id: 7, role: "TUTOR" });
    mocks.excuseFindFirst.mockResolvedValueOnce(excuseRecord("PENDING"));
    const service = createExcuseWorkflowService(prismaClient);

    await expect(service.getStatus("auth0|current-tutor", 12)).resolves.toEqual({
      id: 12,
      allocationId: 4,
      reason: "Medical appointment",
      status: "PENDING",
      reviewReason: null,
      createdAt: "2030-09-01T08:00:00.000Z",
      updatedAt: "2030-09-02T09:00:00.000Z",
    });
    expect(mocks.profileFindUnique).toHaveBeenCalledWith({
      where: { auth0Id: "auth0|current-tutor" },
      select: { id: true, role: true },
    });
    expect(mocks.excuseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 12, tutorId: 7 } }),
    );
  });

  it.each([null, { id: 7, role: "STUDENT" }, { id: 8, role: "ORGANISER" }])(
    "hides missing or wrong-role service identities (%j)",
    async (profile) => {
      mocks.profileFindUnique.mockResolvedValueOnce(profile);
      const service = createExcuseWorkflowService(prismaClient);

      await expect(
        service.getStatus("auth0|not-a-tutor", 12),
      ).rejects.toMatchObject({
        status: 404,
        code: "TUTOR_PROFILE_NOT_FOUND",
      });
      expect(mocks.excuseFindFirst).not.toHaveBeenCalled();
    },
  );

  it("returns the same safe 404 for missing and cross-tutor excuses", async () => {
    mocks.profileFindUnique.mockResolvedValue({ id: 7, role: "TUTOR" });
    mocks.excuseFindFirst.mockResolvedValue(null);
    const service = createExcuseWorkflowService(prismaClient);

    await expect(
      service.getStatus("auth0|current-tutor", 999),
    ).rejects.toMatchObject({ status: 404, code: "EXCUSE_NOT_FOUND" });
    await expect(
      service.getStatus("auth0|current-tutor", 12),
    ).rejects.toMatchObject({ status: 404, code: "EXCUSE_NOT_FOUND" });
    expect(mocks.excuseFindFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: 12, tutorId: 7 } }),
    );
  });

  it("atomically approves a pending excuse", async () => {
    mocks.excuseUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.excuseFindUnique.mockResolvedValueOnce(excuseRecord("APPROVED"));
    const service = createExcuseWorkflowService(prismaClient);

    await expect(
      service.decide(12, { decision: "APPROVE" }),
    ).resolves.toMatchObject({ status: "APPROVED", reviewReason: null });
    expect(mocks.excuseUpdateMany).toHaveBeenCalledWith({
      where: { id: 12, status: "PENDING" },
      data: { status: "APPROVED", reviewReason: null },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("trims and persists the required rejection reason", async () => {
    mocks.excuseUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.excuseFindUnique.mockResolvedValueOnce(
      excuseRecord("REJECTED", "Insufficient evidence"),
    );
    const service = createExcuseWorkflowService(prismaClient);

    await expect(
      service.decide(12, {
        decision: "REJECT",
        reason: "  Insufficient evidence  ",
      }),
    ).resolves.toMatchObject({
      status: "REJECTED",
      reviewReason: "Insufficient evidence",
    });
    expect(mocks.excuseUpdateMany).toHaveBeenCalledWith({
      where: { id: 12, status: "PENDING" },
      data: { status: "REJECTED", reviewReason: "Insufficient evidence" },
    });
  });

  it.each([
    { decision: "REJECT", reason: undefined },
    { decision: "REJECT", reason: "   " },
    { decision: "REJECT", reason: "x".repeat(1001) },
    { decision: "REJECT", reason: 42 },
    { decision: "INVALID", reason: "No" },
  ])("rejects malformed decision input %#", async (input) => {
    const service = createExcuseWorkflowService(prismaClient);

    await expect(
      service.decide(12, input as never),
    ).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the decision target does not exist", async () => {
    mocks.excuseUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.excuseFindUnique.mockResolvedValueOnce(null);
    const service = createExcuseWorkflowService(prismaClient);

    await expect(
      service.decide(999, { decision: "APPROVE" }),
    ).rejects.toMatchObject({ status: 404, code: "EXCUSE_NOT_FOUND" });
  });

  it.each(["APPROVED", "REJECTED", "PENDING"] as const)(
    "returns 409 for a terminal or stale %s decision",
    async (status) => {
      mocks.excuseUpdateMany.mockResolvedValueOnce({ count: 0 });
      mocks.excuseFindUnique.mockResolvedValueOnce({ id: 12, status });
      const service = createExcuseWorkflowService(prismaClient);

      await expect(
        service.decide(12, { decision: "APPROVE" }),
      ).rejects.toMatchObject({
        status: 409,
        code: "EXCUSE_DECISION_CONFLICT",
      });
    },
  );

  it("returns 409 when the decided row disappears before reread", async () => {
    mocks.excuseUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.excuseFindUnique.mockResolvedValueOnce(null);
    const service = createExcuseWorkflowService(prismaClient);

    await expect(
      service.decide(12, { decision: "APPROVE" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "EXCUSE_DECISION_CONFLICT",
    });
  });

  it.each(["P2003", "P2004", "P2034"])(
    "maps Prisma %s failures to a safe decision conflict",
    async (code) => {
      mocks.transaction.mockRejectedValueOnce({ code });
      const service = createExcuseWorkflowService(prismaClient);

      await expect(
        service.decide(12, { decision: "APPROVE" }),
      ).rejects.toMatchObject({
        status: 409,
        code: "EXCUSE_DECISION_CONFLICT",
      });
    },
  );

  it("maps only adapter check-constraint failures to a safe conflict", async () => {
    mocks.transaction.mockRejectedValueOnce({
      code: "P2039",
      meta: {
        driverAdapterError: { cause: { originalCode: "23514" } },
      },
    });
    const service = createExcuseWorkflowService(prismaClient);

    await expect(
      service.decide(12, { decision: "APPROVE" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "EXCUSE_DECISION_CONFLICT",
    });
  });

  it.each([
    new Error("unexpected database failure"),
    {
      code: "P2039",
      meta: {
        driverAdapterError: { cause: { originalCode: "23503" } },
      },
    },
  ])("preserves unexpected persistence failures %#", async (unexpected) => {
    mocks.transaction.mockRejectedValueOnce(unexpected);
    const service = createExcuseWorkflowService(prismaClient);

    await expect(
      service.decide(12, { decision: "APPROVE" }),
    ).rejects.toBe(unexpected);
  });
});

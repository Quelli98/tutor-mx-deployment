import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { QueryClient } from "./allocation-queries.js";
import {
  createStudentWorkflowService,
  type VolunteerRequestStatus,
} from "./student-workflows.js";

const now = new Date("2030-09-01T12:00:00.000Z");

function volunteerRequest(
  status: VolunteerRequestStatus = "PENDING",
  overrides: Partial<{
    id: number;
    overflowWorkId: number;
    reviewReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? 31,
    overflowWorkId: overrides.overflowWorkId ?? 11,
    status,
    reviewReason: overrides.reviewReason ?? null,
    createdAt: overrides.createdAt ?? new Date("2030-08-30T09:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2030-08-30T09:05:00.000Z"),
  };
}

function openWork(
  id: number,
  overrides: Partial<{
    status: "OPEN";
    startsAt: Date;
    endsAt: Date;
    closesAt: Date | null;
  }> = {},
) {
  return {
    id,
    courseCode: `COURSE${id}`,
    courseName: `Course ${id}`,
    startsAt:
      overrides.startsAt ?? new Date("2030-09-04T14:00:00.000Z"),
    endsAt: overrides.endsAt ?? new Date("2030-09-04T16:00:00.000Z"),
    hours: 2,
    status: overrides.status ?? ("OPEN" as const),
    closesAt:
      overrides.closesAt === undefined
        ? new Date("2030-09-03T17:00:00.000Z")
        : overrides.closesAt,
  };
}

function prismaError(code: string, originalCode?: string) {
  return originalCode === undefined
    ? { code }
    : {
        code,
        meta: {
          driverAdapterError: {
            cause: { originalCode },
          },
        },
      };
}

function makeHarness() {
  const profileFindUnique = vi
    .fn()
    .mockResolvedValue({ id: 7, role: "STUDENT" });
  const volunteerClaimFindMany = vi.fn().mockResolvedValue([]);
  const volunteerClaimFindFirst = vi.fn();
  const volunteerClaimUpdateMany = vi.fn();
  const overflowWorkFindUnique = vi.fn();
  const volunteerClaimCreate = vi.fn();
  const query = vi.fn().mockResolvedValue({ rows: [] });

  const transactionClient = {
    overflowWork: { findUnique: overflowWorkFindUnique },
    volunteerClaim: { create: volunteerClaimCreate },
  };
  const transaction = vi.fn().mockImplementation(
    async (
      callback: (client: typeof transactionClient) => Promise<unknown>,
    ) => callback(transactionClient),
  );

  const prismaClient = {
    profile: { findUnique: profileFindUnique },
    volunteerClaim: {
      findMany: volunteerClaimFindMany,
      findFirst: volunteerClaimFindFirst,
      updateMany: volunteerClaimUpdateMany,
    },
    $transaction: transaction,
  } as unknown as PrismaClient;
  const queryClient: QueryClient = { query };

  return {
    service: createStudentWorkflowService(prismaClient, queryClient),
    profileFindUnique,
    volunteerClaimFindMany,
    volunteerClaimFindFirst,
    volunteerClaimUpdateMany,
    overflowWorkFindUnique,
    volunteerClaimCreate,
    transaction,
    query,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("student open work", () => {
  it("returns only open work for which the authenticated student has never requested", async () => {
    const harness = makeHarness();
    const available = openWork(11);
    const rejectedPreviously = openWork(12);
    const pending = openWork(13);
    harness.query.mockResolvedValueOnce({
      rows: [available, rejectedPreviously, pending],
    });
    harness.volunteerClaimFindMany.mockResolvedValueOnce([
      { overflowWorkId: 12 },
      { overflowWorkId: 13 },
    ]);

    await expect(
      harness.service.listOpenWork("auth0|student"),
    ).resolves.toEqual([
      {
        ...available,
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
        closesAt: "2030-09-03T17:00:00.000Z",
      },
    ]);

    expect(harness.profileFindUnique).toHaveBeenCalledWith({
      where: { auth0Id: "auth0|student" },
      select: { id: true, role: true },
    });
    expect(harness.query.mock.calls[0]?.[1]).toEqual([now]);
    expect(harness.volunteerClaimFindMany).toHaveBeenCalledWith({
      where: {
        studentId: 7,
        overflowWorkId: { in: [11, 12, 13] },
      },
      select: { overflowWorkId: true },
    });
  });

  it("returns an empty list without querying claims when there is no open work", async () => {
    const harness = makeHarness();

    await expect(
      harness.service.listOpenWork("auth0|student"),
    ).resolves.toEqual([]);
    expect(harness.volunteerClaimFindMany).not.toHaveBeenCalled();
  });

  it.each([null, { id: 1, role: "TUTOR" }, { id: 2, role: "ORGANISER" }])(
    "fails closed when the trusted identity is not a Student: %o",
    async (profile) => {
      const harness = makeHarness();
      harness.profileFindUnique.mockResolvedValueOnce(profile);

      await expect(
        harness.service.listOpenWork("auth0|wrong-role"),
      ).rejects.toMatchObject({
        status: 404,
        code: "STUDENT_PROFILE_NOT_FOUND",
      });
      expect(harness.query).not.toHaveBeenCalled();
    },
  );
});

describe("student volunteer request creation", () => {
  it("creates one pending request in a Serializable transaction using trusted ownership", async () => {
    const harness = makeHarness();
    harness.overflowWorkFindUnique.mockResolvedValueOnce({
      id: 11,
      status: "OPEN",
      startsAt: new Date("2030-09-01T12:00:00.001Z"),
      closesAt: new Date("2030-09-01T12:00:00.001Z"),
    });
    harness.volunteerClaimCreate.mockResolvedValueOnce(
      volunteerRequest("PENDING"),
    );

    await expect(
      harness.service.createVolunteerRequest("auth0|student", {
        overflowWorkId: 11,
      }),
    ).resolves.toEqual({
      id: 31,
      overflowWorkId: 11,
      status: "PENDING",
      reviewReason: null,
      createdAt: "2030-08-30T09:00:00.000Z",
      updatedAt: "2030-08-30T09:05:00.000Z",
    });

    expect(harness.transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "Serializable",
    });
    expect(harness.volunteerClaimCreate).toHaveBeenCalledWith({
      data: { overflowWorkId: 11, studentId: 7 },
      select: {
        id: true,
        overflowWorkId: true,
        status: true,
        reviewReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it("returns a safe 404 when the work item is missing", async () => {
    const harness = makeHarness();
    harness.overflowWorkFindUnique.mockResolvedValueOnce(null);

    await expect(
      harness.service.createVolunteerRequest("auth0|student", {
        overflowWorkId: 999,
      }),
    ).rejects.toMatchObject({ status: 404, code: "OPEN_WORK_NOT_FOUND" });
    expect(harness.volunteerClaimCreate).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "filled",
      work: {
        id: 11,
        status: "FILLED",
        startsAt: new Date("2030-09-02T12:00:00.000Z"),
        closesAt: null,
      },
    },
    {
      name: "closed",
      work: {
        id: 11,
        status: "CLOSED",
        startsAt: new Date("2030-09-02T12:00:00.000Z"),
        closesAt: null,
      },
    },
    {
      name: "cancelled",
      work: {
        id: 11,
        status: "CANCELLED",
        startsAt: new Date("2030-09-02T12:00:00.000Z"),
        closesAt: null,
      },
    },
    {
      name: "already started at the exact boundary",
      work: { id: 11, status: "OPEN", startsAt: now, closesAt: null },
    },
    {
      name: "closed at the exact boundary",
      work: {
        id: 11,
        status: "OPEN",
        startsAt: new Date("2030-09-02T12:00:00.000Z"),
        closesAt: now,
      },
    },
    {
      name: "invalid start",
      work: {
        id: 11,
        status: "OPEN",
        startsAt: new Date(Number.NaN),
        closesAt: null,
      },
    },
    {
      name: "invalid close",
      work: {
        id: 11,
        status: "OPEN",
        startsAt: new Date("2030-09-02T12:00:00.000Z"),
        closesAt: new Date(Number.NaN),
      },
    },
  ])("rejects $name work as unavailable", async ({ work }) => {
    const harness = makeHarness();
    harness.overflowWorkFindUnique.mockResolvedValueOnce(work);

    await expect(
      harness.service.createVolunteerRequest("auth0|student", {
        overflowWorkId: 11,
      }),
    ).rejects.toMatchObject({ status: 409, code: "OPEN_WORK_UNAVAILABLE" });
    expect(harness.volunteerClaimCreate).not.toHaveBeenCalled();
  });

  it("maps a unique failure to a duplicate conflict", async () => {
    const harness = makeHarness();
    harness.overflowWorkFindUnique.mockResolvedValueOnce({
      id: 11,
      status: "OPEN",
      startsAt: new Date("2030-09-02T12:00:00.000Z"),
      closesAt: null,
    });
    harness.volunteerClaimCreate.mockRejectedValueOnce(prismaError("P2002"));

    await expect(
      harness.service.createVolunteerRequest("auth0|student", {
        overflowWorkId: 11,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_REQUEST_DUPLICATE",
    });
  });

  it.each(["P2003", "P2004", "P2034"])(
    "maps %s race or constraint failures to a safe conflict",
    async (code) => {
      const harness = makeHarness();
      harness.overflowWorkFindUnique.mockResolvedValueOnce({
        id: 11,
        status: "OPEN",
        startsAt: new Date("2030-09-02T12:00:00.000Z"),
        closesAt: null,
      });
      harness.volunteerClaimCreate.mockRejectedValueOnce(prismaError(code));

      await expect(
        harness.service.createVolunteerRequest("auth0|student", {
          overflowWorkId: 11,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "VOLUNTEER_REQUEST_CONFLICT",
      });
    },
  );

  it("maps the adapter's nested 23514 check violation to a safe conflict", async () => {
    const harness = makeHarness();
    harness.overflowWorkFindUnique.mockResolvedValueOnce({
      id: 11,
      status: "OPEN",
      startsAt: new Date("2030-09-02T12:00:00.000Z"),
      closesAt: null,
    });
    harness.volunteerClaimCreate.mockRejectedValueOnce(
      prismaError("P2039", "23514"),
    );

    await expect(
      harness.service.createVolunteerRequest("auth0|student", {
        overflowWorkId: 11,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_REQUEST_CONFLICT",
    });
  });

  it.each([
    new Error("private database detail"),
    prismaError("P2039", "23505"),
    { code: "P2039", meta: { originalCode: "23514" } },
  ])("preserves an unexpected persistence failure: %o", async (failure) => {
    const harness = makeHarness();
    harness.overflowWorkFindUnique.mockResolvedValueOnce({
      id: 11,
      status: "OPEN",
      startsAt: new Date("2030-09-02T12:00:00.000Z"),
      closesAt: null,
    });
    harness.volunteerClaimCreate.mockRejectedValueOnce(failure);

    await expect(
      harness.service.createVolunteerRequest("auth0|student", {
        overflowWorkId: 11,
      }),
    ).rejects.toBe(failure);
  });
});

describe("owned volunteer request status", () => {
  it("returns only the safe status projection for the authenticated Student", async () => {
    const harness = makeHarness();
    harness.volunteerClaimFindFirst.mockResolvedValueOnce({
      ...volunteerRequest("REJECTED", { reviewReason: "Already covered" }),
      studentId: 7,
      student: { email: "student@example.test" },
    });

    await expect(
      harness.service.getVolunteerRequest("auth0|student", 31),
    ).resolves.toEqual({
      id: 31,
      overflowWorkId: 11,
      status: "REJECTED",
      reviewReason: "Already covered",
      createdAt: "2030-08-30T09:00:00.000Z",
      updatedAt: "2030-08-30T09:05:00.000Z",
    });
    expect(harness.volunteerClaimFindFirst).toHaveBeenCalledWith({
      where: { id: 31, studentId: 7 },
      select: {
        id: true,
        overflowWorkId: true,
        status: true,
        reviewReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it("uses the same nonrevealing 404 for missing and cross-user requests", async () => {
    const harness = makeHarness();
    harness.volunteerClaimFindFirst.mockResolvedValue(null);

    await expect(
      harness.service.getVolunteerRequest("auth0|student", 999),
    ).rejects.toMatchObject({
      status: 404,
      code: "VOLUNTEER_REQUEST_NOT_FOUND",
    });
  });
});

describe("volunteer request withdrawal", () => {
  it("conditionally withdraws an owned pending request", async () => {
    const harness = makeHarness();
    harness.volunteerClaimFindFirst
      .mockResolvedValueOnce(volunteerRequest("PENDING"))
      .mockResolvedValueOnce(
        volunteerRequest("WITHDRAWN", {
          updatedAt: new Date("2030-09-01T12:00:01.000Z"),
        }),
      );
    harness.volunteerClaimUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      harness.service.withdrawVolunteerRequest("auth0|student", 31),
    ).resolves.toMatchObject({
      id: 31,
      status: "WITHDRAWN",
      updatedAt: "2030-09-01T12:00:01.000Z",
    });
    expect(harness.volunteerClaimUpdateMany).toHaveBeenCalledWith({
      where: { id: 31, studentId: 7, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
  });

  it("returns a nonrevealing 404 for a missing or cross-user request", async () => {
    const harness = makeHarness();
    harness.volunteerClaimFindFirst.mockResolvedValueOnce(null);

    await expect(
      harness.service.withdrawVolunteerRequest("auth0|student", 999),
    ).rejects.toMatchObject({
      status: 404,
      code: "VOLUNTEER_REQUEST_NOT_FOUND",
    });
    expect(harness.volunteerClaimUpdateMany).not.toHaveBeenCalled();
  });

  it.each(["ACCEPTED", "REJECTED", "WITHDRAWN"] as const)(
    "rejects a terminal %s request",
    async (status) => {
      const harness = makeHarness();
      harness.volunteerClaimFindFirst.mockResolvedValueOnce(
        volunteerRequest(status),
      );

      await expect(
        harness.service.withdrawVolunteerRequest("auth0|student", 31),
      ).rejects.toMatchObject({
        status: 409,
        code: "VOLUNTEER_REQUEST_CONFLICT",
      });
      expect(harness.volunteerClaimUpdateMany).not.toHaveBeenCalled();
    },
  );

  it("rejects a stale concurrent withdrawal or organiser decision", async () => {
    const harness = makeHarness();
    harness.volunteerClaimFindFirst.mockResolvedValueOnce(
      volunteerRequest("PENDING"),
    );
    harness.volunteerClaimUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      harness.service.withdrawVolunteerRequest("auth0|student", 31),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_REQUEST_CONFLICT",
    });
  });

  it("fails closed if the updated request unexpectedly disappears", async () => {
    const harness = makeHarness();
    harness.volunteerClaimFindFirst
      .mockResolvedValueOnce(volunteerRequest("PENDING"))
      .mockResolvedValueOnce(null);
    harness.volunteerClaimUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      harness.service.withdrawVolunteerRequest("auth0|student", 31),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_REQUEST_CONFLICT",
    });
  });

  it.each([
    prismaError("P2002"),
    prismaError("P2003"),
    prismaError("P2004"),
    prismaError("P2034"),
    prismaError("P2039", "23514"),
  ])("maps expected withdrawal persistence conflicts: %o", async (failure) => {
    const harness = makeHarness();
    harness.volunteerClaimFindFirst.mockResolvedValueOnce(
      volunteerRequest("PENDING"),
    );
    harness.volunteerClaimUpdateMany.mockRejectedValueOnce(failure);

    await expect(
      harness.service.withdrawVolunteerRequest("auth0|student", 31),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOLUNTEER_REQUEST_CONFLICT",
    });
  });

  it("preserves unexpected withdrawal failures", async () => {
    const harness = makeHarness();
    const failure = prismaError("P2039", "23505");
    harness.volunteerClaimFindFirst.mockResolvedValueOnce(
      volunteerRequest("PENDING"),
    );
    harness.volunteerClaimUpdateMany.mockRejectedValueOnce(failure);

    await expect(
      harness.service.withdrawVolunteerRequest("auth0|student", 31),
    ).rejects.toBe(failure);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createTimesheetWorkflowService,
  type TimesheetWorkflowPrismaClient,
  type TimesheetWorkflowStatus,
  type TimesheetWorkflowTransaction,
} from "./timesheet-workflows.js";

type DecimalFixture = number | string | { toString(): string };

interface TimesheetFixture {
  id: number;
  weekStart: Date;
  status: TimesheetWorkflowStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
  workLogs: Array<{ hours: DecimalFixture }>;
}

function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

function timesheet(
  status: TimesheetWorkflowStatus = "DRAFT",
  overrides: Partial<TimesheetFixture> = {},
): TimesheetFixture {
  return {
    id: 12,
    weekStart: new Date("2030-09-02T00:00:00.000Z"),
    status,
    submittedAt: null,
    reviewedAt: null,
    reviewReason: null,
    workLogs: [{ hours: decimal("2.25") }],
    ...overrides,
  };
}

interface HarnessOptions {
  profile?:
    | {
        id: number;
        role: string;
        hourLimit: { weeklyHours: DecimalFixture } | null;
      }
    | null;
  timesheet?: TimesheetFixture | null;
  updateCount?: number;
}

function makeHarness(options: HarnessOptions = {}) {
  const profile =
    options.profile === undefined
      ? {
          id: 7,
          role: "TUTOR",
          hourLimit: { weeklyHours: decimal("8.00") },
        }
      : options.profile;
  const profileFindUnique = vi.fn().mockResolvedValue(profile);
  const timesheetFindFirst = vi
    .fn()
    .mockResolvedValue(options.timesheet === undefined ? timesheet() : options.timesheet);
  const timesheetUpdateMany = vi
    .fn()
    .mockResolvedValue({ count: options.updateCount ?? 1 });
  const transactionClient = {
    profile: { findUnique: profileFindUnique },
    timesheet: {
      findFirst: timesheetFindFirst,
      updateMany: timesheetUpdateMany,
    },
  } as unknown as TimesheetWorkflowTransaction;
  const transaction = vi.fn(
    async (
      operation: (
        client: TimesheetWorkflowTransaction,
      ) => Promise<unknown>,
    ) => operation(transactionClient),
  );
  const client = {
    ...transactionClient,
    $transaction: transaction,
  } as unknown as TimesheetWorkflowPrismaClient;

  return {
    client,
    profileFindUnique,
    timesheetFindFirst,
    timesheetUpdateMany,
    transaction,
  };
}

function expectError(
  action: Promise<unknown>,
  status: number,
  code: string,
) {
  return expect(action).rejects.toMatchObject({ status, code });
}

describe("timesheet workflow status", () => {
  it("returns only the authenticated tutor's safe status summary", async () => {
    const row = timesheet("RETURNED", {
      submittedAt: new Date("2030-09-08T12:00:00.000Z"),
      reviewedAt: new Date("2030-09-09T08:30:00.000Z"),
      reviewReason: "Please correct Tuesday's entry.",
      workLogs: [{ hours: decimal("1.10") }, { hours: decimal("2.25") }],
    });
    const harness = makeHarness({ timesheet: row });
    const service = createTimesheetWorkflowService(harness.client);

    await expect(service.getStatus("auth0|current-tutor", 12)).resolves.toEqual({
      id: 12,
      weekStart: "2030-09-02",
      status: "RETURNED",
      submittedAt: "2030-09-08T12:00:00.000Z",
      reviewedAt: "2030-09-09T08:30:00.000Z",
      reviewReason: "Please correct Tuesday's entry.",
      totalHours: 3.35,
    });
    expect(harness.profileFindUnique).toHaveBeenCalledWith({
      where: { auth0Id: "auth0|current-tutor" },
      select: expect.any(Object),
    });
    expect(harness.timesheetFindFirst).toHaveBeenCalledWith({
      where: { id: 12, tutorId: 7 },
      select: expect.any(Object),
    });
  });

  it.each([null, { id: 7, role: "STUDENT", hourLimit: null }])(
    "returns the same safe 404 for a missing or non-Tutor profile",
    async (profile) => {
      const harness = makeHarness({ profile });
      const service = createTimesheetWorkflowService(harness.client);

      await expectError(
        service.getStatus("auth0|not-a-tutor", 12),
        404,
        "TUTOR_PROFILE_NOT_FOUND",
      );
      expect(harness.timesheetFindFirst).not.toHaveBeenCalled();
    },
  );

  it("uses the same safe 404 for a missing or cross-user timesheet", async () => {
    const harness = makeHarness({ timesheet: null });
    const service = createTimesheetWorkflowService(harness.client);

    await expectError(
      service.getStatus("auth0|current-tutor", 99),
      404,
      "TIMESHEET_NOT_FOUND",
    );
    expect(harness.timesheetFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, tutorId: 7 } }),
    );
  });

  it("fails closed if persisted work-log hours are invalid", async () => {
    const harness = makeHarness({
      timesheet: timesheet("DRAFT", {
        workLogs: [{ hours: decimal("not-a-decimal") }],
      }),
    });

    await expectError(
      createTimesheetWorkflowService(harness.client).getStatus(
        "auth0|current-tutor",
        12,
      ),
      409,
      "TIMESHEET_HOURS_INVALID",
    );
  });
});

describe("timesheet workflow submission", () => {
  it("submits a DRAFT atomically and re-reads the trigger-owned timestamp", async () => {
    const harness = makeHarness();
    const submitted = timesheet("SUBMITTED", {
      submittedAt: new Date("2030-09-08T12:00:00.000Z"),
    });
    harness.timesheetFindFirst
      .mockResolvedValueOnce(timesheet("DRAFT"))
      .mockResolvedValueOnce(submitted);
    const service = createTimesheetWorkflowService(harness.client);

    await expect(service.submit("auth0|current-tutor", 12)).resolves.toEqual({
      id: 12,
      weekStart: "2030-09-02",
      status: "SUBMITTED",
      submittedAt: "2030-09-08T12:00:00.000Z",
      reviewedAt: null,
      reviewReason: null,
      totalHours: 2.25,
    });
    expect(harness.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
    expect(harness.timesheetUpdateMany).toHaveBeenCalledWith({
      where: { id: 12, tutorId: 7, status: "DRAFT" },
      data: { status: "SUBMITTED" },
    });
    expect(harness.timesheetUpdateMany.mock.calls[0]?.[0].data).not.toHaveProperty(
      "submittedAt",
    );
    expect(harness.timesheetFindFirst).toHaveBeenCalledTimes(2);
  });

  it("resubmits RETURNED work, clears the review fields and stamps a fresh submission time", async () => {
    const returned = timesheet("RETURNED", {
      submittedAt: new Date("2030-09-08T12:00:00.000Z"),
      reviewedAt: new Date("2030-09-09T08:30:00.000Z"),
      reviewReason: "Correct the entry.",
    });
    const submitted = timesheet("SUBMITTED", {
      submittedAt: new Date("2030-09-10T10:00:00.000Z"),
    });
    const harness = makeHarness();
    harness.timesheetFindFirst
      .mockResolvedValueOnce(returned)
      .mockResolvedValueOnce(submitted);

    await createTimesheetWorkflowService(harness.client).submit(
      "auth0|current-tutor",
      12,
    );

    expect(harness.timesheetUpdateMany).toHaveBeenCalledWith({
      where: { id: 12, tutorId: 7, status: "RETURNED" },
      data: {
        status: "SUBMITTED",
        submittedAt: expect.any(Date),
        reviewedAt: null,
        reviewedById: null,
        reviewReason: null,
      },
    });
    // The stamped time must be fresh (roughly now), not the original
    // submission, so the organiser queue reorders the resubmission.
    const stamped = harness.timesheetUpdateMany.mock.calls[0]?.[0].data
      .submittedAt as Date;
    expect(Date.now() - stamped.getTime()).toBeLessThan(5_000);
  });

  it.each(["SUBMITTED", "APPROVED"] as const)(
    "rejects a duplicate or invalid %s transition",
    async (status) => {
      const harness = makeHarness({ timesheet: timesheet(status) });
      const service = createTimesheetWorkflowService(harness.client);

      await expectError(
        service.submit("auth0|current-tutor", 12),
        409,
        "TIMESHEET_SUBMISSION_CONFLICT",
      );
      expect(harness.timesheetUpdateMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    { workHours: [decimal("24.00")], weeklyLimit: decimal("24.00") },
    {
      workHours: [decimal("0.10"), decimal("0.20")],
      weeklyLimit: decimal("0.30"),
    },
  ])("accepts exact and fractional Decimal boundaries", async (boundary) => {
    const draft = timesheet("DRAFT", {
      workLogs: boundary.workHours.map((hours) => ({ hours })),
    });
    const submitted = timesheet("SUBMITTED", {
      workLogs: boundary.workHours.map((hours) => ({ hours })),
    });
    const harness = makeHarness({
      profile: {
        id: 7,
        role: "TUTOR",
        hourLimit: { weeklyHours: boundary.weeklyLimit },
      },
    });
    harness.timesheetFindFirst
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(submitted);

    await expect(
      createTimesheetWorkflowService(harness.client).submit(
        "auth0|current-tutor",
        12,
      ),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
  });

  it.each([
    decimal("0"),
    decimal("-1"),
    decimal("24.01"),
    decimal("1.001"),
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid work-log hours %#", async (hours) => {
    const harness = makeHarness({
      timesheet: timesheet("DRAFT", { workLogs: [{ hours }] }),
    });

    await expectError(
      createTimesheetWorkflowService(harness.client).submit(
        "auth0|current-tutor",
        12,
      ),
      409,
      "TIMESHEET_HOURS_INVALID",
    );
    expect(harness.timesheetUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a timesheet with no hours", async () => {
    const harness = makeHarness({
      timesheet: timesheet("DRAFT", { workLogs: [] }),
    });

    await expectError(
      createTimesheetWorkflowService(harness.client).submit(
        "auth0|current-tutor",
        12,
      ),
      409,
      "TIMESHEET_HOURS_INVALID",
    );
  });

  it.each([
    null,
    { weeklyHours: decimal("0") },
    { weeklyHours: decimal("168.01") },
    { weeklyHours: decimal("8.001") },
  ])("rejects a missing or invalid TutorHourLimit", async (hourLimit) => {
    const harness = makeHarness({
      profile: { id: 7, role: "TUTOR", hourLimit },
    });

    await expectError(
      createTimesheetWorkflowService(harness.client).submit(
        "auth0|current-tutor",
        12,
      ),
      409,
      "TIMESHEET_HOURS_INVALID",
    );
  });

  it("rejects an exact Decimal total above the weekly limit", async () => {
    const harness = makeHarness({
      profile: {
        id: 7,
        role: "TUTOR",
        hourLimit: { weeklyHours: decimal("0.29") },
      },
      timesheet: timesheet("DRAFT", {
        workLogs: [{ hours: decimal("0.10") }, { hours: decimal("0.20") }],
      }),
    });

    await expectError(
      createTimesheetWorkflowService(harness.client).submit(
        "auth0|current-tutor",
        12,
      ),
      409,
      "TIMESHEET_HOURS_INVALID",
    );
  });

  it("turns a stale conditional update into a safe conflict", async () => {
    const harness = makeHarness({ updateCount: 0 });

    await expectError(
      createTimesheetWorkflowService(harness.client).submit(
        "auth0|current-tutor",
        12,
      ),
      409,
      "TIMESHEET_SUBMISSION_CONFLICT",
    );
    expect(harness.timesheetFindFirst).toHaveBeenCalledTimes(1);
  });

  it("does not reveal a cross-user timesheet during submission", async () => {
    const harness = makeHarness({ timesheet: null });

    await expectError(
      createTimesheetWorkflowService(harness.client).submit(
        "auth0|current-tutor",
        99,
      ),
      404,
      "TIMESHEET_NOT_FOUND",
    );
    expect(harness.timesheetFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, tutorId: 7 } }),
    );
    expect(harness.timesheetUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["P2003", "TIMESHEET_SUBMISSION_CONFLICT"],
    ["P2004", "TIMESHEET_HOURS_INVALID"],
    ["P2034", "TIMESHEET_SUBMISSION_CONFLICT"],
  ])("maps Prisma %s to the safe 409 contract", async (prismaCode, errorCode) => {
    const harness = makeHarness();
    harness.transaction.mockRejectedValueOnce({ code: prismaCode });

    await expectError(
      createTimesheetWorkflowService(harness.client).submit(
        "auth0|current-tutor",
        12,
      ),
      409,
      errorCode,
    );
  });

  it("maps only a nested adapter check violation to invalid hours", async () => {
    const harness = makeHarness();
    harness.transaction.mockRejectedValueOnce({
      code: "P2039",
      meta: {
        driverAdapterError: {
          cause: { originalCode: "23514" },
        },
      },
    });

    await expectError(
      createTimesheetWorkflowService(harness.client).submit(
        "auth0|current-tutor",
        12,
      ),
      409,
      "TIMESHEET_HOURS_INVALID",
    );
  });

  it("preserves unrelated adapter and unexpected failures", async () => {
    const adapterFailure = {
      code: "P2039",
      meta: { cause: { originalCode: "23505" } },
    };
    const unexpectedFailure = new Error("database unavailable");
    const adapterHarness = makeHarness();
    const unexpectedHarness = makeHarness();
    adapterHarness.transaction.mockRejectedValueOnce(adapterFailure);
    unexpectedHarness.transaction.mockRejectedValueOnce(unexpectedFailure);

    await expect(
      createTimesheetWorkflowService(adapterHarness.client).submit(
        "auth0|current-tutor",
        12,
      ),
    ).rejects.toBe(adapterFailure);
    await expect(
      createTimesheetWorkflowService(unexpectedHarness.client).submit(
        "auth0|current-tutor",
        12,
      ),
    ).rejects.toBe(unexpectedFailure);
  });
});

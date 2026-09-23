import { describe, expect, it, vi } from "vitest";
import {
  TIMESHEET_DECLARATION_STATEMENT,
  TIMESHEET_DECLARATION_VERSION,
  canRaiseDispute,
  createTimesheetCorrectionsService,
  decideTimesheetEdit,
  type TimesheetCorrectionsPrismaClient,
  type TimesheetCorrectionsService,
} from "./timesheet-corrections.js";
import type { TimesheetWorkflowStatus } from "./timesheet-workflows.js";

type DecimalFixture = number | string | { toString(): string };

function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

const AUTH0_TUTOR = "auth0|current-tutor";
const AUTH0_ORGANISER = "auth0|current-organiser";

interface TimesheetFixture {
  id: number;
  tutorId: number;
  weekStart: Date;
  status: TimesheetWorkflowStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
}

function timesheetRow(
  status: TimesheetWorkflowStatus = "RETURNED",
  overrides: Partial<TimesheetFixture> = {},
): TimesheetFixture {
  return {
    id: 12,
    tutorId: 7,
    weekStart: new Date("2030-09-16T00:00:00.000Z"),
    status,
    submittedAt: new Date("2030-09-22T18:00:00.000Z"),
    reviewedAt:
      status === "DRAFT" ? null : new Date("2030-09-23T08:00:00.000Z"),
    reviewReason: status === "RETURNED" ? "Please correct Tuesday hours" : null,
    ...overrides,
  };
}

interface WorkLogFixture {
  id: number;
  timesheetId: number | null;
  allocationId: number;
  workDate: Date;
  hours: DecimalFixture;
  description: string;
}

function workLogRow(overrides: Partial<WorkLogFixture> = {}): WorkLogFixture {
  return {
    id: 41,
    timesheetId: 12,
    allocationId: 5,
    workDate: new Date("2030-09-17T00:00:00.000Z"),
    hours: decimal("2.50"),
    description: "Tuesday tutorial",
    ...overrides,
  };
}

interface RevisionFixture {
  id: number;
  kind: "RETURN" | "CORRECTION";
  workLogId: number | null;
  authorProfileId: number | null;
  reason: string | null;
  previousHours: DecimalFixture | null;
  previousDescription: string | null;
  newHours: DecimalFixture | null;
  newDescription: string | null;
  createdAt: Date;
}

function revisionRow(
  overrides: Partial<RevisionFixture> = {},
): RevisionFixture {
  return {
    id: 91,
    kind: "CORRECTION",
    workLogId: 41,
    authorProfileId: 7,
    reason: "Please correct Tuesday hours",
    previousHours: decimal("2.50"),
    previousDescription: "Tuesday tutorial",
    newHours: decimal("1.75"),
    newDescription: "Tuesday tutorial (shortened)",
    createdAt: new Date("2030-09-23T09:00:00.000Z"),
    ...overrides,
  };
}

interface DeclarationFixture {
  id: number;
  timesheetId: number;
  statementVersion: string;
  declaredAt: Date;
}

function declarationRow(
  overrides: Partial<DeclarationFixture> = {},
): DeclarationFixture {
  return {
    id: 61,
    timesheetId: 12,
    statementVersion: TIMESHEET_DECLARATION_VERSION,
    declaredAt: new Date("2030-09-23T10:00:00.000Z"),
    ...overrides,
  };
}

interface DisputeFixture {
  id: number;
  timesheetId: number;
  tutorId: number;
  reason: string;
  status: "OPEN" | "RESOLVED";
  raisedByProfileId: number;
  resolvedByProfileId: number | null;
  resolutionReason: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

function disputeRow(overrides: Partial<DisputeFixture> = {}): DisputeFixture {
  return {
    id: 71,
    timesheetId: 12,
    tutorId: 7,
    reason: "The Tuesday hours are wrong.",
    status: "OPEN",
    raisedByProfileId: 7,
    resolvedByProfileId: null,
    resolutionReason: null,
    resolvedAt: null,
    createdAt: new Date("2030-09-24T07:00:00.000Z"),
    ...overrides,
  };
}

interface HarnessOptions {
  profile?: { id: number; role: string } | null;
  timesheet?: TimesheetFixture | null;
  workLog?: WorkLogFixture | null;
  workLogs?: WorkLogFixture[];
  updateWorkLogCount?: number;
  createdRevision?: RevisionFixture;
  revision?: RevisionFixture | null;
  revisions?: RevisionFixture[];
  createdDeclaration?: DeclarationFixture;
  declaration?: DeclarationFixture | null;
  declarations?: DeclarationFixture[];
  createdDispute?: DisputeFixture;
  dispute?: DisputeFixture | null;
  disputes?: DisputeFixture[];
  updateDisputeCount?: number;
}

function makeHarness(options: HarnessOptions = {}) {
  const profile =
    options.profile === undefined
      ? { id: 7, role: "TUTOR" }
      : options.profile;
  const timesheet =
    options.timesheet === undefined ? timesheetRow() : options.timesheet;

  const profileFindUnique = vi.fn().mockResolvedValue(profile);
  const timesheetFindFirst = vi.fn().mockResolvedValue(timesheet);
  const timesheetFindUnique = vi.fn().mockResolvedValue(timesheet);
  const workLogFindFirst = vi
    .fn()
    .mockResolvedValue(options.workLog === undefined ? workLogRow() : options.workLog);
  const workLogFindMany = vi
    .fn()
    .mockResolvedValue(options.workLogs ?? [workLogRow()]);
  const workLogUpdateMany = vi
    .fn()
    .mockResolvedValue({ count: options.updateWorkLogCount ?? 1 });
  const revisionCreate = vi
    .fn()
    .mockResolvedValue(options.createdRevision ?? revisionRow());
  const revisionFindFirst = vi
    .fn()
    .mockResolvedValue(options.revision ?? null);
  const revisionFindMany = vi
    .fn()
    .mockResolvedValue(options.revisions ?? []);
  const declarationCreate = vi
    .fn()
    .mockResolvedValue(options.createdDeclaration ?? declarationRow());
  const declarationFindFirst = vi
    .fn()
    .mockResolvedValue(options.declaration ?? null);
  const declarationFindMany = vi
    .fn()
    .mockResolvedValue(options.declarations ?? []);
  const disputeCreate = vi
    .fn()
    .mockResolvedValue(options.createdDispute ?? disputeRow());
  const disputeFindFirst = vi.fn().mockResolvedValue(options.dispute ?? null);
  const disputeFindMany = vi.fn().mockResolvedValue(options.disputes ?? []);
  const disputeUpdateMany = vi
    .fn()
    .mockResolvedValue({ count: options.updateDisputeCount ?? 1 });

  const transactionClient = {
    profile: { findUnique: profileFindUnique },
    timesheet: {
      findFirst: timesheetFindFirst,
      findUnique: timesheetFindUnique,
    },
    workLog: {
      findFirst: workLogFindFirst,
      findMany: workLogFindMany,
      updateMany: workLogUpdateMany,
    },
    timesheetRevision: {
      create: revisionCreate,
      findFirst: revisionFindFirst,
      findMany: revisionFindMany,
    },
    timesheetDeclaration: {
      create: declarationCreate,
      findFirst: declarationFindFirst,
      findMany: declarationFindMany,
    },
    timesheetDispute: {
      create: disputeCreate,
      findFirst: disputeFindFirst,
      findMany: disputeFindMany,
      updateMany: disputeUpdateMany,
    },
  };
  const transaction = vi.fn(
    async (operation: (client: typeof transactionClient) => Promise<unknown>) =>
      operation(transactionClient),
  );
  const client = {
    ...transactionClient,
    $transaction: transaction,
  } as unknown as TimesheetCorrectionsPrismaClient;

  return {
    client,
    transaction,
    profileFindUnique,
    timesheetFindFirst,
    timesheetFindUnique,
    workLogFindFirst,
    workLogFindMany,
    workLogUpdateMany,
    revisionCreate,
    revisionFindFirst,
    revisionFindMany,
    declarationCreate,
    declarationFindFirst,
    declarationFindMany,
    disputeCreate,
    disputeFindFirst,
    disputeFindMany,
    disputeUpdateMany,
  };
}

function expectError(action: Promise<unknown>, status: number, code: string) {
  return expect(action).rejects.toMatchObject({ status, code });
}

function createService(harness: { client: TimesheetCorrectionsPrismaClient }) {
  return createTimesheetCorrectionsService(harness.client);
}

describe("timesheet editability rule", () => {
  it.each([
    ["DRAFT", true, false],
    ["RETURNED", true, true],
    // A submitted sheet is with an organiser and an approved one is settled:
    // neither may be changed by whoever holds the client.
    ["SUBMITTED", false, false],
    ["APPROVED", false, false],
  ] as const)(
    "decides %s: allowed %s, declaration %s",
    (status, allowed, requiresDeclaration) => {
      expect(decideTimesheetEdit(status)).toEqual({
        allowed,
        requiresDeclaration,
      });
    },
  );

  it("only lets a decided timesheet be disputed", () => {
    expect(canRaiseDispute("DRAFT")).toBe(false);
    expect(canRaiseDispute("SUBMITTED")).toBe(false);
    expect(canRaiseDispute("RETURNED")).toBe(true);
    expect(canRaiseDispute("APPROVED")).toBe(true);
  });

  it("publishes an acknowledgement that says something", () => {
    expect(TIMESHEET_DECLARATION_VERSION).toMatch(/^s3-m3-v\d+$/);
    expect(TIMESHEET_DECLARATION_STATEMENT.length).toBeGreaterThan(40);
  });
});

describe("timesheet history", () => {
  it("returns the sheet, its evidence, its history and the wording to declare", async () => {
    const harness = makeHarness({
      timesheet: timesheetRow("RETURNED"),
      workLogs: [workLogRow({ hours: decimal("1.25"), description: "Tuesday" })],
      revisions: [
        revisionRow({ id: 90, kind: "RETURN", workLogId: null, reason: "Please correct Tuesday hours", previousHours: null, previousDescription: null, newHours: null, newDescription: null }),
        revisionRow({ id: 91 }),
      ],
      declarations: [declarationRow()],
      disputes: [disputeRow()],
    });
    const service = createService(harness);

    await expect(service.history(AUTH0_TUTOR, 12)).resolves.toEqual({
      timesheet: {
        id: 12,
        weekStart: "2030-09-16",
        status: "RETURNED",
        submittedAt: "2030-09-22T18:00:00.000Z",
        reviewedAt: "2030-09-23T08:00:00.000Z",
        reviewReason: "Please correct Tuesday hours",
        totalHours: 1.25,
        editable: true,
      },
      workLogs: [
        {
          id: 41,
          allocationId: 5,
          timesheetId: 12,
          workDate: "2030-09-17",
          hours: 1.25,
          description: "Tuesday",
        },
      ],
      revisions: [
        {
          id: 90,
          kind: "RETURN",
          workLogId: null,
          authorProfileId: 7,
          reason: "Please correct Tuesday hours",
          previousHours: null,
          previousDescription: null,
          newHours: null,
          newDescription: null,
          createdAt: "2030-09-23T09:00:00.000Z",
        },
        {
          id: 91,
          kind: "CORRECTION",
          workLogId: 41,
          authorProfileId: 7,
          reason: "Please correct Tuesday hours",
          previousHours: 2.5,
          previousDescription: "Tuesday tutorial",
          newHours: 1.75,
          newDescription: "Tuesday tutorial (shortened)",
          createdAt: "2030-09-23T09:00:00.000Z",
        },
      ],
      declarations: [
        {
          id: 61,
          timesheetId: 12,
          statementVersion: TIMESHEET_DECLARATION_VERSION,
          declaredAt: "2030-09-23T10:00:00.000Z",
        },
      ],
      disputes: [
        {
          id: 71,
          timesheetId: 12,
          tutorId: 7,
          reason: "The Tuesday hours are wrong.",
          status: "OPEN",
          raisedByProfileId: 7,
          resolvedByProfileId: null,
          resolutionReason: null,
          resolvedAt: null,
          createdAt: "2030-09-24T07:00:00.000Z",
        },
      ],
      declaration: {
        statementVersion: TIMESHEET_DECLARATION_VERSION,
        statement: TIMESHEET_DECLARATION_STATEMENT,
      },
    });
    expect(harness.timesheetFindFirst).toHaveBeenCalledWith({
      where: { id: 12, tutorId: 7 },
      select: expect.any(Object),
    });
  });

  it("reports an approved sheet as no longer editable", async () => {
    const harness = makeHarness({ timesheet: timesheetRow("APPROVED") });
    const service = createService(harness);

    const history = await service.history(AUTH0_TUTOR, 12);

    expect(history.timesheet.editable).toBe(false);
  });

  it("cannot read a timesheet belonging to another tutor", async () => {
    const harness = makeHarness({ timesheet: null });
    const service = createService(harness);

    await expectError(service.history(AUTH0_TUTOR, 12), 404, "TIMESHEET_NOT_FOUND");
  });
});

describe("correcting a work log", () => {
  const correction = { hours: 1.75, description: "Tuesday tutorial (shortened)" };

  it("keeps the prior hours and description beside the corrected ones", async () => {
    const harness = makeHarness({ timesheet: timesheetRow("RETURNED") });
    const service = createService(harness);

    await expect(service.correctWorkLog(AUTH0_TUTOR, 12, 41, correction)).resolves.toEqual({
      workLog: {
        id: 41,
        allocationId: 5,
        timesheetId: 12,
        workDate: "2030-09-17",
        hours: 1.75,
        description: "Tuesday tutorial (shortened)",
      },
      revision: {
        id: 91,
        kind: "CORRECTION",
        workLogId: 41,
        authorProfileId: 7,
        reason: "Please correct Tuesday hours",
        previousHours: 2.5,
        previousDescription: "Tuesday tutorial",
        newHours: 1.75,
        newDescription: "Tuesday tutorial (shortened)",
        createdAt: "2030-09-23T09:00:00.000Z",
      },
    });

    // The record of what it replaced is written with the change itself, and
    // carries the organiser's reason while the sheet can still show it.
    expect(harness.revisionCreate).toHaveBeenCalledWith({
      data: {
        timesheetId: 12,
        tutorId: 7,
        kind: "CORRECTION",
        workLogId: 41,
        authorProfileId: 7,
        reason: "Please correct Tuesday hours",
        previousHours: 2.5,
        previousDescription: "Tuesday tutorial",
        newHours: 1.75,
        newDescription: "Tuesday tutorial (shortened)",
      },
      select: expect.any(Object),
    });
    expect(harness.workLogUpdateMany).toHaveBeenCalledWith({
      where: { id: 41, tutorId: 7, timesheetId: 12 },
      data: { hours: 1.75, description: "Tuesday tutorial (shortened)" },
    });
  });

  it("still records a correction on a draft sheet, without a return reason", async () => {
    const harness = makeHarness({
      timesheet: timesheetRow("DRAFT"),
      createdRevision: revisionRow({ reason: null }),
    });
    const service = createService(harness);

    await service.correctWorkLog(AUTH0_TUTOR, 12, 41, correction);

    expect(harness.revisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: null, kind: "CORRECTION" }),
      }),
    );
  });

  it.each(["SUBMITTED", "APPROVED"] as const)(
    "refuses to change a %s timesheet even when the API is called directly",
    async (status) => {
      const harness = makeHarness({ timesheet: timesheetRow(status) });
      const service = createService(harness);

      await expectError(
        service.correctWorkLog(AUTH0_TUTOR, 12, 41, correction),
        409,
        "TIMESHEET_EDIT_LOCKED",
      );
      // Refused before anything was read or written, so a locked sheet cannot
      // be left half-corrected.
      expect(harness.workLogFindFirst).not.toHaveBeenCalled();
      expect(harness.workLogUpdateMany).not.toHaveBeenCalled();
      expect(harness.revisionCreate).not.toHaveBeenCalled();
    },
  );

  it("refuses a work log that is not part of the timesheet", async () => {
    const harness = makeHarness({ workLog: null });
    const service = createService(harness);

    await expectError(
      service.correctWorkLog(AUTH0_TUTOR, 12, 99, correction),
      404,
      "WORK_LOG_NOT_FOUND",
    );
    expect(harness.revisionCreate).not.toHaveBeenCalled();
  });

  it("cannot correct a work log on another tutor's timesheet", async () => {
    const harness = makeHarness({ timesheet: null });
    const service = createService(harness);

    await expectError(
      service.correctWorkLog("auth0|other-tutor", 12, 41, correction),
      404,
      "TIMESHEET_NOT_FOUND",
    );
    expect(harness.workLogUpdateMany).not.toHaveBeenCalled();
  });

  it("reports a race as a conflict instead of a silent overwrite", async () => {
    const harness = makeHarness({ updateWorkLogCount: 0 });
    const service = createService(harness);

    await expectError(
      service.correctWorkLog(AUTH0_TUTOR, 12, 41, correction),
      409,
      "TIMESHEET_CORRECTION_CONFLICT",
    );
    expect(harness.revisionCreate).not.toHaveBeenCalled();
  });

  it.each([
    { code: "P2002" },
    { code: "P2003" },
    { code: "P2004" },
    // The serializable transaction turns a concurrent status change into a
    // write conflict, which is a retryable conflict rather than a server fault.
    { code: "P2034" },
    { code: "P2039", meta: { driverAdapterError: { cause: { originalCode: "23514" } } } },
  ])("translates $code into a correction conflict", async (failure) => {
    const harness = makeHarness();
    harness.workLogUpdateMany.mockRejectedValueOnce(failure);
    const service = createService(harness);

    await expectError(
      service.correctWorkLog(AUTH0_TUTOR, 12, 41, correction),
      409,
      "TIMESHEET_CORRECTION_CONFLICT",
    );
  });

  it("preserves a failure it cannot prove it understands", async () => {
    const harness = makeHarness();
    const unexpected = new Error("database unavailable");
    harness.workLogUpdateMany.mockRejectedValueOnce(unexpected);
    const service = createService(harness);

    await expect(service.correctWorkLog(AUTH0_TUTOR, 12, 41, correction)).rejects.toBe(
      unexpected,
    );
  });
});

describe("digital declaration", () => {
  it("records who acknowledged which wording and when", async () => {
    const harness = makeHarness({ timesheet: timesheetRow("RETURNED") });
    const service = createService(harness);

    await expect(
      service.declare(AUTH0_TUTOR, 12, TIMESHEET_DECLARATION_VERSION),
    ).resolves.toEqual({
      id: 61,
      timesheetId: 12,
      statementVersion: TIMESHEET_DECLARATION_VERSION,
      declaredAt: "2030-09-23T10:00:00.000Z",
    });
    expect(harness.declarationCreate).toHaveBeenCalledWith({
      data: {
        timesheetId: 12,
        tutorId: 7,
        statementVersion: TIMESHEET_DECLARATION_VERSION,
      },
      select: expect.any(Object),
    });
  });

  it("rejects an acknowledgement of wording the tutor was never shown", async () => {
    const harness = makeHarness();
    const service = createService(harness);

    await expectError(
      service.declare(AUTH0_TUTOR, 12, "s3-m3-v0"),
      409,
      "TIMESHEET_DECLARATION_STALE",
    );
    expect(harness.declarationCreate).not.toHaveBeenCalled();
  });

  it("will not take a declaration against a sheet that is already with an organiser", async () => {
    const harness = makeHarness({ timesheet: timesheetRow("SUBMITTED") });
    const service = createService(harness);

    await expectError(
      service.declare(AUTH0_TUTOR, 12, TIMESHEET_DECLARATION_VERSION),
      409,
      "TIMESHEET_EDIT_LOCKED",
    );
    expect(harness.declarationCreate).not.toHaveBeenCalled();
  });
});

describe("resubmission readiness", () => {
  it("asks nothing of a first submission", async () => {
    const harness = makeHarness({ timesheet: timesheetRow("DRAFT") });
    const service = createService(harness);

    await expect(
      service.assertResubmissionReady(AUTH0_TUTOR, 12),
    ).resolves.toBeUndefined();
    expect(harness.declarationFindFirst).not.toHaveBeenCalled();
  });

  it("requires a declaration before a returned sheet goes back", async () => {
    const harness = makeHarness({ declaration: null });
    const service = createService(harness);

    await expectError(
      service.assertResubmissionReady(AUTH0_TUTOR, 12),
      409,
      "TIMESHEET_DECLARATION_REQUIRED",
    );
  });

  it("rejects a declaration made before the return it answers", async () => {
    const harness = makeHarness({
      declaration: declarationRow({
        declaredAt: new Date("2030-09-23T07:30:00.000Z"),
      }),
    });
    const service = createService(harness);

    await expectError(
      service.assertResubmissionReady(AUTH0_TUTOR, 12),
      409,
      "TIMESHEET_DECLARATION_REQUIRED",
    );
  });

  it("rejects a declaration made before a later correction", async () => {
    const harness = makeHarness({
      declaration: declarationRow({
        declaredAt: new Date("2030-09-23T09:30:00.000Z"),
      }),
      revision: revisionRow({ createdAt: new Date("2030-09-23T11:00:00.000Z") }),
    });
    const service = createService(harness);

    await expectError(
      service.assertResubmissionReady(AUTH0_TUTOR, 12),
      409,
      "TIMESHEET_DECLARATION_REQUIRED",
    );
  });

  it("accepts a declaration newer than both the return and the last correction", async () => {
    const harness = makeHarness({
      declaration: declarationRow({
        declaredAt: new Date("2030-09-23T11:30:00.000Z"),
      }),
      revision: revisionRow({ createdAt: new Date("2030-09-23T11:00:00.000Z") }),
    });
    const service = createService(harness);

    await expect(
      service.assertResubmissionReady(AUTH0_TUTOR, 12),
    ).resolves.toBeUndefined();
  });
});

describe("disputes", () => {
  it("raises an objection against a decided sheet", async () => {
    const harness = makeHarness({ timesheet: timesheetRow("APPROVED") });
    const service = createService(harness);

    await expect(
      service.raiseDispute(AUTH0_TUTOR, 12, { reason: "The Tuesday hours are wrong." }),
    ).resolves.toMatchObject({ id: 71, status: "OPEN", tutorId: 7 });
    expect(harness.disputeCreate).toHaveBeenCalledWith({
      data: {
        timesheetId: 12,
        tutorId: 7,
        reason: "The Tuesday hours are wrong.",
        raisedByProfileId: 7,
      },
      select: expect.any(Object),
    });
  });

  it("refuses to dispute a draft that has never been submitted", async () => {
    const harness = makeHarness({ timesheet: timesheetRow("DRAFT") });
    const service = createService(harness);

    await expectError(
      service.raiseDispute(AUTH0_TUTOR, 12, { reason: "Something is wrong." }),
      409,
      "TIMESHEET_DISPUTE_NOT_ALLOWED",
    );
    expect(harness.disputeCreate).not.toHaveBeenCalled();
  });

  it("cannot dispute another tutor's timesheet", async () => {
    const harness = makeHarness({ timesheet: null });
    const service = createService(harness);

    await expectError(
      service.raiseDispute("auth0|other-tutor", 12, { reason: "Something is wrong." }),
      404,
      "TIMESHEET_NOT_FOUND",
    );
  });

  it.each([
    { code: "P2002" },
    { code: "P2039", meta: { driverAdapterError: { cause: { originalCode: "23505" } } } },
  ])("reports a second open dispute as one already waiting: $code", async (failure) => {
    const harness = makeHarness();
    harness.disputeCreate.mockRejectedValueOnce(failure);
    const service = createService(harness);

    await expectError(
      service.raiseDispute(AUTH0_TUTOR, 12, { reason: "Again." }),
      409,
      "TIMESHEET_DISPUTE_OPEN",
    );
  });

  it("answers an open dispute as an organiser", async () => {
    const harness = makeHarness({
      profile: { id: 3, role: "ORGANISER" },
      createdDispute: disputeRow({
        status: "RESOLVED",
        resolvedByProfileId: 3,
        resolutionReason: "Agreed, the hours have been corrected.",
        resolvedAt: new Date("2030-09-25T09:00:00.000Z"),
      }),
      dispute: disputeRow({
        status: "RESOLVED",
        resolvedByProfileId: 3,
        resolutionReason: "Agreed, the hours have been corrected.",
        resolvedAt: new Date("2030-09-25T09:00:00.000Z"),
      }),
    });
    const service = createService(harness);

    await expect(
      service.resolveDispute(AUTH0_ORGANISER, 71, {
        resolutionReason: "Agreed, the hours have been corrected.",
      }),
    ).resolves.toMatchObject({
      id: 71,
      status: "RESOLVED",
      resolvedByProfileId: 3,
      resolutionReason: "Agreed, the hours have been corrected.",
      resolvedAt: "2030-09-25T09:00:00.000Z",
    });
    expect(harness.disputeUpdateMany).toHaveBeenCalledWith({
      where: { id: 71, status: "OPEN" },
      data: {
        status: "RESOLVED",
        resolutionReason: "Agreed, the hours have been corrected.",
        resolvedByProfileId: 3,
        resolvedAt: expect.any(Date),
      },
    });
  });

  it("refuses to answer a dispute as a tutor", async () => {
    const harness = makeHarness();
    const service = createService(harness);

    await expectError(
      service.resolveDispute(AUTH0_TUTOR, 71, { resolutionReason: "No." }),
      404,
      "ORGANISER_PROFILE_NOT_FOUND",
    );
    expect(harness.disputeUpdateMany).not.toHaveBeenCalled();
  });

  it("reports an unknown dispute as missing", async () => {
    const harness = makeHarness({
      profile: { id: 3, role: "ORGANISER" },
      dispute: null,
    });
    const service = createService(harness);

    await expectError(
      service.resolveDispute(AUTH0_ORGANISER, 99, { resolutionReason: "No." }),
      404,
      "TIMESHEET_DISPUTE_NOT_FOUND",
    );
  });

  it("reports a dispute that was answered twice as a conflict", async () => {
    const harness = makeHarness({
      profile: { id: 3, role: "ORGANISER" },
      dispute: disputeRow(),
      updateDisputeCount: 0,
    });
    const service = createService(harness);

    await expectError(
      service.resolveDispute(AUTH0_ORGANISER, 71, { resolutionReason: "No." }),
      409,
      "TIMESHEET_DISPUTE_CONFLICT",
    );
  });

  it("lists the open objections oldest first for the responsible organiser", async () => {
    const harness = makeHarness({
      profile: { id: 3, role: "ORGANISER" },
      disputes: [disputeRow({ id: 71 }), disputeRow({ id: 72 })],
    });
    const service = createService(harness);

    const disputes = await service.listDisputes(AUTH0_ORGANISER);

    expect(disputes.map(({ id }) => id)).toEqual([71, 72]);
    expect(harness.disputeFindMany).toHaveBeenCalledWith({
      where: { status: "OPEN" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: expect.any(Object),
    });
  });
});

describe("recording why a timesheet was returned", () => {
  it("keeps the reason and the organiser as the author", async () => {
    const harness = makeHarness({
      profile: { id: 3, role: "ORGANISER" },
      timesheet: timesheetRow("RETURNED"),
      createdRevision: revisionRow({
        id: 90,
        kind: "RETURN",
        workLogId: null,
        authorProfileId: 3,
        previousHours: null,
        previousDescription: null,
        newHours: null,
        newDescription: null,
      }),
    });
    const service = createService(harness);

    await expect(service.recordReturn(AUTH0_ORGANISER, 12)).resolves.toMatchObject({
      id: 90,
      kind: "RETURN",
      authorProfileId: 3,
      reason: "Please correct Tuesday hours",
    });
    expect(harness.revisionCreate).toHaveBeenCalledWith({
      data: {
        timesheetId: 12,
        tutorId: 7,
        kind: "RETURN",
        authorProfileId: 3,
        reason: "Please correct Tuesday hours",
      },
      select: expect.any(Object),
    });
  });

  it("records nothing when the decision was not a return", async () => {
    const harness = makeHarness({
      profile: { id: 3, role: "ORGANISER" },
      timesheet: timesheetRow("APPROVED"),
    });
    const service = createService(harness);

    await expect(service.recordReturn(AUTH0_ORGANISER, 12)).resolves.toBeNull();
    expect(harness.revisionCreate).not.toHaveBeenCalled();
  });

  it("does not record the same return twice when it is replayed", async () => {
    const harness = makeHarness({
      profile: { id: 3, role: "ORGANISER" },
      timesheet: timesheetRow("RETURNED"),
      revision: revisionRow({ id: 90, kind: "RETURN", createdAt: new Date("2030-09-23T08:00:01.000Z") }),
    });
    const service = createService(harness);

    await expect(service.recordReturn(AUTH0_ORGANISER, 12)).resolves.toMatchObject({
      id: 90,
      kind: "RETURN",
    });
    expect(harness.revisionCreate).not.toHaveBeenCalled();
  });

  it("refuses to record a return for a tutor", async () => {
    const harness = makeHarness();
    const service = createService(harness);

    await expectError(
      service.recordReturn(AUTH0_TUTOR, 12),
      404,
      "ORGANISER_PROFILE_NOT_FOUND",
    );
    expect(harness.revisionCreate).not.toHaveBeenCalled();
  });
});

describe("correction service surface", () => {
  it("exposes every capability the routes depend on", () => {
    const service: TimesheetCorrectionsService = createService(makeHarness());

    expect(Object.keys(service).sort()).toEqual([
      "assertResubmissionReady",
      "correctWorkLog",
      "declare",
      "history",
      "listDisputes",
      "raiseDispute",
      "recordReturn",
      "resolveDispute",
    ]);
  });
});

import { createRouteError } from "../app.js";

export type TimesheetWorkflowStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "RETURNED";

export interface TimesheetWorkflowSummary {
  id: number;
  weekStart: string;
  status: TimesheetWorkflowStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  totalHours: number;
}

export interface TimesheetWorkflowError extends Error {
  status: 404 | 409;
  code:
    | "TUTOR_PROFILE_NOT_FOUND"
    | "TIMESHEET_NOT_FOUND"
    | "TIMESHEET_HOURS_INVALID"
    | "TIMESHEET_SUBMISSION_CONFLICT";
}

type DecimalValue = number | string | { toString(): string };

interface TutorProfileRow {
  id: number;
  role: string;
  hourLimit: { weeklyHours: DecimalValue } | null;
}

interface TimesheetRow {
  id: number;
  weekStart: Date;
  status: TimesheetWorkflowStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
  workLogs: Array<{ hours: DecimalValue }>;
}

interface ProfileDelegate {
  findUnique(args: {
    where: { auth0Id: string };
    select: {
      id: true;
      role: true;
      hourLimit: { select: { weeklyHours: true } };
    };
  }): Promise<TutorProfileRow | null>;
}

interface TimesheetDelegate {
  findFirst(args: {
    where: { id: number; tutorId: number };
    select: {
      id: true;
      weekStart: true;
      status: true;
      submittedAt: true;
      reviewedAt: true;
      reviewReason: true;
      workLogs: { select: { hours: true } };
    };
  }): Promise<TimesheetRow | null>;
  updateMany(args: {
    where: {
      id: number;
      tutorId: number;
      status: TimesheetWorkflowStatus;
    };
    data: {
      status: "SUBMITTED";
      submittedAt?: Date;
      reviewedAt?: null;
      reviewedById?: null;
      reviewReason?: null;
    };
  }): Promise<{ count: number }>;
}

export interface TimesheetWorkflowTransaction {
  profile: ProfileDelegate;
  timesheet: TimesheetDelegate;
}

export interface TimesheetWorkflowPrismaClient
  extends TimesheetWorkflowTransaction {
  $transaction<Result>(
    operation: (
      transaction: TimesheetWorkflowTransaction,
    ) => Promise<Result>,
    options: { isolationLevel: "Serializable" },
  ): Promise<Result>;
}

export interface TimesheetWorkflowService {
  getStatus(
    auth0Id: string,
    timesheetId: number,
  ): Promise<TimesheetWorkflowSummary>;
  submit(
    auth0Id: string,
    timesheetId: number,
  ): Promise<TimesheetWorkflowSummary>;
}

const profileSelect = {
  id: true,
  role: true,
  hourLimit: { select: { weeklyHours: true } },
} as const;

const timesheetSelect = {
  id: true,
  weekStart: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewReason: true,
  workLogs: { select: { hours: true } },
} as const;

function workflowError(
  status: 404 | 409,
  code: TimesheetWorkflowError["code"],
  message: string,
): TimesheetWorkflowError {
  return createRouteError(status, code, message) as TimesheetWorkflowError;
}

function tutorNotFound(): TimesheetWorkflowError {
  return workflowError(
    404,
    "TUTOR_PROFILE_NOT_FOUND",
    "No tutor profile is linked to this account.",
  );
}

function timesheetNotFound(): TimesheetWorkflowError {
  return workflowError(
    404,
    "TIMESHEET_NOT_FOUND",
    "The requested timesheet could not be found.",
  );
}

function invalidHours(): TimesheetWorkflowError {
  return workflowError(
    409,
    "TIMESHEET_HOURS_INVALID",
    "The timesheet hours or weekly limit are invalid.",
  );
}

function submissionConflict(): TimesheetWorkflowError {
  return workflowError(
    409,
    "TIMESHEET_SUBMISSION_CONFLICT",
    "The timesheet cannot be submitted from its current state.",
  );
}

function isWorkflowError(value: unknown): value is TimesheetWorkflowError {
  return (
    value instanceof Error &&
    "status" in value &&
    "code" in value &&
    (value.status === 404 || value.status === 409) &&
    typeof value.code === "string"
  );
}

function prismaErrorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("code" in value)) {
    return null;
  }

  return typeof value.code === "string" ? value.code : null;
}

function containsOriginalCode23514(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return false;
  }

  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (key === "originalCode" && nested === "23514") {
      return true;
    }
    if (containsOriginalCode23514(nested, seen)) {
      return true;
    }
  }
  return false;
}

function mapPersistenceError(value: unknown): never {
  if (isWorkflowError(value)) {
    throw value;
  }

  const code = prismaErrorCode(value);
  if (code === "P2004") {
    throw invalidHours();
  }
  if (
    code === "P2039" &&
    typeof value === "object" &&
    value !== null &&
    "meta" in value &&
    containsOriginalCode23514(value.meta)
  ) {
    throw invalidHours();
  }
  if (code === "P2003" || code === "P2034") {
    throw submissionConflict();
  }

  throw value;
}

function decimalText(value: DecimalValue): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : null;
  }
  if (typeof value === "string") {
    return value.trim();
  }

  try {
    return value.toString().trim();
  } catch {
    return null;
  }
}

function decimalHundredths(value: DecimalValue): bigint | null {
  const text = decimalText(value);
  if (!text) {
    return null;
  }

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    return null;
  }

  try {
    const whole = BigInt(match[1]!);
    const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
    return whole * 100n + fraction;
  } catch {
    return null;
  }
}

function workLogTotalHundredths(
  workLogs: TimesheetRow["workLogs"],
): bigint | null {
  let total = 0n;
  for (const workLog of workLogs) {
    const hours = decimalHundredths(workLog.hours);
    if (hours === null || hours <= 0n || hours > 2_400n) {
      return null;
    }
    total += hours;
  }
  return total;
}

function safeTotalHours(total: bigint): number {
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidHours();
  }
  return Number(total) / 100;
}

function summarizeTimesheet(row: TimesheetRow): TimesheetWorkflowSummary {
  const total = workLogTotalHundredths(row.workLogs);
  if (total === null) {
    throw invalidHours();
  }

  return {
    id: row.id,
    weekStart: row.weekStart.toISOString().slice(0, 10),
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewReason: row.reviewReason,
    totalHours: safeTotalHours(total),
  };
}

async function resolveTutor(
  client: TimesheetWorkflowTransaction,
  auth0Id: string,
): Promise<TutorProfileRow> {
  const profile = await client.profile.findUnique({
    where: { auth0Id },
    select: profileSelect,
  });
  if (profile?.role !== "TUTOR") {
    throw tutorNotFound();
  }
  return profile;
}

async function findOwnedTimesheet(
  client: TimesheetWorkflowTransaction,
  tutorId: number,
  timesheetId: number,
): Promise<TimesheetRow> {
  const timesheet = await client.timesheet.findFirst({
    where: { id: timesheetId, tutorId },
    select: timesheetSelect,
  });
  if (!timesheet) {
    throw timesheetNotFound();
  }
  return timesheet;
}

function validateSubmissionHours(
  timesheet: TimesheetRow,
  hourLimit: TutorProfileRow["hourLimit"],
): void {
  if (timesheet.workLogs.length === 0 || !hourLimit) {
    throw invalidHours();
  }

  const total = workLogTotalHundredths(timesheet.workLogs);
  const weeklyLimit = decimalHundredths(hourLimit.weeklyHours);
  if (
    total === null ||
    total <= 0n ||
    weeklyLimit === null ||
    weeklyLimit <= 0n ||
    weeklyLimit > 16_800n ||
    total > weeklyLimit
  ) {
    throw invalidHours();
  }
}

export function createTimesheetWorkflowService(
  prismaClient: TimesheetWorkflowPrismaClient,
): TimesheetWorkflowService {
  return {
    async getStatus(auth0Id, timesheetId) {
      try {
        const tutor = await resolveTutor(prismaClient, auth0Id);
        const timesheet = await findOwnedTimesheet(
          prismaClient,
          tutor.id,
          timesheetId,
        );
        return summarizeTimesheet(timesheet);
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    async submit(auth0Id, timesheetId) {
      try {
        return await prismaClient.$transaction(
          async (transaction) => {
            const tutor = await resolveTutor(transaction, auth0Id);
            const timesheet = await findOwnedTimesheet(
              transaction,
              tutor.id,
              timesheetId,
            );

            if (
              timesheet.status !== "DRAFT" &&
              timesheet.status !== "RETURNED"
            ) {
              throw submissionConflict();
            }
            validateSubmissionHours(timesheet, tutor.hourLimit);

            // A returned timesheet is being re-submitted: stamp a fresh
            // submission time so the organiser queue orders it by when the tutor
            // actually re-submitted, not the original submission. The transition
            // trigger only auto-fills submittedAt when the caller leaves it
            // unchanged, so this explicit value is honoured.
            const data =
              timesheet.status === "RETURNED"
                ? {
                    status: "SUBMITTED" as const,
                    submittedAt: new Date(),
                    reviewedAt: null,
                    reviewedById: null,
                    reviewReason: null,
                  }
                : { status: "SUBMITTED" as const };
            const result = await transaction.timesheet.updateMany({
              where: {
                id: timesheet.id,
                tutorId: tutor.id,
                status: timesheet.status,
              },
              data,
            });
            if (result.count !== 1) {
              throw submissionConflict();
            }

            const updated = await findOwnedTimesheet(
              transaction,
              tutor.id,
              timesheet.id,
            );
            return summarizeTimesheet(updated);
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        return mapPersistenceError(error);
      }
    },
  };
}

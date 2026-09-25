import { matchesVersion, permitsTransition } from "../http/validation.js";
import { createRouteError, type TutorWorkLogSummary } from "../app.js";
import type { TimesheetWorkflowStatus } from "./timesheet-workflows.js";

/**
 * Returned-timesheet corrections, declarations and disputes.
 *
 * This module deliberately does not re-implement the timesheet state machine.
 * "DRAFT -> SUBMITTED", "RETURNED -> SUBMITTED" and "SUBMITTED -> APPROVED |
 * RETURNED" are already enforced by the "enforce_timesheet_transition" trigger,
 * and "work logs can only change on draft or returned timesheets" is already
 * enforced by "enforce_work_log_rules". What was missing is everything around
 * those rules: a record of what a correction replaced, an explicit
 * acknowledgement of a resubmission, and somewhere to raise an objection.
 *
 * The service therefore answers three questions before it writes anything, and
 * lets the database have the last word:
 *   1. May this timesheet be edited at all? (DRAFT or RETURNED only)
 *   2. Does this resubmission have a declaration that covers the figures being
 *      sent? (recorded after both the return and the last correction)
 *   3. May this timesheet be disputed? (anything that has been submitted)
 */

export type TimesheetEditableStatus = "DRAFT" | "RETURNED";

/**
 * The wording a tutor acknowledges when resubmitting. The version is stored with
 * every acknowledgement so a later wording change cannot be mistaken for consent
 * to the old one, and the API rejects an acknowledgement of a stale version.
 */
export const TIMESHEET_DECLARATION_VERSION = "s3-m3-v1";

export const TIMESHEET_DECLARATION_STATEMENT =
  "I confirm the hours and descriptions on this timesheet are complete and accurate, " +
  "and that they describe work I actually carried out.";

export interface TimesheetEditDecision {
  allowed: boolean;
  /** True when sending this timesheet needs a fresh declaration first. */
  requiresDeclaration: boolean;
}

/**
 * The single editability rule, kept pure so it can be unit tested directly.
 * A first submission is not a correction of anything, so it needs no
 * declaration; a resubmission after a return always does.
 */
export function decideTimesheetEdit(
  status: TimesheetWorkflowStatus,
): TimesheetEditDecision {
  if (status === "DRAFT") {
    return { allowed: true, requiresDeclaration: false };
  }
  if (status === "RETURNED") {
    return { allowed: true, requiresDeclaration: true };
  }
  return { allowed: false, requiresDeclaration: false };
}

/** Only a decided timesheet can be disputed: DRAFT has not been submitted, and SUBMITTED is still waiting for a decision. */
export function canRaiseDispute(status: TimesheetWorkflowStatus): boolean {
  return status === "RETURNED" || status === "APPROVED";
}

export interface TimesheetRevisionSummary {
  id: number;
  kind: "RETURN" | "CORRECTION";
  workLogId: number | null;
  /** Null once the account that wrote this line of history is deleted. */
  authorProfileId: number | null;
  reason: string | null;
  previousHours: number | null;
  previousDescription: string | null;
  newHours: number | null;
  newDescription: string | null;
  createdAt: string;
}

export interface TimesheetDeclarationSummary {
  id: number;
  timesheetId: number;
  statementVersion: string;
  declaredAt: string;
}

export interface TimesheetDisputeSummary {
  id: number;
  timesheetId: number;
  tutorId: number;
  reason: string;
  status: "OPEN" | "RESOLVED";
  raisedByProfileId: number;
  resolvedByProfileId: number | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface TimesheetCorrectionResult {
  workLog: TutorWorkLogSummary;
  revision: TimesheetRevisionSummary;
}

export interface TimesheetHistory {
  timesheet: {
    id: number;
    weekStart: string;
    status: TimesheetWorkflowStatus;
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewReason: string | null;
    totalHours: number;
    editable: boolean;
  };
  workLogs: TutorWorkLogSummary[];
  revisions: TimesheetRevisionSummary[];
  declarations: TimesheetDeclarationSummary[];
  disputes: TimesheetDisputeSummary[];
  /** The wording to display, and the version the client must echo back. */
  declaration: { statementVersion: string; statement: string };
}

export interface TimesheetCorrectionInput {
  hours: number;
  description: string;
}

export interface TimesheetDisputeInput {
  reason: string;
}

export interface TimesheetDisputeResolutionInput {
  resolutionReason: string;
}

type DecimalValue = number | string | { toString(): string };

interface TimesheetRow {
  id: number;
  tutorId: number;
  weekStart: Date;
  status: TimesheetWorkflowStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
}

interface WorkLogRow {
  id: number;
  timesheetId: number | null;
  allocationId: number;
  workDate: Date;
  hours: DecimalValue;
  description: string;
}

interface RevisionRow {
  id: number;
  kind: "RETURN" | "CORRECTION";
  workLogId: number | null;
  authorProfileId: number | null;
  reason: string | null;
  previousHours: DecimalValue | null;
  previousDescription: string | null;
  newHours: DecimalValue | null;
  newDescription: string | null;
  createdAt: Date;
}

interface DeclarationRow {
  id: number;
  timesheetId: number;
  statementVersion: string;
  declaredAt: Date;
}

interface DisputeRow {
  timesheet?: { weekStart: Date; tutor: { fullName: string; email: string } };
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

interface CorrectionsTransaction {
  profile: {
    findUnique(args: {
      where: { auth0Id: string };
      select: { id: true; role: true };
    }): Promise<{ id: number; role: string } | null>;
  };
  timesheet: {
    /**
     * Reads a timesheet without an ownership filter and is therefore only for
     * the organiser path, which by definition does not own the sheet. Every
     * tutor-facing read goes through findFirst below, which is scoped to the
     * tutor so an id from another tutor can never resolve.
     */
    findUnique(args: {
      where: { id: number };
      select: {
        id: true;
        tutorId: true;
        weekStart: true;
        status: true;
        submittedAt: true;
        reviewedAt: true;
        reviewReason: true;
      };
    }): Promise<TimesheetRow | null>;
    findFirst(args: {
      where: { id: number; tutorId: number };
      select: {
        id: true;
        tutorId: true;
        weekStart: true;
        status: true;
        submittedAt: true;
        reviewedAt: true;
        reviewReason: true;
      };
    }): Promise<TimesheetRow | null>;
  };
  workLog: {
    findFirst(args: {
      where: { id: number; tutorId: number; timesheetId: number };
      select: {
        id: true;
        timesheetId: true;
        allocationId: true;
        workDate: true;
        hours: true;
        description: true;
      };
    }): Promise<WorkLogRow | null>;
    findMany(args: {
      where: { timesheetId: number; tutorId: number };
      orderBy: Array<{ workDate: "asc" } | { id: "asc" }>;
      select: {
        id: true;
        timesheetId: true;
        allocationId: true;
        workDate: true;
        hours: true;
        description: true;
      };
    }): Promise<WorkLogRow[]>;
    updateMany(args: {
      where: { id: number; tutorId: number; timesheetId: number };
      data: { hours: number; description: string };
    }): Promise<{ count: number }>;
  };
  timesheetRevision: {
    create(args: {
      data: {
        timesheetId: number;
        tutorId: number;
        kind: "RETURN" | "CORRECTION";
        workLogId?: number;
        authorProfileId: number;
        reason?: string | null;
        previousHours?: number;
        previousDescription?: string;
        newHours?: number;
        newDescription?: string;
      };
      select: {
        id: true;
        kind: true;
        workLogId: true;
        authorProfileId: true;
        reason: true;
        previousHours: true;
        previousDescription: true;
        newHours: true;
        newDescription: true;
        createdAt: true;
      };
    }): Promise<RevisionRow>;
    findFirst(args: {
      where: {
        timesheetId: number;
        kind?: "RETURN" | "CORRECTION";
        createdAt?: { gte: Date };
      };
      orderBy: { createdAt: "desc" };
      select: {
        id: true;
        kind: true;
        workLogId: true;
        authorProfileId: true;
        reason: true;
        previousHours: true;
        previousDescription: true;
        newHours: true;
        newDescription: true;
        createdAt: true;
      };
    }): Promise<RevisionRow | null>;
    findMany(args: {
      where: { timesheetId: number };
      orderBy: Array<{ createdAt: "asc" } | { id: "asc" }>;
      select: {
        id: true;
        kind: true;
        workLogId: true;
        authorProfileId: true;
        reason: true;
        previousHours: true;
        previousDescription: true;
        newHours: true;
        newDescription: true;
        createdAt: true;
      };
    }): Promise<RevisionRow[]>;
  };
  timesheetDeclaration: {
    create(args: {
      data: {
        timesheetId: number;
        tutorId: number;
        statementVersion: string;
      };
      select: {
        id: true;
        timesheetId: true;
        statementVersion: true;
        declaredAt: true;
      };
    }): Promise<DeclarationRow>;
    findFirst(args: {
      where: { timesheetId: number };
      orderBy: { declaredAt: "desc" };
      select: { id: true; timesheetId: true; statementVersion: true; declaredAt: true };
    }): Promise<DeclarationRow | null>;
    findMany(args: {
      where: { timesheetId: number };
      orderBy: Array<{ declaredAt: "asc" } | { id: "asc" }>;
      select: { id: true; timesheetId: true; statementVersion: true; declaredAt: true };
    }): Promise<DeclarationRow[]>;
  };
  timesheetDispute: {
    create(args: {
      data: {
        timesheetId: number;
        tutorId: number;
        reason: string;
        raisedByProfileId: number;
      };
      select: {
        id: true;
        timesheetId: true;
        tutorId: true;
        reason: true;
        status: true;
        raisedByProfileId: true;
        resolvedByProfileId: true;
        resolutionReason: true;
        resolvedAt: true;
        createdAt: true;
      };
    }): Promise<DisputeRow>;
    findFirst(args: {
      where: { id: number };
      select: {
        id: true;
        timesheetId: true;
        tutorId: true;
        reason: true;
        status: true;
        raisedByProfileId: true;
        resolvedByProfileId: true;
        resolutionReason: true;
        resolvedAt: true;
        createdAt: true;
      };
    }): Promise<DisputeRow | null>;
    findMany(args: {
      where: { timesheetId?: number; status?: "OPEN" | "RESOLVED" };
      orderBy: Array<{ createdAt: "asc" } | { id: "asc" }>;
      select: {
        timesheet: { select: { weekStart: true; tutor: { select: { fullName: true; email: true } } } };
        id: true;
        timesheetId: true;
        tutorId: true;
        reason: true;
        status: true;
        raisedByProfileId: true;
        resolvedByProfileId: true;
        resolutionReason: true;
        resolvedAt: true;
        createdAt: true;
      };
    }): Promise<DisputeRow[]>;
    updateMany(args: {
      where: { id: number; status: "OPEN" };
      data: {
        status: "RESOLVED";
        resolutionReason: string;
        resolvedByProfileId: number;
        resolvedAt: Date;
      };
    }): Promise<{ count: number }>;
  };
}

export interface TimesheetCorrectionsPrismaClient
  extends CorrectionsTransaction {
  $transaction<Result>(
    operation: (transaction: CorrectionsTransaction) => Promise<Result>,
    options: { isolationLevel: "Serializable" },
  ): Promise<Result>;
}

export interface TimesheetCorrectionsService {
  history(auth0Id: string, timesheetId: number): Promise<TimesheetHistory>;
  /**
   * Records why a timesheet was returned. Nothing is recorded, and null is
   * returned, when the timesheet is not sitting in a returned state.
   */
  recordReturn(
    auth0Id: string,
    timesheetId: number,
  ): Promise<TimesheetRevisionSummary | null>;
  correctWorkLog(
    auth0Id: string,
    timesheetId: number,
    workLogId: number,
    input: TimesheetCorrectionInput,
  ): Promise<TimesheetCorrectionResult>;
  declare(
    auth0Id: string,
    timesheetId: number,
    statementVersion: string,
  ): Promise<TimesheetDeclarationSummary>;
  assertResubmissionReady(auth0Id: string, timesheetId: number): Promise<void>;
  raiseDispute(
    auth0Id: string,
    timesheetId: number,
    input: TimesheetDisputeInput,
  ): Promise<TimesheetDisputeSummary>;
  resolveDispute(
    auth0Id: string,
    disputeId: number,
    input: TimesheetDisputeResolutionInput,
  ): Promise<TimesheetDisputeSummary>;
  /** The organiser queue: every objection still waiting for an answer. */
  listDisputes(auth0Id: string): Promise<TimesheetDisputeSummary[]>;
}

export type TimesheetCorrectionErrorCode =
  | "TUTOR_PROFILE_NOT_FOUND"
  | "ORGANISER_PROFILE_NOT_FOUND"
  | "TIMESHEET_NOT_FOUND"
  | "WORK_LOG_NOT_FOUND"
  | "TIMESHEET_EDIT_LOCKED"
  | "TIMESHEET_CORRECTION_CONFLICT"
  | "TIMESHEET_DECLARATION_REQUIRED"
  | "TIMESHEET_DECLARATION_STALE"
  | "TIMESHEET_DISPUTE_NOT_ALLOWED"
  | "TIMESHEET_DISPUTE_OPEN"
  | "TIMESHEET_DISPUTE_NOT_FOUND"
  | "TIMESHEET_DISPUTE_CONFLICT";

export interface TimesheetCorrectionError extends Error {
  status: 400 | 404 | 409;
  code: TimesheetCorrectionErrorCode;
}

const timesheetSelect = {
  id: true,
  tutorId: true,
  weekStart: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewReason: true,
} as const;

const workLogSelect = {
  id: true,
  timesheetId: true,
  allocationId: true,
  workDate: true,
  hours: true,
  description: true,
} as const;

const revisionSelect = {
  id: true,
  kind: true,
  workLogId: true,
  authorProfileId: true,
  reason: true,
  previousHours: true,
  previousDescription: true,
  newHours: true,
  newDescription: true,
  createdAt: true,
} as const;

const declarationSelect = {
  id: true,
  timesheetId: true,
  statementVersion: true,
  declaredAt: true,
} as const;

const disputeSelect = {
  id: true,
  timesheetId: true,
  tutorId: true,
  reason: true,
  status: true,
  raisedByProfileId: true,
  resolvedByProfileId: true,
  resolutionReason: true,
  resolvedAt: true,
  createdAt: true,
} as const;

const disputeListSelect = {
  ...disputeSelect,
  timesheet: {
    select: {
      weekStart: true,
      tutor: { select: { fullName: true, email: true } },
    },
  },
} as const;


function correctionError(
  status: 400 | 404 | 409,
  code: TimesheetCorrectionErrorCode,
  message: string,
): TimesheetCorrectionError {
  return createRouteError(status, code, message) as TimesheetCorrectionError;
}

function tutorNotFound(): TimesheetCorrectionError {
  return correctionError(
    404,
    "TUTOR_PROFILE_NOT_FOUND",
    "No tutor profile is linked to this account.",
  );
}

function timesheetNotFound(): TimesheetCorrectionError {
  return correctionError(
    404,
    "TIMESHEET_NOT_FOUND",
    "The requested timesheet could not be found.",
  );
}

function workLogNotFound(): TimesheetCorrectionError {
  return correctionError(
    404,
    "WORK_LOG_NOT_FOUND",
    "That work log is not part of this timesheet.",
  );
}

function editLocked(): TimesheetCorrectionError {
  return correctionError(
    409,
    "TIMESHEET_EDIT_LOCKED",
    "Only a draft or returned timesheet can be changed. This one has already been submitted.",
  );
}

function correctionConflict(): TimesheetCorrectionError {
  return correctionError(
    409,
    "TIMESHEET_CORRECTION_CONFLICT",
    "The correction was refused: the timesheet changed while it was being saved, or the change breaks a weekly hours rule. Reload it and try again.",
  );
}

function isCorrectionError(value: unknown): value is TimesheetCorrectionError {
  return (
    value instanceof Error &&
    "status" in value &&
    "code" in value &&
    (value.status === 400 || value.status === 404 || value.status === 409) &&
    typeof value.code === "string"
  );
}

function prismaErrorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("code" in value)) {
    return null;
  }

  return typeof value.code === "string" ? value.code : null;
}

/**
 * A driver-adapter failure hides the PostgreSQL SQLSTATE it could not translate
 * somewhere below the Prisma code, so the nested cause is walked rather than
 * guessed from the outer code alone.
 */
function containsOriginalCode(
  value: unknown,
  expected: string,
  seen = new Set<object>(),
): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return false;
  }

  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (key === "originalCode" && nested === expected) {
      return true;
    }
    if (containsOriginalCode(nested, expected, seen)) {
      return true;
    }
  }
  return false;
}

function causedBy(
  value: unknown,
  originalCode: "23503" | "23505" | "23514",
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "meta" in value &&
    containsOriginalCode(value.meta, originalCode)
  );
}

function isUniqueViolation(value: unknown): boolean {
  return prismaErrorCode(value) === "P2002" || causedBy(value, "23505");
}

/**
 * Maps a persistence failure onto a public error. Only the failures this module
 * can prove it understands are translated; anything else is re-thrown so it is
 * reported as an unexpected server error rather than mislabelled.
 *
 * The database has the last word on editability and on the weekly hours limit,
 * so a constraint failure reaching this far means a rule refused the write. The
 * serializable transaction turns a concurrent status change into a write
 * conflict instead of a silent overwrite, which is why that code lands here too
 * rather than being retried.
 */
function mapPersistenceError(value: unknown): never {
  if (isCorrectionError(value)) {
    throw value;
  }

  const code = prismaErrorCode(value);
  if (
    code === "P2002" ||
    code === "P2003" ||
    code === "P2004" ||
    code === "P2034"
  ) {
    throw correctionConflict();
  }
  if (
    code === "P2039" &&
    (causedBy(value, "23503") ||
      causedBy(value, "23505") ||
      causedBy(value, "23514"))
  ) {
    throw correctionConflict();
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

function hoursNumber(value: DecimalValue | null): number | null {
  if (value === null) {
    return null;
  }
  const text = decimalText(value);
  const numeric = text === null ? Number.NaN : Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function toDayText(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function totalHours(workLogs: WorkLogRow[]): number {
  let hundredths = 0;
  for (const workLog of workLogs) {
    const hours = hoursNumber(workLog.hours);
    if (hours === null) {
      throw correctionError(
        409,
        "TIMESHEET_CORRECTION_CONFLICT",
        "The timesheet hours are not readable.",
      );
    }
    hundredths += Math.round(hours * 100);
  }
  return hundredths / 100;
}

function summarizeRevision(row: RevisionRow): TimesheetRevisionSummary {
  return {
    id: row.id,
    kind: row.kind,
    workLogId: row.workLogId,
    authorProfileId: row.authorProfileId,
    reason: row.reason,
    previousHours: hoursNumber(row.previousHours),
    previousDescription: row.previousDescription,
    newHours: hoursNumber(row.newHours),
    newDescription: row.newDescription,
    createdAt: row.createdAt.toISOString(),
  };
}

function summarizeDeclaration(
  row: DeclarationRow,
): TimesheetDeclarationSummary {
  return {
    id: row.id,
    timesheetId: row.timesheetId,
    statementVersion: row.statementVersion,
    declaredAt: row.declaredAt.toISOString(),
  };
}

function summarizeDispute(row: DisputeRow): TimesheetDisputeSummary {
  return {
    id: row.id,
    timesheetId: row.timesheetId,
    tutorId: row.tutorId,
    reason: row.reason,
    status: row.status,
    raisedByProfileId: row.raisedByProfileId,
    resolvedByProfileId: row.resolvedByProfileId,
    resolutionReason: row.resolutionReason,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function summarizeWorkLog(row: WorkLogRow): TutorWorkLogSummary {
  const hours = hoursNumber(row.hours);
  if (row.timesheetId === null || hours === null) {
    throw correctionConflict();
  }
  return {
    id: row.id,
    allocationId: row.allocationId,
    timesheetId: row.timesheetId,
    workDate: toDayText(row.workDate),
    hours,
    description: row.description,
  };
}

async function resolveTutor(
  client: CorrectionsTransaction,
  auth0Id: string,
): Promise<{ id: number; role: string }> {
  const profile = await client.profile.findUnique({
    where: { auth0Id },
    select: { id: true, role: true },
  });
  if (profile?.role !== "TUTOR") {
    throw tutorNotFound();
  }
  return profile;
}

async function resolveOrganiser(
  client: CorrectionsTransaction,
  auth0Id: string,
): Promise<{ id: number; role: string }> {
  const profile = await client.profile.findUnique({
    where: { auth0Id },
    select: { id: true, role: true },
  });
  if (profile?.role !== "ORGANISER") {
    throw correctionError(
      404,
      "ORGANISER_PROFILE_NOT_FOUND",
      "No organiser profile is linked to this account.",
    );
  }
  return profile;
}

async function findOwnedTimesheet(
  client: CorrectionsTransaction,
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

/**
 * The newest moment this timesheet's evidence or its review changed. A
 * declaration only covers what came before it, so anything written after a
 * declaration invalidates it.
 */
async function latestUnactionedMoment(
  client: CorrectionsTransaction,
  timesheet: TimesheetRow,
): Promise<Date | null> {
  const lastCorrection = await client.timesheetRevision.findFirst({
    where: { timesheetId: timesheet.id, kind: "CORRECTION" },
    orderBy: { createdAt: "desc" },
    select: revisionSelect,
  });
  const moments = [timesheet.reviewedAt, lastCorrection?.createdAt].filter(
    (value): value is Date => value instanceof Date,
  );
  if (moments.length === 0) {
    return null;
  }
  return moments.reduce((latest, value) => (value > latest ? value : latest));
}

export function createTimesheetCorrectionsService(
  prismaClient: TimesheetCorrectionsPrismaClient,
): TimesheetCorrectionsService {
  return {
    async history(auth0Id, timesheetId) {
      try {
        const tutor = await resolveTutor(prismaClient, auth0Id);
        const timesheet = await findOwnedTimesheet(
          prismaClient,
          tutor.id,
          timesheetId,
        );
        const [workLogs, revisions, declarations, disputes] = await Promise.all([
          prismaClient.workLog.findMany({
            where: { timesheetId: timesheet.id, tutorId: tutor.id },
            orderBy: [{ workDate: "asc" }, { id: "asc" }],
            select: workLogSelect,
          }),
          prismaClient.timesheetRevision.findMany({
            where: { timesheetId: timesheet.id },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: revisionSelect,
          }),
          prismaClient.timesheetDeclaration.findMany({
            where: { timesheetId: timesheet.id },
            orderBy: [{ declaredAt: "asc" }, { id: "asc" }],
            select: declarationSelect,
          }),
          prismaClient.timesheetDispute.findMany({
            where: { timesheetId: timesheet.id },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: disputeListSelect,
          }),
        ]);

        return {
          timesheet: {
            id: timesheet.id,
            weekStart: toDayText(timesheet.weekStart),
            status: timesheet.status,
            submittedAt: timesheet.submittedAt?.toISOString() ?? null,
            reviewedAt: timesheet.reviewedAt?.toISOString() ?? null,
            reviewReason: timesheet.reviewReason,
            totalHours: totalHours(workLogs),
            editable: decideTimesheetEdit(timesheet.status).allowed,
          },
          workLogs: workLogs.map(summarizeWorkLog),
          revisions: revisions.map(summarizeRevision),
          declarations: declarations.map(summarizeDeclaration),
          disputes: disputes.map(summarizeDispute),
          declaration: {
            statementVersion: TIMESHEET_DECLARATION_VERSION,
            statement: TIMESHEET_DECLARATION_STATEMENT,
          },
        };
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    /**
     * Called by the decision path the moment an organiser's return has been
     * committed. A resubmission clears reviewReason and reviewedAt from the
     * sheet, so without this row the reason for a return would be lost the first
     * time the tutor answers it. Re-running it for the same return is a no-op,
     * so a repeated or backfilled call cannot record the same return twice.
     */
    async recordReturn(auth0Id, timesheetId) {
      try {
        return await prismaClient.$transaction(
          async (transaction) => {
            const organiser = await resolveOrganiser(transaction, auth0Id);
            const timesheet = await transaction.timesheet.findUnique({
              where: { id: timesheetId },
              select: timesheetSelect,
            });
            if (!timesheet) {
              throw timesheetNotFound();
            }
            // An approval, or a decision still in flight, leaves nothing here to
            // record: only a return has a reason that has to survive.
            if (
              timesheet.status !== "RETURNED" ||
              timesheet.reviewedAt === null
            ) {
              return null;
            }

            const recorded = await transaction.timesheetRevision.findFirst({
              where: {
                timesheetId: timesheet.id,
                kind: "RETURN",
                createdAt: { gte: timesheet.reviewedAt },
              },
              orderBy: { createdAt: "desc" },
              select: revisionSelect,
            });
            if (recorded) {
              return summarizeRevision(recorded);
            }

            const revision = await transaction.timesheetRevision.create({
              data: {
                timesheetId: timesheet.id,
                tutorId: timesheet.tutorId,
                kind: "RETURN",
                authorProfileId: organiser.id,
                // Read back from the row rather than from the caller, so the
                // history can only ever hold the reason that was persisted.
                reason: timesheet.reviewReason,
              },
              select: revisionSelect,
            });
            return summarizeRevision(revision);
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    async correctWorkLog(auth0Id, timesheetId, workLogId, input) {
      try {
        return await prismaClient.$transaction(
          async (transaction) => {
            const tutor = await resolveTutor(transaction, auth0Id);
            const timesheet = await findOwnedTimesheet(
              transaction,
              tutor.id,
              timesheetId,
            );
            // Checked before anything is read or written, so a locked sheet can
            // never be changed even if a client calls this route directly.
            if (!decideTimesheetEdit(timesheet.status).allowed) {
              throw editLocked();
            }

            const existing = await transaction.workLog.findFirst({
              where: {
                id: workLogId,
                tutorId: tutor.id,
                timesheetId: timesheet.id,
              },
              select: workLogSelect,
            });
            if (!existing) {
              throw workLogNotFound();
            }

            const previousHours = hoursNumber(existing.hours);
            if (previousHours === null) {
              throw correctionConflict();
            }

            const changed = await transaction.workLog.updateMany({
              where: {
                id: existing.id,
                tutorId: tutor.id,
                timesheetId: timesheet.id,
              },
              data: {
                hours: input.hours,
                description: input.description,
              },
            });
            if (changed.count !== 1) {
              throw correctionConflict();
            }

            // Written in the same transaction as the change it describes, so the
            // prior values survive any later failure and can never be lost.
            const revision = await transaction.timesheetRevision.create({
              data: {
                timesheetId: timesheet.id,
                tutorId: tutor.id,
                kind: "CORRECTION",
                workLogId: existing.id,
                authorProfileId: tutor.id,
                // The return this correction answers, while it is still readable
                // on the sheet: a resubmission clears it.
                reason: timesheet.reviewReason,
                previousHours,
                previousDescription: existing.description,
                newHours: input.hours,
                newDescription: input.description,
              },
              select: revisionSelect,
            });

            return {
              workLog: {
                id: existing.id,
                allocationId: existing.allocationId,
                timesheetId: timesheet.id,
                workDate: toDayText(existing.workDate),
                hours: input.hours,
                description: input.description,
              },
              revision: summarizeRevision(revision),
            };
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    async declare(auth0Id, timesheetId, statementVersion) {
      try {
        return await prismaClient.$transaction(
          async (transaction) => {
            const tutor = await resolveTutor(transaction, auth0Id);
            const timesheet = await findOwnedTimesheet(
              transaction,
              tutor.id,
              timesheetId,
            );
            if (!decideTimesheetEdit(timesheet.status).allowed) {
              throw editLocked();
            }
            // Acknowledging wording that has since changed is not consent.
            if (!matchesVersion(TIMESHEET_DECLARATION_VERSION, statementVersion)) {
              throw correctionError(
                409,
                "TIMESHEET_DECLARATION_STALE",
                "The declaration wording has changed. Reload it and read it again.",
              );
            }

            const declaration = await transaction.timesheetDeclaration.create({
              data: {
                timesheetId: timesheet.id,
                tutorId: tutor.id,
                statementVersion,
              },
              select: declarationSelect,
            });
            return summarizeDeclaration(declaration);
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    /**
     * Called before the existing submit transition. It reports the missing
     * declaration as a public error so the tutor gets an actionable message
     * instead of a raw constraint failure; the database trigger still enforces
     * the same rule for anything that goes around this check.
     */
    async assertResubmissionReady(auth0Id, timesheetId) {
      try {
        const tutor = await resolveTutor(prismaClient, auth0Id);
        const timesheet = await findOwnedTimesheet(
          prismaClient,
          tutor.id,
          timesheetId,
        );
        if (!decideTimesheetEdit(timesheet.status).requiresDeclaration) {
          return;
        }

        const [declaration, latest] = await Promise.all([
          prismaClient.timesheetDeclaration.findFirst({
            where: { timesheetId: timesheet.id },
            orderBy: { declaredAt: "desc" },
            select: declarationSelect,
          }),
          latestUnactionedMoment(prismaClient, timesheet),
        ]);

        const covers =
          declaration !== null &&
          (latest === null || declaration.declaredAt > latest);
        if (!covers) {
          throw correctionError(
            409,
            "TIMESHEET_DECLARATION_REQUIRED",
            declaration === null
              ? "Declare that this timesheet is correct before resubmitting it."
              : "Your corrections are newer than your declaration. Declare the corrected hours before resubmitting.",
          );
        }
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    async raiseDispute(auth0Id, timesheetId, input) {
      try {
        return await prismaClient.$transaction(
          async (transaction) => {
            const tutor = await resolveTutor(transaction, auth0Id);
            const timesheet = await findOwnedTimesheet(
              transaction,
              tutor.id,
              timesheetId,
            );
            if (!canRaiseDispute(timesheet.status)) {
              throw correctionError(
                409,
                "TIMESHEET_DISPUTE_NOT_ALLOWED",
                "Submit the timesheet before disputing a decision about it.",
              );
            }

            try {
              const dispute = await transaction.timesheetDispute.create({
                data: {
                  timesheetId: timesheet.id,
                  tutorId: tutor.id,
                  reason: input.reason,
                  raisedByProfileId: tutor.id,
                },
                select: disputeSelect,
              });
              return summarizeDispute(dispute);
            } catch (error) {
              // The partial unique index allows one open dispute per timesheet.
              if (isUniqueViolation(error)) {
                throw correctionError(
                  409,
                  "TIMESHEET_DISPUTE_OPEN",
                  "This timesheet already has an open dispute waiting for an answer.",
                );
              }
              throw error;
            }
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    /**
     * The organiser queue, oldest first, so the objection that has been waiting
     * longest is at the top. Resolved disputes are deliberate history rather
     * than work in progress, and are read from the tutor's own timeline.
     */
    async listDisputes(auth0Id) {
      try {
        await resolveOrganiser(prismaClient, auth0Id);
        const disputes = await prismaClient.timesheetDispute.findMany({
          where: { status: "OPEN" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: disputeListSelect,
        });
        return disputes.map((row) => ({
          ...summarizeDispute(row),
          ...(row.timesheet ? {
            tutorName: row.timesheet.tutor.fullName,
            tutorEmail: row.timesheet.tutor.email,
            weekStart: row.timesheet.weekStart.toISOString().slice(0, 10),
          } : {}),
        }));
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    async resolveDispute(auth0Id, disputeId, input) {
      try {
        return await prismaClient.$transaction(
          async (transaction) => {
            const organiser = await resolveOrganiser(transaction, auth0Id);
            const dispute = await transaction.timesheetDispute.findFirst({
              where: { id: disputeId },
              select: disputeSelect,
            });
            if (!dispute) {
              throw correctionError(
                404,
                "TIMESHEET_DISPUTE_NOT_FOUND",
                "The requested dispute could not be found.",
              );
            }

            if (!permitsTransition(dispute.status, "OPEN", "RESOLVED", { OPEN: ["RESOLVED"] })) {
              throw correctionError(409, "TIMESHEET_DISPUTE_CONFLICT", "That dispute has already been resolved.");
            }
            const resolvedAt = new Date();
            const changed = await transaction.timesheetDispute.updateMany({
              where: { id: dispute.id, status: "OPEN" },
              data: {
                status: "RESOLVED",
                resolutionReason: input.resolutionReason,
                resolvedByProfileId: organiser.id,
                resolvedAt,
              },
            });
            if (changed.count !== 1) {
              throw correctionError(
                409,
                "TIMESHEET_DISPUTE_CONFLICT",
                "That dispute has already been resolved.",
              );
            }

            const resolved = await transaction.timesheetDispute.findFirst({
              where: { id: dispute.id },
              select: disputeSelect,
            });
            if (!resolved) {
              throw correctionError(
                409,
                "TIMESHEET_DISPUTE_CONFLICT",
                "That dispute changed before the answer could be recorded.",
              );
            }
            return summarizeDispute(resolved);
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        return mapPersistenceError(error);
      }
    },
  };
}

import { createRouteError } from "../app.js";
import { sickOccurrenceStatus } from "./session-attendance.js";
import { buildExcuseDecisionNotifications } from "./notifications.js";
import type { PrismaClient } from "../generated/prisma/client.js";

export type ExcuseWorkflowStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ExcuseWorkflowSummary {
  id: number;
  allocationId: number;
  reason: string;
  status: ExcuseWorkflowStatus;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
  occurrenceStatus: "EXCUSED" | "SKIPPED" | null;
  absenceReason: "SICK";
  reviewedAt: string | null;
  reviewedById: number | null;
}

export interface ExcuseDecisionInput {
  decision: "APPROVE" | "REJECT";
  reason?: string;
}

export interface ExcuseWorkflowService {
  getStatus(
    auth0Id: string,
    excuseId: number,
  ): Promise<ExcuseWorkflowSummary>;
  decide(
    excuseId: number,
    input: ExcuseDecisionInput,
    auth0Id: string,
  ): Promise<ExcuseWorkflowSummary>;
}

const excuseSelection = {
  id: true,
  allocationId: true,
  reason: true,
  status: true,
  reviewReason: true,
  createdAt: true,
  updatedAt: true,
  occurrenceStatus: true, absenceReason: true, reviewedAt: true, reviewedById: true,
} as const;

interface ExcuseRecord {
  id: number;
  allocationId: number;
  reason: string;
  status: ExcuseWorkflowStatus;
  reviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  occurrenceStatus?: "EXCUSED" | "SKIPPED" | null;
  absenceReason?: "SICK";
  reviewedAt?: Date | null;
  reviewedById?: number | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return isObject(error) && error.code === code;
}

function isAdapterCheckConstraintError(error: unknown): boolean {
  if (!hasPrismaCode(error, "P2039") || !isObject(error)) {
    return false;
  }

  const meta = error.meta;
  if (!isObject(meta)) {
    return false;
  }

  const driverAdapterError = meta.driverAdapterError;
  if (!isObject(driverAdapterError)) {
    return false;
  }

  const cause = driverAdapterError.cause;
  return isObject(cause) && cause.originalCode === "23514";
}

function validationError(message: string) {
  return createRouteError(400, "VALIDATION_ERROR", message);
}

function excuseNotFound() {
  return createRouteError(
    404,
    "EXCUSE_NOT_FOUND",
    "The requested excuse could not be found.",
  );
}

function decisionConflict() {
  return createRouteError(
    409,
    "EXCUSE_DECISION_CONFLICT",
    "The excuse has already been decided or changed.",
  );
}

function validateExcuseId(excuseId: number): void {
  if (!Number.isInteger(excuseId) || excuseId <= 0) {
    throw validationError("Select a valid excuse.");
  }
}

function parseDecision(input: ExcuseDecisionInput): {
  status: "APPROVED" | "REJECTED";
  reviewReason: string | null;
} {
  if (
    !isObject(input) ||
    (input.decision !== "APPROVE" && input.decision !== "REJECT")
  ) {
    throw validationError("Choose a valid excuse decision.");
  }

  let reviewReason: string | null = null;
  if (input.reason !== undefined) {
    if (typeof input.reason !== "string") {
      throw validationError("Enter a valid decision reason.");
    }
    const trimmed = input.reason.trim();
    if (!trimmed || trimmed.length > 1000) {
      throw validationError("Enter a valid decision reason.");
    }
    reviewReason = trimmed;
  }

  if (input.decision === "REJECT" && reviewReason === null) {
    throw validationError("A rejection reason is required.");
  }

  return {
    status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
    reviewReason,
  };
}

function toExcuseSummary(excuse: ExcuseRecord): ExcuseWorkflowSummary {
  return {
    id: excuse.id,
    allocationId: excuse.allocationId,
    reason: excuse.reason,
    status: excuse.status,
    reviewReason: excuse.reviewReason,
    createdAt: excuse.createdAt.toISOString(),
    updatedAt: excuse.updatedAt.toISOString(),
    occurrenceStatus: excuse.occurrenceStatus ?? null,
    absenceReason: excuse.absenceReason ?? "SICK",
    reviewedAt: excuse.reviewedAt?.toISOString() ?? null,
    reviewedById: excuse.reviewedById ?? null,
  };
}

export function createExcuseWorkflowService(
  prismaClient: PrismaClient,
  now: () => Date = () => new Date(),
): ExcuseWorkflowService {
  async function findTutorProfileId(auth0Id: string): Promise<number> {
    const profile = await prismaClient.profile.findUnique({
      where: { auth0Id },
      select: { id: true, role: true },
    });

    if (profile?.role !== "TUTOR") {
      throw createRouteError(
        404,
        "TUTOR_PROFILE_NOT_FOUND",
        "No tutor profile is linked to this account.",
      );
    }

    return profile.id;
  }

  return {
    async getStatus(auth0Id, excuseId) {
      validateExcuseId(excuseId);
      const tutorId = await findTutorProfileId(auth0Id);
      const excuse = await prismaClient.excuse.findFirst({
        where: { id: excuseId, tutorId },
        select: excuseSelection,
      });

      if (!excuse) {
        throw excuseNotFound();
      }

      return toExcuseSummary(excuse);
    },

    async decide(excuseId, input, auth0Id) {
      validateExcuseId(excuseId);
      const decision = parseDecision(input);
      // A serializable retry re-reads the committed decision, making double clicks
      // return the same result without repeating notifications or replacement work.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prismaClient.$transaction(async (transaction) => {
            const organiser = await transaction.profile.findUnique({
              where: { auth0Id }, select: { id: true, role: true },
            });
            if (organiser?.role !== "ORGANISER") {
              throw createRouteError(403, "FORBIDDEN", "Only an organiser can decide an excuse.");
            }
            const existing = await transaction.excuse.findUnique({
              where: { id: excuseId },
              select: { ...excuseSelection, tutorId: true, allocation: {
                select: { id: true, status: true, startsAt: true, endsAt: true, courseId: true, allocatedHours: true },
              } },
            });
            if (!existing) throw excuseNotFound();
            if (existing.status === decision.status) return toExcuseSummary(existing);
            if (existing.status !== "PENDING") throw decisionConflict();
            const approvedAt = now();
            const allocation = existing.allocation;
            if (decision.status === "APPROVED" && allocation.status !== "CONFIRMED") throw decisionConflict();
            const occurrenceStatus = decision.status === "APPROVED"
              ? sickOccurrenceStatus(existing.createdAt, allocation.startsAt, allocation.endsAt, approvedAt) : null;
            const update = await transaction.excuse.updateMany({
              where: { id: excuseId, status: "PENDING" },
              data: { ...decision, occurrenceStatus, reviewedAt: approvedAt, reviewedById: organiser.id },
            });
            if (update.count !== 1) throw decisionConflict();
            // Reuse the existing overflow slot, keyed by the exact allocation.
            // Retrospective absences must not create an expired replacement offer.
            if (decision.status === "APPROVED" && allocation.endsAt > approvedAt) {
              await transaction.overflowWork.upsert({
                where: { sourceAllocationId: allocation.id }, update: {},
                create: { sourceAllocationId: allocation.id, courseId: allocation.courseId,
                  startsAt: allocation.startsAt, endsAt: allocation.endsAt, hours: allocation.allocatedHours },
              });
            }
            const events = buildExcuseDecisionNotifications({ id: excuseId, ...decision }, existing.tutorId);
            await transaction.notification.createMany({
              data: events.map((event) => ({
                recipientProfileId: event.recipientProfileId, type: "EXCUSE_DECIDED" as const,
                title: event.title, body: event.body, linkPath: event.linkPath,
                targetType: event.targetType, targetId: event.targetId, eventKey: event.eventKey,
              })), skipDuplicates: true,
            });
            const updated = await transaction.excuse.findUnique({ where: { id: excuseId }, select: excuseSelection });
            if (!updated) throw decisionConflict();
            return toExcuseSummary(updated);
          }, { isolationLevel: "Serializable" });
        } catch (error) {
          if (hasPrismaCode(error, "P2034") && attempt < 2) continue;
          if (hasPrismaCode(error, "P2003") || hasPrismaCode(error, "P2004") ||
              hasPrismaCode(error, "P2034") || isAdapterCheckConstraintError(error)) throw decisionConflict();
          throw error;
        }
      }
      throw decisionConflict();
    },
  };
}

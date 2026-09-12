import { createRouteError } from "../app.js";
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
} as const;

interface ExcuseRecord {
  id: number;
  allocationId: number;
  reason: string;
  status: ExcuseWorkflowStatus;
  reviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  };
}

export function createExcuseWorkflowService(
  prismaClient: PrismaClient,
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

    async decide(excuseId, input) {
      validateExcuseId(excuseId);
      const decision = parseDecision(input);

      try {
        return await prismaClient.$transaction(
          async (transaction) => {
            const update = await transaction.excuse.updateMany({
              where: { id: excuseId, status: "PENDING" },
              data: {
                status: decision.status,
                reviewReason: decision.reviewReason,
              },
            });

            if (update.count !== 1) {
              const existing = await transaction.excuse.findUnique({
                where: { id: excuseId },
                select: { id: true, status: true },
              });
              if (!existing) {
                throw excuseNotFound();
              }
              throw decisionConflict();
            }

            const updated = await transaction.excuse.findUnique({
              where: { id: excuseId },
              select: excuseSelection,
            });
            if (!updated) {
              throw decisionConflict();
            }

            return toExcuseSummary(updated);
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (
          hasPrismaCode(error, "P2003") ||
          hasPrismaCode(error, "P2004") ||
          hasPrismaCode(error, "P2034") ||
          isAdapterCheckConstraintError(error)
        ) {
          throw decisionConflict();
        }
        throw error;
      }
    },
  };
}

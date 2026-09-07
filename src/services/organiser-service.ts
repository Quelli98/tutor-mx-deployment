import {
  createRouteError,
  type AllocationRemoveInput,
  type AllocationSummary,
  type AllocationWriteInput,
  type RouteError,
  type TimesheetDecisionInput,
  type TimesheetDecisionSummary,
  type VolunteerClaimDecisionInput,
  type VolunteerClaimDecisionSummary,
} from "../app.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import {
  allocationReasonCodesFor,
  timeRangesOverlap,
  type CandidateReasonCode,
} from "./allocation-queries.js";

type TransactionClient = Prisma.TransactionClient;

interface AllocationRow {
  id: number;
  tutorId: number;
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  allocatedHours: unknown;
  status: "PROPOSED" | "CONFIRMED" | "CANCELLED";
}

const allocationSelection = {
  id: true,
  tutorId: true,
  courseId: true,
  startsAt: true,
  endsAt: true,
  allocatedHours: true,
  status: true,
} as const;

const timesheetDecisionSelection = {
  id: true,
  tutorId: true,
  weekStart: true,
  status: true,
  reviewedAt: true,
  reviewedById: true,
  reviewReason: true,
} as const;

const volunteerClaimDecisionSelection = {
  id: true,
  overflowWorkId: true,
  studentId: true,
  status: true,
  reviewReason: true,
} as const;

const ruleMessages: Record<CandidateReasonCode, string> = {
  "insufficient-mark":
    "The tutor does not meet the allocation mark requirement.",
  "schedule-clash": "The tutor has a timetable clash for this allocation.",
  "hour-limit-exceeded":
    "The allocation would exceed the tutor's weekly-hour limit.",
};

function isPrismaErrorCode(value: unknown, ...codes: string[]) {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    codes.includes(String((value as { code?: unknown }).code))
  );
}

function isPostgresCheckViolation(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("code" in value) ||
    value.code !== "P2039" ||
    !("meta" in value) ||
    typeof value.meta !== "object" ||
    value.meta === null ||
    !("driverAdapterError" in value.meta)
  ) {
    return false;
  }

  const driverAdapterError = value.meta.driverAdapterError;
  return (
    typeof driverAdapterError === "object" &&
    driverAdapterError !== null &&
    "cause" in driverAdapterError &&
    typeof driverAdapterError.cause === "object" &&
    driverAdapterError.cause !== null &&
    "originalCode" in driverAdapterError.cause &&
    driverAdapterError.cause.originalCode === "23514"
  );
}

function isRouteError(value: unknown): value is RouteError {
  return (
    value instanceof Error &&
    "status" in value &&
    "code" in value &&
    typeof (value as RouteError).status === "number" &&
    typeof (value as RouteError).code === "string"
  );
}

function mondayUtcFor(value: Date) {
  const monday = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday;
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toAllocationSummary(row: AllocationRow): AllocationSummary {
  return {
    id: row.id,
    tutorId: row.tutorId,
    courseId: row.courseId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    allocatedHours: Number(row.allocatedHours),
    status: row.status,
  };
}

function throwFirstAllocationRuleViolation(
  reasonCodes: CandidateReasonCode[],
): void {
  const reasonCode = reasonCodes[0];
  if (reasonCode) {
    throw createRouteError(409, reasonCode, ruleMessages[reasonCode]);
  }
}

async function validateAllocationRules(
  transaction: TransactionClient,
  input: AllocationWriteInput,
  excludeAllocationId?: number,
) {
  const tutor = await transaction.profile.findUnique({
    where: { id: input.tutorId },
    select: { role: true },
  });
  if (tutor?.role !== "TUTOR") {
    throw createRouteError(
      404,
      "TUTOR_NOT_FOUND",
      "The requested tutor could not be found.",
    );
  }

  const course = await transaction.course.findUnique({
    where: { id: input.courseId },
    select: { id: true },
  });
  if (!course) {
    throw createRouteError(
      404,
      "COURSE_NOT_FOUND",
      "The requested course could not be found.",
    );
  }

  const weekStart = mondayUtcFor(input.startsAt);
  const nextWeekStart = addUtcDays(weekStart, 7);
  const withoutCurrentAllocation =
    excludeAllocationId === undefined
      ? {}
      : { id: { not: excludeAllocationId } };

  const [mark, hourLimit, busySlots, confirmedAllocations, usedHours] =
    await Promise.all([
      transaction.tutorMark.findUnique({
        where: {
          tutorId_courseId: {
            tutorId: input.tutorId,
            courseId: input.courseId,
          },
        },
        select: { mark: true },
      }),
      transaction.tutorHourLimit.findUnique({
        where: { tutorId: input.tutorId },
        select: { weeklyHours: true },
      }),
      transaction.timeSlot.findMany({
        where: {
          tutorId: input.tutorId,
          type: "BUSY",
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
        },
        select: { startsAt: true, endsAt: true },
      }),
      transaction.allocation.findMany({
        where: {
          tutorId: input.tutorId,
          status: "CONFIRMED",
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
          ...withoutCurrentAllocation,
        },
        select: { startsAt: true, endsAt: true },
      }),
      transaction.allocation.aggregate({
        where: {
          tutorId: input.tutorId,
          status: "CONFIRMED",
          startsAt: { gte: weekStart, lt: nextWeekStart },
          ...withoutCurrentAllocation,
        },
        _sum: { allocatedHours: true },
      }),
    ]);

  const hasClash = [...busySlots, ...confirmedAllocations].some(
    (range) =>
      timeRangesOverlap(
        input.startsAt,
        input.endsAt,
        range.startsAt,
        range.endsAt,
      ) !== false,
  );
  const weeklyLimit =
    hourLimit?.weeklyHours === undefined
      ? null
      : new Prisma.Decimal(hourLimit.weeklyHours);
  const used = new Prisma.Decimal(usedHours._sum.allocatedHours ?? 0);
  const remainingHours =
    weeklyLimit === null
      ? null
      : Prisma.Decimal.max(weeklyLimit.minus(used), 0).toNumber();

  throwFirstAllocationRuleViolation(
    allocationReasonCodesFor({
      mark: mark?.mark === undefined ? null : Number(mark.mark),
      minimumMark: input.minimumMark,
      hasClash,
      remainingHours,
      requestedHours: input.requestedHours,
    }),
  );
}

function mapAllocationFailure(value: unknown): never {
  if (isRouteError(value)) {
    throw value;
  }
  if (
    isPrismaErrorCode(value, "P2002", "P2003", "P2004", "P2034") ||
    isPostgresCheckViolation(value)
  ) {
    throw createRouteError(
      409,
      "ALLOCATION_CONFLICT",
      "The allocation conflicts with current tutor, course or workflow data.",
    );
  }
  throw value;
}

function mapDecisionFailure(
  value: unknown,
  code: "TIMESHEET_DECISION_CONFLICT" | "VOLUNTEER_CLAIM_DECISION_CONFLICT",
  message: string,
): never {
  if (isRouteError(value)) {
    throw value;
  }
  if (
    isPrismaErrorCode(value, "P2002", "P2003", "P2004", "P2034") ||
    isPostgresCheckViolation(value)
  ) {
    throw createRouteError(409, code, message);
  }
  throw value;
}

export function createOrganiserService(client: PrismaClient) {
  return {
    async createAllocation(
      input: AllocationWriteInput,
    ): Promise<AllocationSummary> {
      try {
        return await client.$transaction(
          async (transaction) => {
            await validateAllocationRules(transaction, input);
            let allocation = await transaction.allocation.create({
              data: {
                tutorId: input.tutorId,
                courseId: input.courseId,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                allocatedHours: input.requestedHours,
              },
              select: allocationSelection,
            });

            if (input.status === "CONFIRMED") {
              allocation = await transaction.allocation.update({
                where: { id: allocation.id },
                data: { status: "CONFIRMED" },
                select: allocationSelection,
              });
            }

            return toAllocationSummary(allocation);
          },
          { isolationLevel: "Serializable" },
        );
      } catch (value) {
        return mapAllocationFailure(value);
      }
    },

    async updateAllocation(
      allocationId: number,
      input: AllocationWriteInput,
    ): Promise<AllocationSummary> {
      try {
        return await client.$transaction(
          async (transaction) => {
            const current = await transaction.allocation.findUnique({
              where: { id: allocationId },
              select: { id: true, status: true },
            });
            if (!current) {
              throw createRouteError(
                404,
                "ALLOCATION_NOT_FOUND",
                "The requested allocation could not be found.",
              );
            }

            const nextStatus = input.status ?? current.status;
            if (
              current.status === "CANCELLED" ||
              (current.status === "CONFIRMED" && nextStatus !== "CONFIRMED")
            ) {
              throw createRouteError(
                409,
                "ALLOCATION_CONFLICT",
                "The allocation can no longer be edited in its current state.",
              );
            }

            await validateAllocationRules(transaction, input, allocationId);
            const changed = await transaction.allocation.updateMany({
              where: { id: allocationId, status: current.status },
              data: {
                tutorId: input.tutorId,
                courseId: input.courseId,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                allocatedHours: input.requestedHours,
                status: nextStatus,
              },
            });
            if (changed.count !== 1) {
              throw createRouteError(
                409,
                "ALLOCATION_CONFLICT",
                "The allocation changed before this update could be applied.",
              );
            }

            const updated = await transaction.allocation.findUnique({
              where: { id: allocationId },
              select: allocationSelection,
            });
            if (!updated) {
              throw createRouteError(
                409,
                "ALLOCATION_CONFLICT",
                "The allocation changed before this update could be applied.",
              );
            }
            return toAllocationSummary(updated);
          },
          { isolationLevel: "Serializable" },
        );
      } catch (value) {
        return mapAllocationFailure(value);
      }
    },

    async removeAllocation(
      allocationId: number,
      input: AllocationRemoveInput,
    ): Promise<void> {
      try {
        await client.$transaction(
          async (transaction) => {
            const current = await transaction.allocation.findUnique({
              where: { id: allocationId },
              select: allocationSelection,
            });
            if (!current) {
              throw createRouteError(
                404,
                "ALLOCATION_NOT_FOUND",
                "The requested allocation could not be found.",
              );
            }
            if (current.status === "CANCELLED") {
              throw createRouteError(
                409,
                "ALLOCATION_CONFLICT",
                "The allocation has already been removed.",
              );
            }

            await validateAllocationRules(
              transaction,
              {
                tutorId: current.tutorId,
                courseId: current.courseId,
                startsAt: current.startsAt,
                endsAt: current.endsAt,
                requestedHours: Number(current.allocatedHours),
                minimumMark: input.minimumMark,
                status: current.status,
              },
              allocationId,
            );
            const changed = await transaction.allocation.updateMany({
              where: { id: allocationId, status: current.status },
              data: { status: "CANCELLED" },
            });
            if (changed.count !== 1) {
              throw createRouteError(
                409,
                "ALLOCATION_CONFLICT",
                "The allocation changed before it could be removed.",
              );
            }
          },
          { isolationLevel: "Serializable" },
        );
      } catch (value) {
        mapAllocationFailure(value);
      }
    },

    async decideTimesheet(
      organiserAuth0Id: string,
      timesheetId: number,
      input: TimesheetDecisionInput,
    ): Promise<TimesheetDecisionSummary> {
      try {
        return await client.$transaction(
          async (transaction) => {
            const organiser = await transaction.profile.findUnique({
              where: { auth0Id: organiserAuth0Id },
              select: { id: true, role: true },
            });
            if (organiser?.role !== "ORGANISER") {
              throw createRouteError(
                404,
                "ORGANISER_PROFILE_NOT_FOUND",
                "No organiser profile is linked to this account.",
              );
            }

            const current = await transaction.timesheet.findUnique({
              where: { id: timesheetId },
              select: { status: true },
            });
            if (!current) {
              throw createRouteError(
                404,
                "TIMESHEET_NOT_FOUND",
                "The requested timesheet could not be found.",
              );
            }
            if (current.status !== "SUBMITTED") {
              throw createRouteError(
                409,
                "TIMESHEET_DECISION_CONFLICT",
                "Only a submitted timesheet can receive this decision.",
              );
            }

            const reviewedAt = new Date();
            const status =
              input.decision === "APPROVE" ? "APPROVED" : "RETURNED";
            const changed = await transaction.timesheet.updateMany({
              where: { id: timesheetId, status: "SUBMITTED" },
              data: {
                status,
                reviewedAt,
                reviewedById: organiser.id,
                reviewReason: input.reason ?? null,
              },
            });
            if (changed.count !== 1) {
              throw createRouteError(
                409,
                "TIMESHEET_DECISION_CONFLICT",
                "The timesheet changed before this decision could be applied.",
              );
            }

            const decided = await transaction.timesheet.findUnique({
              where: { id: timesheetId },
              select: timesheetDecisionSelection,
            });
            if (!decided) {
              throw createRouteError(
                409,
                "TIMESHEET_DECISION_CONFLICT",
                "The timesheet changed before this decision could be applied.",
              );
            }

            return {
              id: decided.id,
              tutorId: decided.tutorId,
              weekStart: decided.weekStart.toISOString().slice(0, 10),
              status:
                decided.status === "APPROVED" ? "APPROVED" : "RETURNED",
              reviewedAt: decided.reviewedAt!.toISOString(),
              reviewedById: decided.reviewedById!,
              reviewReason: decided.reviewReason,
            };
          },
          { isolationLevel: "Serializable" },
        );
      } catch (value) {
        return mapDecisionFailure(
          value,
          "TIMESHEET_DECISION_CONFLICT",
          "The timesheet decision conflicts with its current workflow state.",
        );
      }
    },

    async decideVolunteerClaim(
      claimId: number,
      input: VolunteerClaimDecisionInput,
    ): Promise<VolunteerClaimDecisionSummary> {
      try {
        return await client.$transaction(
          async (transaction) => {
            const current = await transaction.volunteerClaim.findUnique({
              where: { id: claimId },
              select: {
                status: true,
                overflowWork: {
                  select: { status: true, startsAt: true, closesAt: true },
                },
              },
            });
            if (!current) {
              throw createRouteError(
                404,
                "VOLUNTEER_CLAIM_NOT_FOUND",
                "The requested volunteer claim could not be found.",
              );
            }
            if (current.status !== "PENDING") {
              throw createRouteError(
                409,
                "VOLUNTEER_CLAIM_DECISION_CONFLICT",
                "Only a pending volunteer claim can receive this decision.",
              );
            }

            const decidedAt = new Date();
            if (
              input.decision === "APPROVE" &&
              (current.overflowWork.status !== "OPEN" ||
                current.overflowWork.startsAt <= decidedAt ||
                (current.overflowWork.closesAt !== null &&
                  current.overflowWork.closesAt <= decidedAt))
            ) {
              throw createRouteError(
                409,
                "VOLUNTEER_CLAIM_DECISION_CONFLICT",
                "The volunteer claim's work item is no longer open for approval.",
              );
            }

            const status =
              input.decision === "APPROVE" ? "ACCEPTED" : "REJECTED";
            const changed = await transaction.volunteerClaim.updateMany({
              where: { id: claimId, status: "PENDING" },
              data: {
                status,
                reviewReason: input.reason ?? null,
              },
            });
            if (changed.count !== 1) {
              throw createRouteError(
                409,
                "VOLUNTEER_CLAIM_DECISION_CONFLICT",
                "The volunteer claim changed before this decision could be applied.",
              );
            }

            const decided = await transaction.volunteerClaim.findUnique({
              where: { id: claimId },
              select: volunteerClaimDecisionSelection,
            });
            if (!decided) {
              throw createRouteError(
                409,
                "VOLUNTEER_CLAIM_DECISION_CONFLICT",
                "The volunteer claim changed before this decision could be applied.",
              );
            }

            return {
              id: decided.id,
              overflowWorkId: decided.overflowWorkId,
              studentId: decided.studentId,
              status:
                decided.status === "ACCEPTED" ? "ACCEPTED" : "REJECTED",
              reviewReason: decided.reviewReason,
            };
          },
          { isolationLevel: "Serializable" },
        );
      } catch (value) {
        return mapDecisionFailure(
          value,
          "VOLUNTEER_CLAIM_DECISION_CONFLICT",
          "The volunteer-claim decision conflicts with its current workflow state.",
        );
      }
    },
  };
}

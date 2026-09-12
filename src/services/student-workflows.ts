import { createRouteError } from "../app.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  listOpenWork as queryOpenWork,
  type QueryClient,
} from "./allocation-queries.js";

export type VolunteerRequestStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN";

export interface StudentOpenWorkSummary {
  id: number;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  status: "OPEN";
  closesAt: string | null;
}

export interface VolunteerRequestWriteInput {
  overflowWorkId: number;
}

export interface VolunteerRequestSummary {
  id: number;
  overflowWorkId: number;
  status: VolunteerRequestStatus;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentWorkflowService {
  listOpenWork(auth0Id: string): Promise<StudentOpenWorkSummary[]>;
  createVolunteerRequest(
    auth0Id: string,
    input: VolunteerRequestWriteInput,
  ): Promise<VolunteerRequestSummary>;
  getVolunteerRequest(
    auth0Id: string,
    requestId: number,
  ): Promise<VolunteerRequestSummary>;
  withdrawVolunteerRequest(
    auth0Id: string,
    requestId: number,
  ): Promise<VolunteerRequestSummary>;
}

const volunteerRequestSelection = {
  id: true,
  overflowWorkId: true,
  status: true,
  reviewReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface VolunteerRequestRecord {
  id: number;
  overflowWorkId: number;
  status: VolunteerRequestStatus;
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

function toVolunteerRequestSummary(
  request: VolunteerRequestRecord,
): VolunteerRequestSummary {
  return {
    id: request.id,
    overflowWorkId: request.overflowWorkId,
    status: request.status,
    reviewReason: request.reviewReason,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

function isAvailableOpenWork(
  work: { status: string; startsAt: Date; closesAt: Date | null },
  now: Date,
): boolean {
  return (
    work.status === "OPEN" &&
    Number.isFinite(work.startsAt.valueOf()) &&
    work.startsAt > now &&
    (work.closesAt === null ||
      (Number.isFinite(work.closesAt.valueOf()) && work.closesAt > now))
  );
}

export function createStudentWorkflowService(
  prismaClient: PrismaClient,
  queryClient: QueryClient,
): StudentWorkflowService {
  async function findStudentProfileId(auth0Id: string): Promise<number> {
    const profile = await prismaClient.profile.findUnique({
      where: { auth0Id },
      select: { id: true, role: true },
    });

    if (profile?.role !== "STUDENT") {
      throw createRouteError(
        404,
        "STUDENT_PROFILE_NOT_FOUND",
        "No student profile is linked to this account.",
      );
    }

    return profile.id;
  }

  function volunteerRequestConflict() {
    return createRouteError(
      409,
      "VOLUNTEER_REQUEST_CONFLICT",
      "The volunteer request conflicts with the current work or request state.",
    );
  }

  return {
    async listOpenWork(auth0Id) {
      const studentId = await findStudentProfileId(auth0Id);
      const openWork = await queryOpenWork(queryClient);

      if (openWork.length === 0) {
        return [];
      }

      const existingRequests = await prismaClient.volunteerClaim.findMany({
        where: {
          studentId,
          overflowWorkId: { in: openWork.map((work) => work.id) },
        },
        select: { overflowWorkId: true },
      });
      const requestedWorkIds = new Set(
        existingRequests.map((request) => request.overflowWorkId),
      );

      return openWork
        .filter((work) => !requestedWorkIds.has(work.id))
        .map((work) => ({
          ...work,
          startsAt: work.startsAt.toISOString(),
          endsAt: work.endsAt.toISOString(),
          closesAt: work.closesAt?.toISOString() ?? null,
        }));
    },

    async createVolunteerRequest(auth0Id, input) {
      const studentId = await findStudentProfileId(auth0Id);

      try {
        const request = await prismaClient.$transaction(
          async (transaction) => {
            const work = await transaction.overflowWork.findUnique({
              where: { id: input.overflowWorkId },
              select: {
                id: true,
                status: true,
                startsAt: true,
                closesAt: true,
              },
            });

            if (!work) {
              throw createRouteError(
                404,
                "OPEN_WORK_NOT_FOUND",
                "The requested open work item could not be found.",
              );
            }

            if (!isAvailableOpenWork(work, new Date())) {
              throw createRouteError(
                409,
                "OPEN_WORK_UNAVAILABLE",
                "The requested work item is no longer available.",
              );
            }

            return transaction.volunteerClaim.create({
              data: {
                overflowWorkId: work.id,
                studentId,
              },
              select: volunteerRequestSelection,
            });
          },
          { isolationLevel: "Serializable" },
        );

        return toVolunteerRequestSummary(request);
      } catch (error) {
        if (hasPrismaCode(error, "P2002")) {
          throw createRouteError(
            409,
            "VOLUNTEER_REQUEST_DUPLICATE",
            "A volunteer request has already been submitted for this work item.",
          );
        }
        if (
          hasPrismaCode(error, "P2003") ||
          hasPrismaCode(error, "P2004") ||
          hasPrismaCode(error, "P2034") ||
          isAdapterCheckConstraintError(error)
        ) {
          throw volunteerRequestConflict();
        }
        throw error;
      }
    },

    async getVolunteerRequest(auth0Id, requestId) {
      const studentId = await findStudentProfileId(auth0Id);
      const request = await prismaClient.volunteerClaim.findFirst({
        where: { id: requestId, studentId },
        select: volunteerRequestSelection,
      });

      if (!request) {
        throw createRouteError(
          404,
          "VOLUNTEER_REQUEST_NOT_FOUND",
          "The volunteer request could not be found.",
        );
      }

      return toVolunteerRequestSummary(request);
    },

    async withdrawVolunteerRequest(auth0Id, requestId) {
      const studentId = await findStudentProfileId(auth0Id);
      const request = await prismaClient.volunteerClaim.findFirst({
        where: { id: requestId, studentId },
        select: volunteerRequestSelection,
      });

      if (!request) {
        throw createRouteError(
          404,
          "VOLUNTEER_REQUEST_NOT_FOUND",
          "The volunteer request could not be found.",
        );
      }
      if (request.status !== "PENDING") {
        throw volunteerRequestConflict();
      }

      try {
        const update = await prismaClient.volunteerClaim.updateMany({
          where: { id: requestId, studentId, status: "PENDING" },
          data: { status: "WITHDRAWN" },
        });
        if (update.count !== 1) {
          throw volunteerRequestConflict();
        }

        const withdrawn = await prismaClient.volunteerClaim.findFirst({
          where: { id: requestId, studentId },
          select: volunteerRequestSelection,
        });
        if (!withdrawn) {
          throw volunteerRequestConflict();
        }

        return toVolunteerRequestSummary(withdrawn);
      } catch (error) {
        if (
          hasPrismaCode(error, "P2002") ||
          hasPrismaCode(error, "P2003") ||
          hasPrismaCode(error, "P2004") ||
          hasPrismaCode(error, "P2034") ||
          isAdapterCheckConstraintError(error)
        ) {
          throw volunteerRequestConflict();
        }
        throw error;
      }
    },
  };
}

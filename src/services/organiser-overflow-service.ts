import {
  createRouteError,
  type OrganiserOverflowWorkCloseInput,
  type OrganiserOverflowWorkCreateInput,
  type OrganiserOverflowWorkSummary,
  type OrganiserOverflowWorkUpdateInput,
  type OverflowWorkStatus,
} from "../app.js";
import { type PrismaClient } from "../generated/prisma/client.js";
import {
  getAssignedHoursForRequirements,
  type QueryClient,
} from "./allocation-queries.js";
import {
  requiredHoursFor,
  windowHoursFor,
} from "./staffing-requirement-service.js";

export interface OrganiserOverflowWorkService {
  /**
   * Overflow work as the organiser manages it: posted by hand or converted
   * from an unmet staffing requirement, edited while it is still open, and
   * closed with an explicit status. Student claims are counted here so the
   * screen can show what waits on a decision.
   */
  listOverflowWork(): Promise<OrganiserOverflowWorkSummary[]>;
  createOverflowWork(
    input: OrganiserOverflowWorkCreateInput,
  ): Promise<OrganiserOverflowWorkSummary>;
  updateOverflowWork(
    overflowWorkId: number,
    input: OrganiserOverflowWorkUpdateInput,
  ): Promise<OrganiserOverflowWorkSummary>;
  closeOverflowWork(
    overflowWorkId: number,
    input: OrganiserOverflowWorkCloseInput,
  ): Promise<OrganiserOverflowWorkSummary>;
}

const overflowWorkInclude = {
  course: { select: { code: true, name: true } },
  volunteerClaims: { select: { status: true } },
} as const;

interface OverflowWorkRow {
  id: number;
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  hours: unknown;
  status: OverflowWorkStatus;
  closesAt: Date | null;
  sourceRequirementId: number | null;
  createdAt: Date;
  updatedAt: Date;
  course: { code: string; name: string };
  volunteerClaims: { status: string }[];
}

/**
 * Hours are carried to two decimals throughout, so a gap smaller than that is
 * rounding noise rather than real unfilled work - the same tolerance the
 * staffing board reads shortages with.
 */
const HOURS_TOLERANCE = 0.01;

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function claimCounts(claims: { status: string }[]) {
  let pendingClaims = 0;
  let acceptedClaims = 0;
  for (const claim of claims) {
    if (claim.status === "PENDING") pendingClaims += 1;
    if (claim.status === "ACCEPTED") acceptedClaims += 1;
  }
  return { pendingClaims, acceptedClaims };
}

function toOverflowWorkSummary(
  row: OverflowWorkRow,
): OrganiserOverflowWorkSummary {
  const { pendingClaims, acceptedClaims } = claimCounts(row.volunteerClaims);
  return {
    id: row.id,
    courseId: row.courseId,
    courseCode: row.course.code,
    courseName: row.course.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    hours: Number(row.hours),
    windowHours: windowHoursFor(row.startsAt, row.endsAt),
    status: row.status,
    closesAt: row.closesAt ? row.closesAt.toISOString() : null,
    sourceRequirementId: row.sourceRequirementId,
    pendingClaims,
    acceptedClaims,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value as { code?: unknown }).code === "P2002"
  );
}

export function createOrganiserOverflowWorkService(
  client: PrismaClient,
  queryClient: QueryClient,
): OrganiserOverflowWorkService {
  return {
    /**
     * Every overflow item, whatever its status, because the organiser screen is
     * where all of them are managed - including the closed ones. The student
     * read filters this same table down to OPEN work that has not started.
     */
    async listOverflowWork() {
      const rows = await client.overflowWork.findMany({
        include: overflowWorkInclude,
        orderBy: { startsAt: "asc" },
      });
      return rows.map(toOverflowWorkSummary);
    },

    /**
     * Posting overflow. When a source requirement is given the item must be an
     * exact conversion of it: same course, same window, and no more hours than
     * are still unfilled. The link is stored, never derived, so the trace
     * survives later edits to either side and cannot be invented by a client.
     */
    async createOverflowWork(input) {
      try {
        return await client.$transaction(
          async (transaction) => {
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

            if (input.sourceRequirementId !== null) {
              const requirement =
                await transaction.staffingRequirement.findUnique({
                  where: { id: input.sourceRequirementId },
                  select: {
                    id: true,
                    courseId: true,
                    startsAt: true,
                    endsAt: true,
                    tutorsNeeded: true,
                    status: true,
                  },
                });
              if (!requirement) {
                throw createRouteError(
                  404,
                  "STAFFING_REQUIREMENT_NOT_FOUND",
                  "The staffing requirement could not be found.",
                );
              }
              if (requirement.status !== "OPEN") {
                throw createRouteError(
                  409,
                  "OVERFLOW_SOURCE_NOT_OPEN",
                  "That staffing requirement is no longer open, so it cannot be sent to overflow.",
                );
              }
              if (
                requirement.courseId !== input.courseId ||
                requirement.startsAt.valueOf() !== input.startsAt.valueOf() ||
                requirement.endsAt.valueOf() !== input.endsAt.valueOf()
              ) {
                throw createRouteError(
                  409,
                  "OVERFLOW_SOURCE_MISMATCH",
                  "Overflow work converted from a requirement must keep its course and time window.",
                );
              }

              // The shortage is the same read-time figure the staffing board
              // shows: required tutor-hours minus the confirmed hours that
              // overlap the window. Nothing is assigned by converting.
              const assignedHours =
                (
                  await getAssignedHoursForRequirements(queryClient, [
                    requirement.id,
                  ])
                ).get(requirement.id) ?? 0;
              const shortageHours = roundHours(
                Math.max(
                  0,
                  requiredHoursFor(
                    requirement.startsAt,
                    requirement.endsAt,
                    requirement.tutorsNeeded,
                  ) - assignedHours,
                ),
              );
              if (shortageHours <= HOURS_TOLERANCE) {
                throw createRouteError(
                  409,
                  "OVERFLOW_SOURCE_FILLED",
                  "That staffing requirement is already covered, so it has nothing left to send to overflow.",
                );
              }
              if (input.hours > shortageHours + HOURS_TOLERANCE) {
                throw createRouteError(
                  409,
                  "OVERFLOW_SOURCE_HOURS",
                  `Only ${shortageHours} hours of that staffing requirement are still unfilled.`,
                );
              }
            }

            const created = await transaction.overflowWork.create({
              data: {
                courseId: input.courseId,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                hours: input.hours,
                closesAt: input.closesAt,
                sourceRequirementId: input.sourceRequirementId,
              },
              include: overflowWorkInclude,
            });
            return toOverflowWorkSummary(created);
          },
          { isolationLevel: "Serializable" },
        );
      } catch (value) {
        // Two organisers converting the same requirement at once both pass the
        // checks above; the unique index lets exactly one through.
        if (isUniqueViolation(value)) {
          throw createRouteError(
            409,
            "OVERFLOW_SOURCE_ALREADY_SENT",
            "That staffing requirement already has an overflow item.",
          );
        }
        throw value;
      }
    },

    /**
     * Editing keeps the item correct, but only while it is still open and no
     * student has a live claim on it. The compare-and-set on updatedAt is what
     * refuses a stale edit: the write only lands on the version the organiser
     * was shown, so a second session that saved in between loses this one
     * instead of silently overwriting it.
     */
    async updateOverflowWork(overflowWorkId, input) {
      return client.$transaction(
        async (transaction) => {
          const current = await transaction.overflowWork.findUnique({
            where: { id: overflowWorkId },
            include: overflowWorkInclude,
          });
          if (!current) {
            throw createRouteError(
              404,
              "OVERFLOW_WORK_NOT_FOUND",
              "The requested overflow work could not be found.",
            );
          }
          if (current.status !== "OPEN") {
            throw createRouteError(
              409,
              "OVERFLOW_WORK_CONFLICT",
              "Only open overflow work can be edited.",
            );
          }

          const { pendingClaims, acceptedClaims } = claimCounts(
            current.volunteerClaims,
          );
          if (pendingClaims + acceptedClaims > 0) {
            throw createRouteError(
              409,
              "OVERFLOW_WORK_HAS_CLAIMS",
              "This overflow work already has student claims, so its details are fixed.",
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

          const changed = await transaction.overflowWork.updateMany({
            where: { id: overflowWorkId, updatedAt: input.expectedUpdatedAt },
            data: {
              courseId: input.courseId,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              hours: input.hours,
              closesAt: input.closesAt,
              updatedAt: new Date(),
            },
          });
          if (changed.count !== 1) {
            throw createRouteError(
              409,
              "OVERFLOW_WORK_STALE",
              "This overflow work changed in another session. Reload it and try again.",
            );
          }

          const updated = await transaction.overflowWork.findUnique({
            where: { id: overflowWorkId },
            include: overflowWorkInclude,
          });
          if (!updated) {
            throw createRouteError(
              409,
              "OVERFLOW_WORK_STALE",
              "This overflow work changed in another session. Reload it and try again.",
            );
          }
          return toOverflowWorkSummary(updated);
        },
        { isolationLevel: "Serializable" },
      );
    },

    /**
     * Closing is the explicit end state: an OPEN item becomes CLOSED and drops
     * out of the student open-work read. Pending claims are refused first, so
     * no student is left holding a claim whose approval could never succeed.
     * FILLED is terminal: once a student is accepted, the work cannot be closed.
     */
    async closeOverflowWork(overflowWorkId, input) {
      return client.$transaction(
        async (transaction) => {
          const current = await transaction.overflowWork.findUnique({
            where: { id: overflowWorkId },
            include: overflowWorkInclude,
          });
          if (!current) {
            throw createRouteError(
              404,
              "OVERFLOW_WORK_NOT_FOUND",
              "The requested overflow work could not be found.",
            );
          }
          if (current.status !== "OPEN") {
            throw createRouteError(
              409,
              "OVERFLOW_WORK_CONFLICT",
              current.status === "FILLED"
                ? "This overflow work has an accepted student and cannot be closed."
                : "This overflow work is already closed.",
            );
          }

          const { pendingClaims } = claimCounts(current.volunteerClaims);
          if (pendingClaims > 0) {
            throw createRouteError(
              409,
              "OVERFLOW_WORK_HAS_CLAIMS",
              "Decide the pending student claims before closing this overflow work.",
            );
          }

          const changed = await transaction.overflowWork.updateMany({
            where: { id: overflowWorkId, updatedAt: input.expectedUpdatedAt },
            data: { status: "CLOSED", updatedAt: new Date() },
          });
          if (changed.count !== 1) {
            throw createRouteError(
              409,
              "OVERFLOW_WORK_STALE",
              "This overflow work changed in another session. Reload it and try again.",
            );
          }

          const updated = await transaction.overflowWork.findUnique({
            where: { id: overflowWorkId },
            include: overflowWorkInclude,
          });
          if (!updated) {
            throw createRouteError(
              409,
              "OVERFLOW_WORK_STALE",
              "This overflow work changed in another session. Reload it and try again.",
            );
          }
          return toOverflowWorkSummary(updated);
        },
        { isolationLevel: "Serializable" },
      );
    },
  };
}

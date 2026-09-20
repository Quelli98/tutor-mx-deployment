import {
  createRouteError,
  type StaffingRequirementListQuery,
  type StaffingRequirementStatus,
  type StaffingRequirementSummary,
  type StaffingRequirementWriteInput,
} from "../app.js";
import { type PrismaClient } from "../generated/prisma/client.js";

export interface StaffingRequirementService {
  /**
   * Recorded demand: which course needs cover, over which window, and how many
   * tutors are wanted on it. Required tutor-hours are derived from the window and
   * that count, never stored. Nothing here allocates work, and the fill level is
   * never stored either - a shortage is calculated at read time from confirmed
   * allocations.
   */
  listStaffingRequirements(
    query: StaffingRequirementListQuery,
  ): Promise<StaffingRequirementSummary[]>;
  createStaffingRequirement(
    organiserAuth0Id: string,
    input: StaffingRequirementWriteInput,
  ): Promise<StaffingRequirementSummary>;
  updateStaffingRequirement(
    requirementId: number,
    input: StaffingRequirementWriteInput,
  ): Promise<StaffingRequirementSummary>;
  setStaffingRequirementStatus(
    requirementId: number,
    status: StaffingRequirementStatus,
  ): Promise<StaffingRequirementSummary>;
}

const requirementSelection = {
  id: true,
  courseId: true,
  startsAt: true,
  endsAt: true,
  tutorsNeeded: true,
  status: true,
  notes: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { code: true, name: true } },
} as const;

interface RequirementRow {
  id: number;
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  tutorsNeeded: number;
  status: StaffingRequirementStatus;
  notes: string | null;
  createdById: number | null;
  createdAt: Date;
  updatedAt: Date;
  course: { code: string; name: string };
}

/** Hours the window covers, rounded like every other stored hour figure. */
export function windowHoursFor(startsAt: Date, endsAt: Date): number {
  return (
    Math.round(((endsAt.valueOf() - startsAt.valueOf()) / 3_600_000) * 100) / 100
  );
}

/**
 * The single definition of required tutor-hours: how long the work runs,
 * multiplied by how many tutors are wanted on it. It is never stored, so it
 * cannot drift from the window, and nothing outside this file recalculates it.
 */
export function requiredHoursFor(
  startsAt: Date,
  endsAt: Date,
  tutorsNeeded: number,
): number {
  return Math.round(windowHoursFor(startsAt, endsAt) * tutorsNeeded * 100) / 100;
}

function toStaffingRequirementSummary(
  row: RequirementRow,
): StaffingRequirementSummary {
  return {
    id: row.id,
    courseId: row.courseId,
    courseCode: row.course.code,
    courseName: row.course.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    tutorsNeeded: row.tutorsNeeded,
    windowHours: windowHoursFor(row.startsAt, row.endsAt),
    requiredHours: requiredHoursFor(
      row.startsAt,
      row.endsAt,
      row.tutorsNeeded,
    ),
    status: row.status,
    notes: row.notes,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function requirementNotFound(): never {
  throw createRouteError(
    404,
    "STAFFING_REQUIREMENT_NOT_FOUND",
    "The requested staffing requirement could not be found.",
  );
}

export function createStaffingRequirementService(
  client: PrismaClient,
): StaffingRequirementService {
  /**
   * The course must exist before demand can be recorded against it. The database
   * foreign key is the backstop; this lookup turns the refusal into the same
   * COURSE_NOT_FOUND answer the allocation write path gives.
   */
  async function assertCourseExists(
    transaction: Pick<PrismaClient, "course">,
    courseId: number,
  ): Promise<void> {
    const course = await transaction.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) {
      throw createRouteError(
        404,
        "COURSE_NOT_FOUND",
        "The requested course could not be found.",
      );
    }
  }

  return {
    async listStaffingRequirements(query) {
      const rows = await client.staffingRequirement.findMany({
        where: {
          ...(query.courseId === undefined ? {} : { courseId: query.courseId }),
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        select: requirementSelection,
      });
      return rows.map(toStaffingRequirementSummary);
    },

    async createStaffingRequirement(organiserAuth0Id, input) {
      return await client.$transaction(async (transaction) => {
        // The author is taken from the verified token, never from the request
        // body, so a requirement cannot be recorded in someone else's name.
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

        await assertCourseExists(transaction, input.courseId);

        const created = await transaction.staffingRequirement.create({
          data: {
            courseId: input.courseId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            tutorsNeeded: input.tutorsNeeded,
            notes: input.notes ?? null,
            createdById: organiser.id,
          },
          select: requirementSelection,
        });
        return toStaffingRequirementSummary(created);
      });
    },

    async updateStaffingRequirement(requirementId, input) {
      return await client.$transaction(async (transaction) => {
        const current = await transaction.staffingRequirement.findUnique({
          where: { id: requirementId },
          select: { id: true },
        });
        if (!current) {
          requirementNotFound();
        }

        await assertCourseExists(transaction, input.courseId);

        // Editing details never changes the status: a CLOSED or CANCELLED
        // requirement can still be corrected, and reopening is a separate route.
        const updated = await transaction.staffingRequirement.update({
          where: { id: requirementId },
          data: {
            courseId: input.courseId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            tutorsNeeded: input.tutorsNeeded,
            // Absent leaves the note untouched; null clears it.
            ...(input.notes === undefined ? {} : { notes: input.notes }),
          },
          select: requirementSelection,
        });
        return toStaffingRequirementSummary(updated);
      });
    },

    async setStaffingRequirementStatus(requirementId, status) {
      return await client.$transaction(async (transaction) => {
        const current = await transaction.staffingRequirement.findUnique({
          where: { id: requirementId },
          select: { id: true, status: true },
        });
        if (!current) {
          requirementNotFound();
        }
        // Repeating the status a requirement already holds is reported rather
        // than silently accepted, so two organisers cannot each believe they
        // made the change.
        if (current.status === status) {
          throw createRouteError(
            409,
            "STAFFING_REQUIREMENT_CONFLICT",
            `This staffing requirement is already ${status.toLowerCase()}.`,
          );
        }

        const updated = await transaction.staffingRequirement.update({
          where: { id: requirementId },
          data: { status },
          select: requirementSelection,
        });
        return toStaffingRequirementSummary(updated);
      });
    },
  };
}

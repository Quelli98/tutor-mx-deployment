import { assertResultLimit, MAX_REPORT_ROWS } from "../http/limits.js";
import {
  createRouteError,
  type StaffingRequirementListQuery,
  type StaffingRequirementFillState,
  type StaffingRequirementStatus,
  type StaffingRequirementSummary,
  type StaffingRequirementWriteInput,
} from "../app.js";
import { type PrismaClient } from "../generated/prisma/client.js";
import {
  getAssignedHoursForRequirements,
  type QueryClient,
} from "./allocation-queries.js";

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
    reason?: string,
  ): Promise<StaffingRequirementSummary>;
}

const requirementSelection = {
  id: true,
  courseId: true,
  startsAt: true,
  endsAt: true,
  tutorsNeeded: true,
  status: true,
  statusReason: true,
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
  statusReason: string | null;
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

/**
 * Hours are carried to two decimals throughout, so a gap smaller than that is
 * rounding noise rather than real unfilled work. Without this, a requirement
 * covered exactly by its bookings could report "0.01 tutor hours short" and ask
 * for another whole tutor.
 */
const HOURS_TOLERANCE = 0.01;

function shortageFor(
  requiredHours: number,
  assignedHours: number,
  status: StaffingRequirementStatus,
): number {
  // A requirement nobody wants filled has no shortage, so totals added up
  // elsewhere never include demand that was closed or withdrawn.
  if (status !== "OPEN") {
    return 0;
  }
  // Rounded before it is compared: subtracting two two-decimal figures can leave
  // a value like 0.010000000000000009, which would slip past a bare comparison
  // and be reported as a real shortage.
  const remaining = Math.round((requiredHours - assignedHours) * 100) / 100;
  return remaining <= HOURS_TOLERANCE ? 0 : remaining;
}

/**
 * The one rule for how filled a window is, exported so a day's worth of
 * requirements is described in exactly the same words as a single one.
 */
export function fillStateFor(
  assignedHours: number,
  shortageHours: number,
  status: StaffingRequirementStatus,
): StaffingRequirementFillState {
  if (status !== "OPEN") {
    return "not-being-filled";
  }
  if (shortageHours === 0) {
    return "fully-filled";
  }
  return assignedHours > 0 ? "partially-filled" : "unfilled";
}

function toStaffingRequirementSummary(
  row: RequirementRow,
  assignedHours: number,
): StaffingRequirementSummary {
  const requiredHours = requiredHoursFor(
    row.startsAt,
    row.endsAt,
    row.tutorsNeeded,
  );
  const windowHours = windowHoursFor(row.startsAt, row.endsAt);
  const shortageHours = shortageFor(requiredHours, assignedHours, row.status);

  return {
    id: row.id,
    courseId: row.courseId,
    courseCode: row.course.code,
    courseName: row.course.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    tutorsNeeded: row.tutorsNeeded,
    windowHours,
    requiredHours,
    assignedHours,
    shortageHours,
    // Whole people, rounded up: half a tutor short still means finding someone.
    shortageTutors: Math.ceil(shortageHours / windowHours),
    fillState: fillStateFor(assignedHours, shortageHours, row.status),
    status: row.status,
    statusReason: row.statusReason,
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
  queryClient: QueryClient,
): StaffingRequirementService {
  /**
   * One query covers every requirement in the list, so a long list never turns
   * into a query per row.
   */
  async function withAssignedHours(
    rows: RequirementRow[],
  ): Promise<StaffingRequirementSummary[]> {
    const assignedHours = await getAssignedHoursForRequirements(
      queryClient,
      rows.map((row) => row.id),
    );
    return rows.map((row) =>
      toStaffingRequirementSummary(row, assignedHours.get(row.id) ?? 0),
    );
  }

  async function withAssignedHoursForOne(
    row: RequirementRow,
  ): Promise<StaffingRequirementSummary> {
    const [summary] = await withAssignedHours([row]);
    return summary!;
  }

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
      // Expired sessions must not remain actionable. Closing them before the
      // read also means an OPEN filter immediately excludes sessions whose end
      // time has already passed, while the all-status view shows them as CLOSED.
      await client.staffingRequirement.updateMany({
        where: {
          status: "OPEN",
          endsAt: { lte: new Date() },
        },
        data: { status: "CLOSED" },
      });

      const rows = await client.staffingRequirement.findMany({
        take: MAX_REPORT_ROWS + 1,
        where: {
          ...(query.ids ? { id: { in: query.ids } } : {}),
          ...(query.courseId === undefined ? {} : { courseId: query.courseId }),
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        select: requirementSelection,
      });
      assertResultLimit(rows, MAX_REPORT_ROWS, "Staffing requirements");
      return await withAssignedHours(rows);
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
        return await withAssignedHoursForOne(created);
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
        return await withAssignedHoursForOne(updated);
      });
    },

    async setStaffingRequirementStatus(requirementId, status, reason) {
      return await client.$transaction(async (transaction) => {
        const current = await transaction.staffingRequirement.findUnique({
          where: { id: requirementId },
          select: requirementSelection,
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
        if (status === "OPEN" && current.endsAt <= new Date()) {
          throw createRouteError(
            409,
            "STAFFING_REQUIREMENT_CONFLICT",
            "This session has already ended and cannot be reopened.",
          );
        }

        // Closing or cancelling work that is still short overrides the
        // shortage, so it needs a reason. Fully staffed work can close without.
        if (status !== "OPEN" && current.status === "OPEN" && !reason) {
          const { shortageTutors } = await withAssignedHoursForOne(current);
          if (shortageTutors > 0) {
            throw createRouteError(
              409,
              "STATUS_REASON_REQUIRED",
              `This session is still ${shortageTutors} ${shortageTutors === 1 ? "tutor" : "tutors"} short. Give a reason for ${status === "CLOSED" ? "closing" : "cancelling"} it anyway.`,
            );
          }
        }

        const updated = await transaction.staffingRequirement.update({
          where: { id: requirementId },
          // Reopening clears the old reason: it no longer explains anything.
          data: { status, statusReason: status === "OPEN" ? null : reason ?? null },
          select: requirementSelection,
        });
        return await withAssignedHoursForOne(updated);
      });
    },
  };
}

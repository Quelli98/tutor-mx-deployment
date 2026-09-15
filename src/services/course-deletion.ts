import { createRouteError } from "../app.js";
import type { PrismaClient } from "../generated/prisma/client.js";

export const COURSE_DELETE_REFUSALS = {
  activeAllocations:
    "This course has proposed or confirmed allocations, so it cannot be deleted.",
  lockedTimesheetHours:
    "This course has hours in submitted or approved timesheets, so it cannot be deleted.",
  openOverflowWork:
    "This course has open overflow work, so it cannot be deleted.",
  changedDuringDelete:
    "The course changed while it was being deleted. Refresh and try again.",
} as const;

function refuse(message: string): never {
  throw createRouteError(409, "COURSE_CONFLICT", message);
}

function errorCode(value: unknown): unknown {
  return typeof value === "object" && value !== null && "code" in value
    ? (value as { code?: unknown }).code
    : undefined;
}

function driverOriginalCode(value: unknown): unknown {
  return (
    value as {
      meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
    }
  ).meta?.driverAdapterError?.cause?.originalCode;
}

// Failures that mean another transaction got in the way rather than a rule the
// organiser can act on: a serialization conflict (P2034), a deadlock (40P01, which
// the adapter does not map and Prisma wraps as P2039), or a foreign key that still
// refused the final delete. A refusal arrives as 23503 (P2003) or, for a RESTRICT
// key, 23001 wrapped as P2039.
function isConcurrentChange(value: unknown) {
  const code = errorCode(value);
  if (code === "P2034" || code === "P2003") {
    return true;
  }
  const originalCode = driverOriginalCode(value);
  return code === "P2039" && (originalCode === "23001" || originalCode === "40P01");
}

/**
 * Delete a course together with everything that only exists because of it, or
 * refuse without changing anything.
 *
 * The delete is refused while the course still has PROPOSED or CONFIRMED
 * allocations, work logs in SUBMITTED or APPROVED timesheets, or OPEN overflow
 * work. Otherwise these are removed, children before parents, because every one
 * of those keys is RESTRICT:
 *
 * 1. volunteer claims on the course's overflow work
 * 2. that overflow work (posted on the course or created from its allocations)
 * 3. excuses on the course's cancelled allocations
 * 4. work logs on those allocations (only DRAFT or RETURNED timesheets, or none)
 * 5. the cancelled allocations
 * 6. the course, which cascades to its tutor marks
 *
 * Timesheets are kept even if this leaves one with no work logs.
 *
 * Every row a refusal depends on is locked before it is checked, so a change that
 * commits while the checks run is either waited for and seen, or blocked until the
 * course is gone. READ COMMITTED is deliberate: each check reads the latest
 * committed rows once the lock is held, where a SERIALIZABLE snapshot would still
 * show the rows from before the wait.
 */
export async function deleteCourseAndDependents(
  client: PrismaClient,
  courseId: number,
): Promise<void> {
  try {
    await client.$transaction(
      async (transaction) => {
        // Locking the course blocks new allocations, overflow work and marks for it:
        // inserting a row that references the course needs a key-share lock on it.
        const course = await transaction.$queryRaw<{ id: number }[]>`
          SELECT "id" FROM "Course" WHERE "id" = ${courseId} FOR UPDATE`;
        if (course.length === 0) {
          throw createRouteError(
            404,
            "COURSE_NOT_FOUND",
            "The requested course could not be found.",
          );
        }

        const allocations = await transaction.$queryRaw<
          { id: number; status: string }[]
        >`
          SELECT "id", "status"::text AS "status" FROM "Allocation"
          WHERE "courseId" = ${courseId}
          FOR UPDATE`;
        if (allocations.some(({ status }) => status !== "CANCELLED")) {
          refuse(COURSE_DELETE_REFUSALS.activeAllocations);
        }
        const allocationIds = allocations.map(({ id }) => id);

        // Locking the work logs and sharing a lock on their timesheets stops a log
        // being moved or its timesheet submitted before the delete commits.
        const workLogs = await transaction.$queryRaw<
          { id: number; timesheetId: number | null }[]
        >`
          SELECT "id", "timesheetId" FROM "WorkLog"
          WHERE "allocationId" = ANY(${allocationIds}::integer[])
          FOR UPDATE`;
        const timesheetIds = [
          ...new Set(
            workLogs
              .map(({ timesheetId }) => timesheetId)
              .filter((id): id is number => id !== null),
          ),
        ];
        const lockedTimesheets = await transaction.$queryRaw<{ id: number }[]>`
          SELECT "id" FROM "Timesheet"
          WHERE "id" = ANY(${timesheetIds}::integer[])
            AND "status" IN ('SUBMITTED', 'APPROVED')
          FOR SHARE`;
        if (lockedTimesheets.length > 0) {
          refuse(COURSE_DELETE_REFUSALS.lockedTimesheetHours);
        }

        // Locking the overflow work also blocks new volunteer claims, whose
        // trigger locks the work row before accepting a claim.
        const overflowWork = await transaction.$queryRaw<
          { id: number; status: string }[]
        >`
          SELECT "id", "status"::text AS "status" FROM "OverflowWork"
          WHERE "courseId" = ${courseId}
             OR "sourceAllocationId" = ANY(${allocationIds}::integer[])
          FOR UPDATE`;
        if (overflowWork.some(({ status }) => status === "OPEN")) {
          refuse(COURSE_DELETE_REFUSALS.openOverflowWork);
        }
        const overflowWorkIds = overflowWork.map(({ id }) => id);

        await transaction.volunteerClaim.deleteMany({
          where: { overflowWorkId: { in: overflowWorkIds } },
        });
        await transaction.overflowWork.deleteMany({
          where: { id: { in: overflowWorkIds } },
        });
        await transaction.excuse.deleteMany({
          where: { allocationId: { in: allocationIds } },
        });
        await transaction.workLog.deleteMany({
          where: { allocationId: { in: allocationIds } },
        });
        await transaction.allocation.deleteMany({
          where: { id: { in: allocationIds }, status: "CANCELLED" },
        });
        await transaction.course.delete({ where: { id: courseId } });
      },
      { isolationLevel: "ReadCommitted" },
    );
  } catch (value) {
    if (isConcurrentChange(value)) {
      refuse(COURSE_DELETE_REFUSALS.changedDuringDelete);
    }
    throw value;
  }
}

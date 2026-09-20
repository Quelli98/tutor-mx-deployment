import { createRouteError } from "../app.js";
import { type PrismaClient } from "../generated/prisma/client.js";

export interface CourseService {
  /**
   * Delete a course only when doing so destroys no auditable history.
   *
   * Safe (deletes): an empty course, or one linked only to disposable setup
   * data - tutor marks, staffing requirements, and PROPOSED/CANCELLED
   * allocations plus unclaimed overflow that carry no logged work, excuses or
   * volunteer claims.
   *
   * Blocked (409 COURSE_DELETE_CONFLICT, no changes): confirmed allocations,
   * work logs (which is how submitted/approved timesheet history attaches to a
   * course), excuse records, or volunteer-claim history.
   */
  deleteCourse(courseId: number): Promise<void>;
}

function formatBlockers(blockers: string[]): string {
  if (blockers.length === 1) {
    return blockers[0]!;
  }
  const leading = blockers.slice(0, -1).join(", ");
  return `${leading} and ${blockers[blockers.length - 1]}`;
}

export function createCourseService(client: PrismaClient): CourseService {
  return {
    async deleteCourse(courseId) {
      await client.$transaction(async (transaction) => {
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

        // Inspect every dependent record that would need to remain auditable.
        // Counting inside the transaction keeps the verdict and the deletion
        // consistent even if other requests run concurrently.
        const [
          confirmedAllocations,
          workLogs,
          excuses,
          volunteerClaims,
        ] = await Promise.all([
          transaction.allocation.count({
            where: { courseId, status: "CONFIRMED" },
          }),
          transaction.workLog.count({
            where: { allocation: { courseId } },
          }),
          transaction.excuse.count({
            where: { allocation: { courseId } },
          }),
          transaction.volunteerClaim.count({
            where: { overflowWork: { courseId } },
          }),
        ]);

        const blockers: string[] = [];
        if (confirmedAllocations > 0) {
          blockers.push("confirmed allocations");
        }
        if (workLogs > 0) {
          blockers.push("logged work");
        }
        if (excuses > 0) {
          blockers.push("excuse records");
        }
        if (volunteerClaims > 0) {
          blockers.push("volunteer claims");
        }

        if (blockers.length > 0) {
          throw createRouteError(
            409,
            "COURSE_DELETE_CONFLICT",
            `This course still has ${formatBlockers(blockers)} that must remain auditable, so it cannot be deleted. Cancel or reassign that work first.`,
          );
        }

        // Safe to remove. Delete disposable children in dependency order so the
        // ON DELETE Restrict foreign keys are satisfied at every step:
        //   overflow work (references both the course and its source
        //   allocation) -> proposed/cancelled allocations -> tutor marks ->
        //   staffing requirements (recorded demand, never history) -> the
        //   course itself. The whole sequence is atomic, so a surprise
        //   constraint aborts everything and leaves no partial deletion.
        await transaction.overflowWork.deleteMany({ where: { courseId } });
        await transaction.allocation.deleteMany({ where: { courseId } });
        await transaction.tutorMark.deleteMany({ where: { courseId } });
        await transaction.staffingRequirement.deleteMany({ where: { courseId } });
        await transaction.course.delete({ where: { id: courseId } });
      });
    },
  };
}

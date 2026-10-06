import { assertResultLimit, MAX_REPORT_ROWS } from "../http/limits.js";
import {
  createRouteError,
  type CourseMarkEntry,
  type CourseTutorMarkSummary,
} from "../app.js";
import { type PrismaClient } from "../generated/prisma/client.js";

/**
 * One course's marks for every tutor, read and written together, so an
 * organiser can enter a whole mark list at once instead of one tutor at a time.
 */
export interface CourseMarksService {
  listCourseMarks(courseId: number): Promise<CourseTutorMarkSummary[]>;
  saveCourseMarks(
    courseId: number,
    entries: CourseMarkEntry[],
  ): Promise<CourseTutorMarkSummary[]>;
}

type MarksClient = Pick<PrismaClient, "course" | "profile" | "tutorMark">;

async function assertCourseExists(client: MarksClient, courseId: number) {
  const course = await client.course.findUnique({
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

async function readCourseMarks(
  client: MarksClient,
  courseId: number,
): Promise<CourseTutorMarkSummary[]> {
  // Every tutor is listed, with or without a mark, so the screen can offer a
  // box for each one.
  const tutors = await client.profile.findMany({
    take: MAX_REPORT_ROWS + 1,
    where: { role: "TUTOR" },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fullName: true,
      email: true,
      tutorMarks: { where: { courseId }, select: { mark: true } },
    },
  });
  assertResultLimit(tutors, MAX_REPORT_ROWS, "Course marks");
  return tutors.map((tutor) => ({
    tutorId: tutor.id,
    fullName: tutor.fullName,
    email: tutor.email,
    mark: tutor.tutorMarks[0] ? Number(tutor.tutorMarks[0].mark) : null,
  }));
}

export function createCourseMarksService(client: PrismaClient): CourseMarksService {
  return {
    async listCourseMarks(courseId) {
      await assertCourseExists(client, courseId);
      return await readCourseMarks(client, courseId);
    },

    async saveCourseMarks(courseId, entries) {
      // All or nothing: a mark list that is half saved would be harder to
      // check than one that was refused and can simply be sent again.
      return await client.$transaction(async (transaction) => {
        await assertCourseExists(transaction, courseId);

        const tutorIds = entries.map((entry) => entry.tutorId);
        const tutors = await transaction.profile.findMany({
          where: { id: { in: tutorIds }, role: "TUTOR" },
          select: { id: true },
        });
        const known = new Set(tutors.map((tutor) => tutor.id));
        const missing = tutorIds.filter((id) => !known.has(id));
        if (missing.length > 0) {
          throw createRouteError(
            404,
            "TUTOR_NOT_FOUND",
            `No marks were saved. These tutors could not be found: ${missing.join(", ")}.`,
          );
        }

        for (const entry of entries) {
          await transaction.tutorMark.upsert({
            where: { tutorId_courseId: { tutorId: entry.tutorId, courseId } },
            create: { tutorId: entry.tutorId, courseId, mark: entry.mark },
            update: { mark: entry.mark },
            select: { id: true },
          });
        }

        return await readCourseMarks(transaction, courseId);
      });
    },
  };
}

import "dotenv/config";
import { createApp, createRouteError } from "./app.js";
import { createAuth0AccessTokenVerifier } from "./auth/auth0-verifier.js";
import {
  normalizeTutorRole,
  type AccessTokenVerifier,
} from "./auth/contract.js";
import {
  createAuth0PasswordResetRequester,
  type PasswordResetRequester,
} from "./auth/password-reset.js";
import { prisma, queryClient } from "./database.js";
import { getTutorHourSummary } from "./services/allocation-queries.js";

const port = Number(process.env.PORT ?? 3000);

const auth0Domain = process.env.AUTH0_DOMAIN;
const auth0Audience = process.env.AUTH0_AUDIENCE;
const auth0RolesClaim =
  process.env.AUTH0_ROLES_CLAIM ?? "https://tutormx.example/roles";

const verifyAccessToken: AccessTokenVerifier =
  auth0Domain && auth0Audience
    ? createAuth0AccessTokenVerifier({
        audience: auth0Audience,
        domain: auth0Domain,
        rolesClaim: auth0RolesClaim,
      })
    : async () => {
        throw new Error("Auth0 access-token verification is not configured");
      };

const requestPasswordReset: PasswordResetRequester =
  auth0Domain && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_DB_CONNECTION
    ? createAuth0PasswordResetRequester({
        clientId: process.env.AUTH0_CLIENT_ID,
        connection: process.env.AUTH0_DB_CONNECTION,
        domain: auth0Domain,
      })
    : async () => {
        throw new Error("Auth0 password reset is not configured");
      };

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function toCourseSummary(course: { id: number; code: string; name: string }) {
  return {
    id: course.id,
    code: course.code,
    name: course.name,
  };
}

function toTutorSummary(profile: {
  id: number;
  auth0Id: string;
  email: string;
  fullName: string;
  role: string;
  hourLimit?: { weeklyHours: unknown } | null;
}) {
  return {
    id: profile.id,
    auth0Id: profile.auth0Id,
    email: profile.email,
    fullName: profile.fullName,
    role: normalizeTutorRole(profile.role) ?? "TUTOR",
    weeklyHours:
      profile.hourLimit?.weeklyHours === undefined ||
      profile.hourLimit?.weeklyHours === null
        ? null
        : Number(profile.hourLimit.weeklyHours),
  };
}

function mondayUtcFor(value: Date) {
  const result = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
  return result;
}

async function findTutorProfileId(auth0Id: string) {
  const profile = await prisma.profile.findUnique({
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

const app = createApp(
  async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  {
    corsOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    verifyAccessToken,
    requestPasswordReset,
    async findProfileByAuth0Id(auth0Id) {
      const profile = await prisma.profile.findUnique({
        where: { auth0Id },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
        },
      });
      const role = normalizeTutorRole(profile?.role);
      return profile && role ? { ...profile, role } : null;
    },
    async listCourses() {
      const courses = await prisma.course.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      });
      return courses.map(toCourseSummary);
    },
    async createCourse(input) {
      try {
        const course = await prisma.course.create({
          data: {
            code: input.code,
            name: input.name,
          },
          select: { id: true, code: true, name: true },
        });
        return toCourseSummary(course);
      } catch (error) {
        if (isPrismaErrorCode(error, "P2002")) {
          throw createRouteError(
            409,
            "COURSE_CODE_CONFLICT",
            "A course with that code already exists.",
          );
        }
        throw error;
      }
    },
    async updateCourse(courseId, input) {
      try {
        const course = await prisma.course.update({
          where: { id: courseId },
          data: {
            code: input.code,
            name: input.name,
          },
          select: { id: true, code: true, name: true },
        });
        return toCourseSummary(course);
      } catch (error) {
        if (isPrismaErrorCode(error, "P2025")) {
          throw createRouteError(
            404,
            "COURSE_NOT_FOUND",
            "The requested course could not be found.",
          );
        }
        if (isPrismaErrorCode(error, "P2002")) {
          throw createRouteError(
            409,
            "COURSE_CODE_CONFLICT",
            "A course with that code already exists.",
          );
        }
        throw error;
      }
    },
    async deleteCourse(courseId) {
      try {
        await prisma.course.delete({ where: { id: courseId } });
      } catch (error) {
        if (isPrismaErrorCode(error, "P2025")) {
          throw createRouteError(
            404,
            "COURSE_NOT_FOUND",
            "The requested course could not be found.",
          );
        }
        if (isPrismaErrorCode(error, "P2003")) {
          throw createRouteError(
            409,
            "COURSE_CONFLICT",
            "The course is still referenced by existing records.",
          );
        }
        throw error;
      }
    },
    async listTutors() {
      const tutors = await prisma.profile.findMany({
        where: { role: "TUTOR" },
        orderBy: { fullName: "asc" },
        select: {
          id: true,
          auth0Id: true,
          email: true,
          fullName: true,
          role: true,
          hourLimit: {
            select: { weeklyHours: true },
          },
        },
      });
      return tutors.map(toTutorSummary);
    },
    async createTutor(input) {
      try {
        const tutor = await prisma.profile.create({
          data: {
            auth0Id: input.auth0Id,
            email: input.email,
            fullName: input.fullName,
            role: "TUTOR",
            ...(input.weeklyHours !== undefined
              ? {
                  hourLimit: {
                    create: {
                      weeklyHours: input.weeklyHours,
                    },
                  },
                }
              : {}),
          },
          select: {
            id: true,
            auth0Id: true,
            email: true,
            fullName: true,
            role: true,
            hourLimit: {
              select: { weeklyHours: true },
            },
          },
        });
        return toTutorSummary(tutor);
      } catch (error) {
        if (isPrismaErrorCode(error, "P2002")) {
          throw createRouteError(
            409,
            "TUTOR_CONFLICT",
            "A tutor with that identity already exists.",
          );
        }
        throw error;
      }
    },
    async updateTutor(tutorId, input) {
      try {
        const existingTutor = await prisma.profile.findUnique({
          where: { id: tutorId },
          select: { role: true },
        });
        if (existingTutor?.role !== "TUTOR") {
          throw createRouteError(
            404,
            "TUTOR_NOT_FOUND",
            "The requested tutor could not be found.",
          );
        }

        const tutor = await prisma.profile.update({
          where: { id: tutorId },
          data: {
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.fullName !== undefined
              ? { fullName: input.fullName }
              : {}),
            ...(input.weeklyHours !== undefined
              ? {
                  hourLimit: {
                    upsert: {
                      create: { weeklyHours: input.weeklyHours },
                      update: { weeklyHours: input.weeklyHours },
                    },
                  },
                }
              : {}),
          },
          select: {
            id: true,
            auth0Id: true,
            email: true,
            fullName: true,
            role: true,
            hourLimit: {
              select: { weeklyHours: true },
            },
          },
        });
        return toTutorSummary(tutor);
      } catch (error) {
        if (isPrismaErrorCode(error, "P2025")) {
          throw createRouteError(
            404,
            "TUTOR_NOT_FOUND",
            "The requested tutor could not be found.",
          );
        }
        if (isPrismaErrorCode(error, "P2002")) {
          throw createRouteError(
            409,
            "TUTOR_CONFLICT",
            "A tutor with that identity already exists.",
          );
        }
        throw error;
      }
    },
    async getTutorDashboard(auth0Id) {
      const profile = await prisma.profile.findUnique({
        where: { auth0Id },
        select: {
          id: true,
          role: true,
          allocations: {
            where: { status: { in: ["PROPOSED", "CONFIRMED"] } },
            orderBy: { startsAt: "asc" },
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              allocatedHours: true,
              status: true,
              course: { select: { code: true, name: true } },
            },
          },
        },
      });
      if (profile?.role !== "TUTOR") {
        throw createRouteError(
          404,
          "TUTOR_PROFILE_NOT_FOUND",
          "No tutor profile is linked to this account.",
        );
      }

      const hourSummary = await getTutorHourSummary(
        queryClient,
        profile.id,
        mondayUtcFor(new Date()),
      );
      if (!hourSummary) {
        throw createRouteError(
          409,
          "TUTOR_HOUR_LIMIT_MISSING",
          "A weekly-hour limit must be configured before the dashboard can be used.",
        );
      }

      return {
        allocations: profile.allocations.map((allocation) => ({
          id: allocation.id,
          courseCode: allocation.course.code,
          courseName: allocation.course.name,
          startsAt: allocation.startsAt.toISOString(),
          endsAt: allocation.endsAt.toISOString(),
          allocatedHours: Number(allocation.allocatedHours),
          status:
            allocation.status === "CONFIRMED" ? "CONFIRMED" : "PROPOSED",
        })),
        weeklyLimit: hourSummary.weeklyLimit,
        usedHours: hourSummary.usedHours,
        remainingHours: hourSummary.remainingHours,
      };
    },
    async createTutorTimeSlot(auth0Id, input) {
      const tutorId = await findTutorProfileId(auth0Id);
      try {
        const timeSlot = await prisma.timeSlot.create({
          data: {
            tutorId,
            type: input.type,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            recurrence: input.recurrence ?? null,
          },
          select: {
            id: true,
            type: true,
            startsAt: true,
            endsAt: true,
            recurrence: true,
          },
        });
        return {
          id: timeSlot.id,
          type: timeSlot.type,
          startsAt: timeSlot.startsAt.toISOString(),
          endsAt: timeSlot.endsAt.toISOString(),
          recurrence:
            timeSlot.recurrence === "WEEKLY" ? "WEEKLY" : null,
        };
      } catch (error) {
        if (
          isPrismaErrorCode(error, "P2003") ||
          isPrismaErrorCode(error, "P2004")
        ) {
          throw createRouteError(
            409,
            "TIME_SLOT_CONFLICT",
            "The availability slot conflicts with tutor data rules.",
          );
        }
        throw error;
      }
    },
    async createTutorWorkLog(auth0Id, input) {
      const tutorId = await findTutorProfileId(auth0Id);
      const allocation = await prisma.allocation.findFirst({
        where: { id: input.allocationId, tutorId },
        select: { id: true, startsAt: true, status: true },
      });
      if (!allocation) {
        throw createRouteError(
          404,
          "ALLOCATION_NOT_FOUND",
          "The assigned session could not be found.",
        );
      }
      if (
        allocation.status !== "CONFIRMED" ||
        allocation.startsAt.toISOString().slice(0, 10) !== input.workDate
      ) {
        throw createRouteError(
          409,
          "WORK_LOG_CONFLICT",
          "Worked hours must match a confirmed session owned by the tutor.",
        );
      }

      const weekStart = mondayUtcFor(
        new Date(`${input.workDate}T12:00:00.000Z`),
      );
      try {
        return await prisma.$transaction(async (transaction) => {
          const timesheet = await transaction.timesheet.upsert({
            where: { tutorId_weekStart: { tutorId, weekStart } },
            create: { tutorId, weekStart },
            update: {},
            select: { id: true, status: true },
          });
          if (timesheet.status !== "DRAFT" && timesheet.status !== "RETURNED") {
            throw createRouteError(
              409,
              "TIMESHEET_LOCKED",
              "Worked hours cannot be changed on this timesheet.",
            );
          }

          const workLog = await transaction.workLog.create({
            data: {
              tutorId,
              allocationId: allocation.id,
              timesheetId: timesheet.id,
              workDate: new Date(`${input.workDate}T00:00:00.000Z`),
              hours: input.hours,
              description: input.description,
            },
            select: {
              id: true,
              allocationId: true,
              timesheetId: true,
              workDate: true,
              hours: true,
              description: true,
            },
          });

          return {
            id: workLog.id,
            allocationId: workLog.allocationId,
            timesheetId: workLog.timesheetId!,
            workDate: workLog.workDate.toISOString().slice(0, 10),
            hours: Number(workLog.hours),
            description: workLog.description,
          };
        });
      } catch (error) {
        if (isPrismaErrorCode(error, "P2002")) {
          throw createRouteError(
            409,
            "WORK_LOG_DUPLICATE",
            "Worked hours have already been recorded for this session and date.",
          );
        }
        if (
          isPrismaErrorCode(error, "P2003") ||
          isPrismaErrorCode(error, "P2004")
        ) {
          throw createRouteError(
            409,
            "WORK_LOG_CONFLICT",
            "The worked-hours entry conflicts with tutor or timesheet rules.",
          );
        }
        throw error;
      }
    },
    async createTutorExcuse(auth0Id, input) {
      const tutorId = await findTutorProfileId(auth0Id);
      const allocation = await prisma.allocation.findFirst({
        where: {
          id: input.allocationId,
          tutorId,
          status: "CONFIRMED",
          startsAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!allocation) {
        throw createRouteError(
          404,
          "ALLOCATION_NOT_FOUND",
          "The assigned future session could not be found.",
        );
      }

      try {
        const excuse = await prisma.excuse.create({
          data: {
            tutorId,
            allocationId: allocation.id,
            reason: input.reason,
          },
          select: {
            id: true,
            allocationId: true,
            reason: true,
            status: true,
          },
        });
        return {
          id: excuse.id,
          allocationId: excuse.allocationId,
          reason: excuse.reason,
          status: "PENDING",
        };
      } catch (error) {
        if (isPrismaErrorCode(error, "P2002")) {
          throw createRouteError(
            409,
            "EXCUSE_DUPLICATE",
            "An excuse has already been submitted for this session.",
          );
        }
        if (
          isPrismaErrorCode(error, "P2003") ||
          isPrismaErrorCode(error, "P2004")
        ) {
          throw createRouteError(
            409,
            "EXCUSE_CONFLICT",
            "The excuse conflicts with tutor or session rules.",
          );
        }
        throw error;
      }
    },
  },
  (entry) => {
    console.info(JSON.stringify({ event: "http_request", ...entry }));
  },
);

app.listen(port, () => {
  console.log(`Tutor Mx API listening on http://localhost:${port}`);
});

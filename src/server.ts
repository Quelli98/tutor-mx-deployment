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
import { prisma } from "./database.js";

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
  },
  (entry) => {
    console.info(JSON.stringify({ event: "http_request", ...entry }));
  },
);

app.listen(port, () => {
  console.log(`Tutor Mx API listening on http://localhost:${port}`);
});

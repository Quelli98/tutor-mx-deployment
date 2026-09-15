import "dotenv/config";
import {
  createApp,
  createRouteError,
  type TutorMarkSummary,
  type TutorTimeSlotSummary,
} from "./app.js";
import { createAuth0AccessTokenVerifier } from "./auth/auth0-verifier.js";
import {
  normalizeTutorRole,
  type AccessTokenVerifier,
} from "./auth/contract.js";
import {
  createAuth0PasswordResetRequester,
  type PasswordResetRequester,
} from "./auth/password-reset.js";
import { createAuth0RoleProvisioner, createAuth0UserDeleter } from "./auth/management-api.js";
import { prisma, queryClient } from "./database.js";
import { createSouthAfricaPublicHolidayService } from "./integrations/public-holidays.js";
import {
  findAllocationCandidates,
  getTutorHourSummary,
} from "./services/allocation-queries.js";
import { deleteCourseAndDependents } from "./services/course-deletion.js";
import { createExcuseWorkflowService } from "./services/excuse-workflows.js";
import { createOrganiserService } from "./services/organiser-service.js";
import { createStudentWorkflowService } from "./services/student-workflows.js";
import { createTimesheetWorkflowService } from "./services/timesheet-workflows.js";

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

const auth0ManagementConfig =
  auth0Domain && process.env.AUTH0_MANAGEMENT_CLIENT_ID && process.env.AUTH0_MANAGEMENT_CLIENT_SECRET
    ? { domain: auth0Domain, clientId: process.env.AUTH0_MANAGEMENT_CLIENT_ID, clientSecret: process.env.AUTH0_MANAGEMENT_CLIENT_SECRET }
    : null;

const deleteAuth0User = auth0ManagementConfig
  ? createAuth0UserDeleter(auth0ManagementConfig)
  : async () => { throw new Error("Auth0 Management API deletion is not configured"); };

const provisionAuth0Role = auth0ManagementConfig
  ? createAuth0RoleProvisioner(auth0ManagementConfig)
  : async () => { throw new Error("Auth0 Management API onboarding is not configured"); };

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

function toTimeSlotSummary(timeSlot: {
  id: number;
  type: "AVAILABLE" | "BUSY";
  startsAt: Date;
  endsAt: Date;
  recurrence: string | null;
}): TutorTimeSlotSummary {
  return {
    id: timeSlot.id,
    type: timeSlot.type,
    startsAt: timeSlot.startsAt.toISOString(),
    endsAt: timeSlot.endsAt.toISOString(),
    recurrence: timeSlot.recurrence === "WEEKLY" ? "WEEKLY" : null,
  };
}

function toTutorMarkSummary(
  mark: {
    id: number;
    courseId: number;
    course: { code: string; name: string };
    mark: unknown;
  },
  activeAllocationCount = 0,
): TutorMarkSummary {
  return {
    id: mark.id,
    courseId: mark.courseId,
    courseCode: mark.course.code,
    courseName: mark.course.name,
    mark: Number(mark.mark),
    activeAllocationCount,
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

const studentWorkflowService = createStudentWorkflowService(
  prisma,
  queryClient,
);
const timesheetWorkflowService = createTimesheetWorkflowService(prisma);
const excuseWorkflowService = createExcuseWorkflowService(prisma);
const organiserService = createOrganiserService(prisma);
const publicHolidayService = createSouthAfricaPublicHolidayService();

const app = createApp(
  async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  {
    corsOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    verifyAccessToken,
    requestPasswordReset,
    allowSelfServiceOrganiser: process.env.ALLOW_SELF_SERVICE_ORGANISER?.toLowerCase() === "true",
    getPublicHolidays: (year) => publicHolidayService.execute(year),
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
    async onboardUser(auth0Id, role) {
      const existing = await prisma.profile.findUnique({
        where: { auth0Id },
        select: { id: true, email: true, fullName: true, role: true },
      });
      if (existing) {
        const existingRole = normalizeTutorRole(existing.role);
        if (!existingRole || existingRole !== role) {
          throw createRouteError(409, "ROLE_ALREADY_SET", "This Tutor Mx account already has a different role.");
        }
        const identity = await provisionAuth0Role(auth0Id, role);
        if (!identity.emailVerified) throw createRouteError(403, "EMAIL_NOT_VERIFIED", "Verify your email address, then try again.");
        return { ...existing, role: existingRole };
      }

      const identity = await provisionAuth0Role(auth0Id, role);
      if (!identity.emailVerified) throw createRouteError(403, "EMAIL_NOT_VERIFIED", "Verify your email address, then try again.");
      try {
        const profile = await prisma.profile.create({
          data: { auth0Id, email: identity.email, fullName: identity.fullName, role },
          select: { id: true, email: true, fullName: true, role: true },
        });
        return { ...profile, role };
      } catch (error) {
        if (isPrismaErrorCode(error, "P2002")) {
          throw createRouteError(409, "PROFILE_CONFLICT", "This email or Auth0 account is already linked to another Tutor Mx profile.");
        }
        throw error;
      }
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
      await deleteCourseAndDependents(prisma, courseId);
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

        const setsWeeklyHours =
          input.weeklyHours !== undefined && input.weeklyHours !== null;
        const clearsWeeklyHours = input.weeklyHours === null;

        const tutor = await prisma.profile.update({
          where: { id: tutorId },
          data: {
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.fullName !== undefined
              ? { fullName: input.fullName }
              : {}),
            ...(setsWeeklyHours
              ? {
                  hourLimit: {
                    upsert: {
                      create: { weeklyHours: input.weeklyHours! },
                      update: { weeklyHours: input.weeklyHours! },
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
        if (clearsWeeklyHours) {
          await prisma.tutorHourLimit.deleteMany({ where: { tutorId } });
        }

        return toTutorSummary(
          clearsWeeklyHours ? { ...tutor, hourLimit: null } : tutor,
        );
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

      const weekStart = mondayUtcFor(new Date());
      const hourSummary = await getTutorHourSummary(
        queryClient,
        profile.id,
        weekStart,
      );

      // A newly self-onboarded tutor can exist before an organiser has configured
      // their weekly-hour limit. That is a valid account state, not a dashboard
      // failure. Keep the tutor workspace usable and expose the missing limit as
      // null so the frontend can show a clear "not configured yet" state.
      const nextWeekStart = new Date(weekStart);
      nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);
      const confirmedHoursThisWeek = profile.allocations
        .filter(
          (allocation) =>
            allocation.status === "CONFIRMED" &&
            allocation.startsAt >= weekStart &&
            allocation.startsAt < nextWeekStart,
        )
        .reduce(
          (total, allocation) => total + Number(allocation.allocatedHours),
          0,
        );

      const dashboardHours = hourSummary ?? {
        weeklyLimit: null,
        usedHours: confirmedHoursThisWeek,
        remainingHours: null,
      };

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
        weeklyLimit: dashboardHours.weeklyLimit,
        usedHours: dashboardHours.usedHours,
        remainingHours: dashboardHours.remainingHours,
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
        return toTimeSlotSummary(timeSlot);
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
    listStudentOpenWork: studentWorkflowService.listOpenWork,
    listStudentVolunteerRequests:
      studentWorkflowService.listVolunteerRequests,
    createStudentVolunteerRequest:
      studentWorkflowService.createVolunteerRequest,
    getStudentVolunteerRequest: studentWorkflowService.getVolunteerRequest,
    withdrawStudentVolunteerRequest:
      studentWorkflowService.withdrawVolunteerRequest,
    getTutorTimesheetStatus: timesheetWorkflowService.getStatus,
    submitTutorTimesheet: timesheetWorkflowService.submit,
    getTutorExcuseStatus: excuseWorkflowService.getStatus,
    decideExcuse: excuseWorkflowService.decide,
    async listAllocationCandidates(input) {
      // The candidate query joins through tutor marks, so a course that no longer
      // exists would come back as an empty list and read as "no tutor has a mark".
      const course = await prisma.course.findUnique({
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
      return findAllocationCandidates(queryClient, input);
    },
    listOrganiserAllocations: organiserService.listAllocations,
    listOrganiserApprovals: organiserService.listApprovals,
    createAllocation: organiserService.createAllocation,
    updateAllocation: organiserService.updateAllocation,
    removeAllocation: organiserService.removeAllocation,
    decideTimesheet: organiserService.decideTimesheet,
    decideVolunteerClaim: organiserService.decideVolunteerClaim,
    async upsertTutorMark(tutorId, input) {
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
      try {
        const mark = await prisma.tutorMark.upsert({
          where: { tutorId_courseId: { tutorId, courseId: input.courseId } },
          create: {
            tutorId,
            courseId: input.courseId,
            mark: input.mark,
          },
          update: { mark: input.mark },
          select: {
            id: true,
            courseId: true,
            course: { select: { code: true, name: true } },
            mark: true,
          },
        });
        const activeAllocationCount = await prisma.allocation.count({
          where: {
            tutorId,
            courseId: input.courseId,
            status: { in: ["PROPOSED", "CONFIRMED"] },
          },
        });
        return toTutorMarkSummary(mark, activeAllocationCount);
      } catch (error) {
        if (
          isPrismaErrorCode(error, "P2003") ||
          isPrismaErrorCode(error, "P2025")
        ) {
          throw createRouteError(
            404,
            "COURSE_NOT_FOUND",
            "The requested course could not be found.",
          );
        }
        throw error;
      }
    },
    async listTutorMarks(tutorId) {
      const marks = await prisma.tutorMark.findMany({
        where: { tutorId },
        orderBy: { course: { code: "asc" } },
        select: {
          id: true,
          courseId: true,
          course: { select: { code: true, name: true } },
          mark: true,
        },
      });
      const allocationCounts = await prisma.allocation.groupBy({
        by: ["courseId"],
        where: { tutorId, status: { in: ["PROPOSED", "CONFIRMED"] } },
        _count: { _all: true },
      });
      const countByCourseId = new Map(
        allocationCounts.map((row) => [row.courseId, row._count._all]),
      );

      return marks.map((mark) =>
        toTutorMarkSummary(mark, countByCourseId.get(mark.courseId) ?? 0),
      );
    },
    async deleteTutorMark(tutorId, courseId) {
      const removed = await prisma.tutorMark.deleteMany({
        where: { tutorId, courseId },
      });
      if (removed.count === 0) {
        throw createRouteError(
          404,
          "TUTOR_MARK_NOT_FOUND",
          "The requested tutor mark could not be found.",
        );
      }
    },
    async listTutorTimeSlots(tutorId) {
      const timeSlots = await prisma.timeSlot.findMany({
        where: { tutorId },
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          type: true,
          startsAt: true,
          endsAt: true,
          recurrence: true,
        },
      });
      return timeSlots.map(toTimeSlotSummary);
    },
    async createTutorTimeSlotForTutor(tutorId, input) {
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
        return toTimeSlotSummary(timeSlot);
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
    async deleteTutorBusyTimeSlot(tutorId, timeSlotId) {
      const removed = await prisma.timeSlot.deleteMany({
        where: { id: timeSlotId, tutorId, type: "BUSY" },
      });
      if (removed.count === 0) {
        throw createRouteError(
          404,
          "TIME_SLOT_NOT_FOUND",
          "The requested busy time could not be found.",
        );
      }
    },
    async deleteAccount(auth0Id) {
      const profile = await prisma.profile.findUnique({
        where: { auth0Id },
        select: { id: true },
      });

      await deleteAuth0User(auth0Id);
      if (!profile) return;

      await prisma.$transaction(async (transaction) => {
        const allocations = await transaction.allocation.findMany({
          where: { tutorId: profile.id },
          select: { id: true },
        });
        const allocationIds = allocations.map(({ id }) => id);
        const overflowWork = await transaction.overflowWork.findMany({
          where: { sourceAllocationId: { in: allocationIds } },
          select: { id: true },
        });
        const overflowWorkIds = overflowWork.map(({ id }) => id);

        await transaction.volunteerClaim.deleteMany({
          where: {
            OR: [
              { studentId: profile.id },
              { overflowWorkId: { in: overflowWorkIds } },
            ],
          },
        });
        await transaction.overflowWork.deleteMany({
          where: { id: { in: overflowWorkIds } },
        });
        await transaction.excuse.deleteMany({ where: { tutorId: profile.id } });
        await transaction.workLog.deleteMany({ where: { tutorId: profile.id } });
        await transaction.timesheet.deleteMany({ where: { tutorId: profile.id } });
        await transaction.timesheet.updateMany({
          where: { reviewedById: profile.id },
          data: { reviewedById: null },
        });
        await transaction.allocation.deleteMany({ where: { tutorId: profile.id } });
        await transaction.timeSlot.deleteMany({ where: { tutorId: profile.id } });
        await transaction.tutorMark.deleteMany({ where: { tutorId: profile.id } });
        await transaction.tutorHourLimit.deleteMany({ where: { tutorId: profile.id } });
        await transaction.profile.delete({ where: { id: profile.id } });
      });
    },
  },
  (entry) => {
    console.info(JSON.stringify({ event: "http_request", ...entry }));
  },
);

app.listen(port, () => {
  console.log(`Tutor Mx API listening on http://localhost:${port}`);
});

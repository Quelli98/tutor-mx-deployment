import { saveManualSchedule } from "./services/manual-schedule.js";
import "dotenv/config";
import {
  createApp,
  createRouteError,
  type OrganiserApplicationSummary,
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
import { createAuth0RoleProvisioner, createAuth0UserDeleter, createAuth0UserReader, createAuth0VerificationEmailSender } from "./auth/management-api.js";
import { prisma, queryClient } from "./database.js";
import { createSouthAfricaPublicHolidayService } from "./integrations/public-holidays.js";
import {
  findAllocationCandidates,
  getTutorHourSummary,
  getTutorWorkloads,
} from "./services/allocation-queries.js";
import { createCourseService } from "./services/course-service.js";
import { createStaffingRequirementService } from "./services/staffing-requirement-service.js";
import { createOrganiserOverflowWorkService } from "./services/organiser-overflow-service.js";
import { createBulkAllocationService } from "./services/bulk-allocation-service.js";
import { createReportingService } from "./services/reporting-service.js";
import { createCommandCentreService } from "./services/command-centre-service.js";
import { payrollFilename, toPayrollCsv } from "./services/payroll-export.js";
import { allocationAttendance, attendanceSelection, sessionDay } from "./services/session-attendance.js";
import { createExcuseWorkflowService } from "./services/excuse-workflows.js";
import { createOrganiserService } from "./services/organiser-service.js";
import { createStudentWorkflowService } from "./services/student-workflows.js";
import { createTimesheetWorkflowService } from "./services/timesheet-workflows.js";
import { createTimesheetCorrectionsService } from "./services/timesheet-corrections.js";
import {
  createNotificationService,
  startDueReminderScheduler,
  type NotificationDataClient,
} from "./services/notification-service.js";
import {
  buildAllocationCancelledNotifications,
  buildAllocationNotifications,
  buildExcuseSubmittedNotifications,
  buildTimesheetDecisionNotifications,
  buildTimesheetDisputeResolvedNotifications,
  buildTimesheetDisputedNotifications,
  buildTimesheetSubmittedNotifications,
  buildVolunteerOutcomeNotifications,
  type NotificationEvent,
} from "./services/notifications.js";
import { createSearchService } from "./services/search-service.js";
import { createAcademicTermService, type AcademicTermPrismaClient } from "./services/academic-terms.js";
import { createTimetableImportService } from "./services/timetable-import-service.js";

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

const readAuth0User = auth0ManagementConfig
  ? createAuth0UserReader(auth0ManagementConfig)
  : async () => { throw new Error("Auth0 Management API user lookup is not configured"); };

// The resend-verification route fails closed when this is undefined (503), so it
// is only wired when Management API credentials are present.
const requestVerificationEmail = auth0ManagementConfig
  ? createAuth0VerificationEmailSender(auth0ManagementConfig)
  : undefined;

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

const courseSelect = {
  id: true,
  code: true,
  name: true,
  hourlyRate: true,
  budget: true,
} as const;

const organiserApplicationSelect = {
  id: true,
  auth0Id: true,
  email: true,
  fullName: true,
  status: true,
  motivation: true,
  reviewReason: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
  reviewer: {
    select: { id: true, email: true, fullName: true },
  },
} as const;

function toOrganiserApplicationSummary(application: {
  id: number;
  auth0Id: string;
  email: string;
  fullName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  motivation: string | null;
  reviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  reviewer: { id: number; email: string; fullName: string } | null;
}): OrganiserApplicationSummary {
  return {
    id: application.id,
    status: application.status,
    motivation: application.motivation,
    reviewReason: application.reviewReason,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
    reviewedAt: application.reviewedAt?.toISOString() ?? null,
    applicant: {
      email: application.email,
      fullName: application.fullName,
    },
    reviewer: application.reviewer,
  };
}

function toCourseSummary(course: {
  id: number;
  code: string;
  name: string;
  hourlyRate?: unknown;
  budget?: unknown;
}) {
  return {
    id: course.id,
    code: course.code,
    name: course.name,
    // Unset stays null: a course with no rate reports hours and no money.
    hourlyRate: course.hourlyRate === null || course.hourlyRate === undefined
      ? null
      : Number(course.hourlyRate),
    budget: course.budget === null || course.budget === undefined
      ? null
      : Number(course.budget),
  };
}

function toTutorSummary(profile: {
  id: number;
  email: string;
  fullName: string;
  role: string;
}, workload: Awaited<ReturnType<typeof getTutorWorkloads>>[number]) {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    role: normalizeTutorRole(profile.role) ?? "TUTOR",
    weeklyHours: workload.weeklyLimit,
    usedHours: workload.usedHours,
    remainingHours: workload.remainingHours,
    workedHours: workload.workedHours,
    weekStart: workload.weekStart,
    weekEnd: workload.weekEnd,
    capacityStatus: workload.capacityStatus,
  };
}

function toTimeSlotSummary(timeSlot: {
  id: number;
  type: "AVAILABLE" | "BUSY";
  startsAt: Date;
  endsAt: Date;
  recurrence: string | null;
  label: string | null;
  recurrenceUntil: Date | null;
  category?: string;
  seriesId?: string | null;
  termId?: number | null;
  term?: { teachingBreaks: unknown } | null;
  exceptions?: Array<{ occurrenceDate: Date; exceptionType: string; newStartsAt: Date | null; newEndsAt: Date | null }>;
}): TutorTimeSlotSummary {
  return {
    id: timeSlot.id,
    type: timeSlot.type,
    startsAt: timeSlot.startsAt.toISOString(),
    endsAt: timeSlot.endsAt.toISOString(),
    recurrence: timeSlot.recurrence === "WEEKLY" || timeSlot.recurrence === "FORTNIGHTLY" || timeSlot.recurrence === "ONCE"
      ? timeSlot.recurrence : null,
    label: timeSlot.label,
    recurrenceUntil: timeSlot.recurrenceUntil?.toISOString() ?? null,
    category: timeSlot.category ?? "UNAVAILABLE",
    seriesId: timeSlot.seriesId ?? null,
    termId: timeSlot.termId ?? null,
    teachingBreaks: Array.isArray(timeSlot.term?.teachingBreaks) ? timeSlot.term.teachingBreaks : [],
    exceptions: timeSlot.exceptions?.map((exception) => ({ ...exception, occurrenceDate: exception.occurrenceDate.toISOString().slice(0, 10), newStartsAt: exception.newStartsAt?.toISOString() ?? null, newEndsAt: exception.newEndsAt?.toISOString() ?? null })) ?? [],
  };
}

const timeSlotSelect = {
  id: true, type: true, startsAt: true, endsAt: true,
  recurrence: true, label: true, recurrenceUntil: true, category: true, seriesId: true,
  termId: true, term: { select: { teachingBreaks: true } }, exceptions: true,
} as const;

async function listTimeSlots(tutorId: number) {
  const timeSlots = await prisma.timeSlot.findMany({
    where: { tutorId },
    orderBy: { startsAt: "asc" },
    select: timeSlotSelect,
  });
  return timeSlots.map(toTimeSlotSummary);
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

async function findTutorProfileIdForAnyRole(auth0Id: string) {
  const profile = await prisma.profile.findUnique({
    where: { auth0Id },
    select: { id: true },
  });
  if (!profile) {
    throw createRouteError(404, "PROFILE_NOT_FOUND", "No CSAM Tutor Hub profile is linked to this account.");
  }
  return profile.id;
}

const studentWorkflowService = createStudentWorkflowService(
  prisma,
  queryClient,
);
const timesheetWorkflowService = createTimesheetWorkflowService(prisma);
// Corrections, declarations and disputes: the history that sits beside the
// existing timesheet state machine rather than replacing any of it.
const timesheetCorrectionsService = createTimesheetCorrectionsService(prisma);
const excuseWorkflowService = createExcuseWorkflowService(prisma);
const organiserService = createOrganiserService(prisma);
const courseService = createCourseService(prisma);
const staffingRequirementService = createStaffingRequirementService(
  prisma,
  queryClient,
);
// Overflow work: posted by hand, or converted from an unmet staffing
// requirement. It writes only OverflowWork, never an allocation, so absorbing
// a shortage here cannot reassign anybody's work.
const organiserOverflowService = createOrganiserOverflowWorkService(prisma);

// Built from a reader and a query client only. It is never handed the Prisma
// client, so preview has no way to write; saving goes through createAllocation
// below, which keeps its own transaction and rule checks.
// Reads only: built with the query client, never the Prisma client, so a report
// cannot change what it reports on.
const reportingService = createReportingService(queryClient);

const bulkAllocationService = createBulkAllocationService(
  queryClient,
  staffingRequirementService.listStaffingRequirements,
  async (organiserAuth0Id, input) => {
    const allocation = await organiserService.createAllocation(
      organiserAuth0Id,
      input,
    );
    await emitNotifications(
      buildAllocationNotifications(allocation, { created: true }),
    );
    return allocation;
  },
);

// Reads only, and reads the same services the screens behind it do: the
// Command Centre owns no figure of its own, it just puts them side by side for
// one period.
const commandCentreService = createCommandCentreService({
  listOpenStaffingRequirements: () =>
    staffingRequirementService.listStaffingRequirements({ status: "OPEN" }),
  workloadReport: reportingService.workloadReport,
  listApprovals: organiserService.listApprovals,
  listOverflowWork: organiserOverflowService.listOverflowWork,
  listOpenDisputes: timesheetCorrectionsService.listDisputes,
});

const publicHolidayService = createSouthAfricaPublicHolidayService();
const notificationService = createNotificationService(
  prisma as unknown as NotificationDataClient,
);
const searchService = createSearchService(queryClient);
const academicTermService = createAcademicTermService(prisma as unknown as AcademicTermPrismaClient);

// Writes only through one serializable transaction, so a half-imported
// timetable cannot be left behind when a later row fails its checks.
const timetableImportService = createTimetableImportService(prisma);

async function listOrganiserProfileIds() {
  const organisers = await prisma.profile.findMany({
    where: { role: "ORGANISER" },
    select: { id: true },
  });
  return (organisers ?? []).map(({ id }) => id);
}

async function emitNotifications(events: NotificationEvent[] | (() => Promise<NotificationEvent[]>)) {
  try {
    await notificationService.emit(typeof events === "function" ? await events() : events);
  } catch {
    console.error(JSON.stringify({
      event: "notification_error",
      message: "Background notification delivery failed.",
    }));
  }
}

/**
 * The organiser answerable for a sheet: whoever reviewed it last, or the whole
 * organiser group when nobody has yet. A dispute is addressed to the person who
 * made the decision where there is one, so it does not land on everybody's
 * queue.
 */
async function timesheetReviewerProfileIds(timesheetId: number) {
  const timesheet = await prisma.timesheet.findUnique({
    where: { id: timesheetId },
    select: { reviewedById: true },
  });
  if (timesheet?.reviewedById) {
    return [timesheet.reviewedById];
  }
  return listOrganiserProfileIds();
}

/**
 * Records the reason for a return once the decision itself is committed. Like
 * the notification beside it this is a side effect of a decision that has
 * already happened, so a failure is logged rather than turned into an error the
 * caller would read as "the decision failed" when it did not.
 */
async function recordTimesheetReturn(auth0Id: string, timesheetId: number) {
  try {
    await timesheetCorrectionsService.recordReturn(auth0Id, timesheetId);
  } catch {
    console.error(JSON.stringify({
      event: "timesheet_return_history_error",
      message: "Timesheet history verification failed.",
    }));
  }
}

startDueReminderScheduler(notificationService, {
  enabled: process.env.NODE_ENV !== "test" && process.env.DISABLE_REMINDER_SCHEDULER !== "true",
  intervalMs: Number(process.env.REMINDER_INTERVAL_MS ?? 6 * 60 * 60 * 1000),
  onError: () => {
    console.error(JSON.stringify({
      event: "notification_reminder_error",
      message: "Background notification delivery failed.",
    }));
  },
});

const app = createApp(
  async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  {
    corsOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    verifyAccessToken,
    requestPasswordReset,
    requestVerificationEmail,
    getPublicHolidays: (year) => publicHolidayService.execute(year),
    async findProfileByAuth0Id(auth0Id) {
      const organiserApplication = await prisma.organiserApplication.findUnique({
        where: { auth0Id },
        select: { status: true },
      });
      // A lecturer waiting for organiser approval is not a Student user. This
      // also safely blocks any profile left by the earlier student-based draft.
      if (organiserApplication && organiserApplication.status !== "APPROVED") return null;

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
    async search(auth0Id, query) {
      const profile = await prisma.profile.findUnique({
        where: { auth0Id },
        select: { id: true, role: true },
      });
      const role = normalizeTutorRole(profile?.role);
      if (!profile || !role) {
        throw createRouteError(404, "PROFILE_NOT_FOUND", "No CSAM Tutor Hub profile is linked to this account.");
      }
      return searchService.search({ id: profile.id, role }, query);
    },
    workloadReport: reportingService.workloadReport,
    async payrollExportCsv(query) {
      // The same human-checked rules the report counts with, written as the file
      // a payroll run reads. Held lines stay out of it entirely: this file is
      // what is owed, and the report is where the hold is visible.
      const exportRows = await reportingService.payrollExport(query);
      return {
        filename: payrollFilename(query),
        csv: toPayrollCsv(exportRows.rows),
      };
    },
    commandCentreSummary: commandCentreService.summary,
    previewBulkAllocations: bulkAllocationService.preview,
    commitBulkAllocations: bulkAllocationService.commit,
    listStaffingRequirements: staffingRequirementService.listStaffingRequirements,
    createStaffingRequirement: staffingRequirementService.createStaffingRequirement,
    updateStaffingRequirement: staffingRequirementService.updateStaffingRequirement,
    setStaffingRequirementStatus: staffingRequirementService.setStaffingRequirementStatus,
    listOrganiserOverflowWork: organiserOverflowService.listOverflowWork,
    createOrganiserOverflowWork: organiserOverflowService.createOverflowWork,
    updateOrganiserOverflowWork: organiserOverflowService.updateOverflowWork,
    closeOrganiserOverflowWork: organiserOverflowService.closeOverflowWork,
    listAcademicTerms: academicTermService.list,
    listPublishedAcademicTerms: academicTermService.listPublished,
    createAcademicTerm: academicTermService.create,
    updateAcademicTerm: academicTermService.update,
    deleteAcademicTerm: academicTermService.remove,
    previewTutorTimetableImport: timetableImportService.preview,
    commitTutorTimetableImport: timetableImportService.commit,
    async onboardUser(auth0Id, role) {
      if (role === "ORGANISER") {
        throw createRouteError(400, "ORGANISER_REGISTRATION_REQUIRED", "Organisers must register for lecturer approval before access is granted.");
      }

      const organiserApplication = await prisma.organiserApplication.findUnique({
        where: { auth0Id },
        select: { status: true },
      });
      if (organiserApplication) {
        throw createRouteError(409, "ORGANISER_APPLICATION_EXISTS", "This account is already registered for organiser approval.");
      }

      const existing = await prisma.profile.findUnique({
        where: { auth0Id },
        select: { id: true, email: true, fullName: true, role: true },
      });
      if (existing) {
        const existingRole = normalizeTutorRole(existing.role);
        if (!existingRole) {
          throw createRouteError(409, "ROLE_ALREADY_SET", "This CSAM Tutor Hub account already has a different role.");
        }

        if (existingRole !== role) {
          throw createRouteError(409, "ROLE_ALREADY_SET", "This CSAM Tutor Hub account already has a different role.");
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
          throw createRouteError(409, "PROFILE_CONFLICT", "This email or Auth0 account is already linked to another CSAM Tutor Hub profile.");
        }
        throw error;
      }
    },
    async registerOrganiserApplication(auth0Id) {
      const identity = await readAuth0User(auth0Id);
      if (!identity.emailVerified) {
        throw createRouteError(403, "EMAIL_NOT_VERIFIED", "Verify your lecturer email address, then try again.");
      }

      const existing = await prisma.organiserApplication.findFirst({
        where: { OR: [{ auth0Id }, { email: identity.email }] },
        select: organiserApplicationSelect,
      });
      if (existing) {
        if (existing.auth0Id !== auth0Id || existing.email !== identity.email) {
          throw createRouteError(409, "ORGANISER_APPLICATION_CONFLICT", "This lecturer email is already linked to another organiser registration.");
        }
        return toOrganiserApplicationSummary(existing);
      }

      const existingProfile = await prisma.profile.findFirst({
        where: { OR: [{ auth0Id }, { email: identity.email }] },
        select: { id: true, role: true },
      });
      if (existingProfile) {
        throw createRouteError(409, "ROLE_ALREADY_SET", "This account is already linked to an existing Tutor MX role. Organiser registration is for lecturer organiser accounts, not Student or Tutor accounts.");
      }

      try {
        const application = await prisma.organiserApplication.create({
          data: {
            auth0Id,
            email: identity.email,
            fullName: identity.fullName,
          },
          select: organiserApplicationSelect,
        });
        return toOrganiserApplicationSummary(application);
      } catch (error) {
        if (isPrismaErrorCode(error, "P2002")) {
          throw createRouteError(409, "ORGANISER_APPLICATION_CONFLICT", "This lecturer email already has an organiser registration.");
        }
        throw error;
      }
    },
    async getOwnOrganiserApplication(auth0Id) {
      const application = await prisma.organiserApplication.findUnique({
        where: { auth0Id },
        select: organiserApplicationSelect,
      });
      return application ? toOrganiserApplicationSummary(application) : null;
    },
    async getOrganiserApplicationStatusByEmail(email) {
      const application = await prisma.organiserApplication.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { status: true },
      });
      return application?.status ?? "NOT_FOUND";
    },
    async listOrganiserApplications() {
      const applications = await prisma.organiserApplication.findMany({
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        select: organiserApplicationSelect,
      });
      return applications.map(toOrganiserApplicationSummary);
    },
    async approveOrganiserApplication(reviewerAuth0Id, applicationId) {
      const reviewer = await prisma.profile.findUnique({
        where: { auth0Id: reviewerAuth0Id },
        select: { id: true, role: true },
      });
      if (!reviewer || reviewer.role !== "ORGANISER") {
        throw createRouteError(403, "FORBIDDEN", "Only an organiser can review organiser applications.");
      }

      const application = await prisma.organiserApplication.findUnique({
        where: { id: applicationId },
        select: organiserApplicationSelect,
      });
      if (!application) {
        throw createRouteError(404, "ORGANISER_APPLICATION_NOT_FOUND", "The organiser application could not be found.");
      }
      if (application.status !== "PENDING") {
        throw createRouteError(409, "ORGANISER_APPLICATION_ALREADY_REVIEWED", "This organiser application has already been reviewed.");
      }

      // Auth0 is the authorization source of truth. Grant ORGANISER only after
      // the Master Organiser approves the lecturer registration.
      const identity = await provisionAuth0Role(application.auth0Id, "ORGANISER");
      if (!identity.emailVerified) {
        throw createRouteError(409, "APPLICANT_EMAIL_NOT_VERIFIED", "The applicant must verify their email before approval.");
      }
      if (identity.email !== application.email) {
        throw createRouteError(409, "APPLICANT_EMAIL_CHANGED", "The Auth0 email no longer matches this organiser registration.");
      }

      const updated = await prisma.$transaction(async (transaction) => {
        const claimed = await transaction.organiserApplication.updateMany({
          where: { id: applicationId, status: "PENDING" },
          data: {
            status: "APPROVED",
            reviewReason: null,
            reviewedAt: new Date(),
            reviewerProfileId: reviewer.id,
          },
        });
        if (claimed.count !== 1) {
          throw createRouteError(409, "ORGANISER_APPLICATION_ALREADY_REVIEWED", "This organiser application has already been reviewed.");
        }

        const existingProfile = await transaction.profile.findFirst({
          where: { OR: [{ auth0Id: application.auth0Id }, { email: application.email }] },
          select: { id: true, auth0Id: true, email: true, role: true },
        });
        if (existingProfile) {
          if (existingProfile.auth0Id !== application.auth0Id || existingProfile.email !== application.email) {
            throw createRouteError(409, "PROFILE_CONFLICT", "This lecturer email is already linked to another Tutor MX account.");
          }
          // Compatibility with the earlier student-based draft: if such a row
          // exists, convert it to the intended lecturer Organiser account.
          if (existingProfile.role !== "ORGANISER" && existingProfile.role !== "STUDENT") {
            throw createRouteError(409, "ROLE_ALREADY_SET", "This account is already linked to a different Tutor MX role.");
          }
          await transaction.profile.update({
            where: { id: existingProfile.id },
            data: { role: "ORGANISER", fullName: application.fullName },
          });
        } else {
          await transaction.profile.create({
            data: {
              auth0Id: application.auth0Id,
              email: application.email,
              fullName: application.fullName,
              role: "ORGANISER",
            },
          });
        }
        return transaction.organiserApplication.findUniqueOrThrow({
          where: { id: applicationId },
          select: organiserApplicationSelect,
        });
      });
      return toOrganiserApplicationSummary(updated);
    },
    async rejectOrganiserApplication(reviewerAuth0Id, applicationId, reviewReason) {
      const reviewer = await prisma.profile.findUnique({
        where: { auth0Id: reviewerAuth0Id },
        select: { id: true, role: true },
      });
      if (!reviewer || reviewer.role !== "ORGANISER") {
        throw createRouteError(403, "FORBIDDEN", "Only an organiser can review organiser applications.");
      }

      const claimed = await prisma.organiserApplication.updateMany({
        where: { id: applicationId, status: "PENDING" },
        data: {
          status: "REJECTED",
          reviewReason,
          reviewedAt: new Date(),
          reviewerProfileId: reviewer.id,
        },
      });
      if (claimed.count !== 1) {
        const exists = await prisma.organiserApplication.findUnique({ where: { id: applicationId }, select: { id: true } });
        if (!exists) {
          throw createRouteError(404, "ORGANISER_APPLICATION_NOT_FOUND", "The organiser application could not be found.");
        }
        throw createRouteError(409, "ORGANISER_APPLICATION_ALREADY_REVIEWED", "This organiser application has already been reviewed.");
      }
      const updated = await prisma.organiserApplication.findUniqueOrThrow({
        where: { id: applicationId },
        select: organiserApplicationSelect,
      });
      return toOrganiserApplicationSummary(updated);
    },
    async listCourses() {
      const courses = await prisma.course.findMany({
        orderBy: { code: "asc" },
        select: courseSelect,
      });
      return courses.map(toCourseSummary);
    },
    async createCourse(input) {
      try {
        const course = await prisma.course.create({
          data: {
            code: input.code,
            name: input.name,
            ...(input.hourlyRate === undefined ? {} : { hourlyRate: input.hourlyRate }),
            ...(input.budget === undefined ? {} : { budget: input.budget }),
          },
          select: courseSelect,
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
            ...(input.hourlyRate === undefined ? {} : { hourlyRate: input.hourlyRate }),
            ...(input.budget === undefined ? {} : { budget: input.budget }),
          },
          select: courseSelect,
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
      // The dedicated service inspects every dependent record inside a
      // transaction, deletes only disposable children, and raises a public
      // COURSE_DELETE_CONFLICT (or COURSE_NOT_FOUND) route error. Any surprise
      // Prisma failure stays unmapped and is reported as a generic 500 so raw
      // database detail never reaches the client.
      await courseService.deleteCourse(courseId);
    },
    async listTutors(weekStart?: Date) {
      const tutors = await prisma.profile.findMany({
        where: { role: "TUTOR" },
        orderBy: { fullName: "asc" },
        select: { id: true, email: true, fullName: true, role: true },
      });
      const workloads = await getTutorWorkloads(queryClient, weekStart ?? mondayUtcFor(new Date()));
      const byTutorId = new Map(workloads.map((workload) => [workload.tutorId, workload]));
      return tutors.map((tutor) => {
        const workload = byTutorId.get(tutor.id);
        if (!workload) throw new Error("Tutor workload is unavailable");
        return toTutorSummary(tutor, workload);
      });
    },
    async updateTutorWeeklyCapacity(auth0Id, input) {
      const tutorId = await findTutorProfileId(auth0Id);
      if (input.weeklyHours === null) {
        await prisma.tutorHourLimit.deleteMany({ where: { tutorId } });
        return { weeklyHours: null };
      }
      const limit = await prisma.tutorHourLimit.upsert({
        where: { tutorId },
        create: { tutorId, weeklyHours: input.weeklyHours },
        update: { weeklyHours: input.weeklyHours },
        select: { weeklyHours: true },
      });
      return { weeklyHours: Number(limit.weeklyHours) };
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
              excuses: { select: attendanceSelection },
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
      const countTimeSlots = (prisma.timeSlot as typeof prisma.timeSlot & {
        count?: (args: { where: { tutorId: number; recurrence: { not: null } } }) => Promise<number>;
      }).count;
      const hasSchedule = countTimeSlots
        ? (await countTimeSlots.call(prisma.timeSlot, { where: { tutorId: profile.id, recurrence: { not: null } } })) > 0
        : undefined;

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
            allocationAttendance(allocation.excuses).workLogEligible &&
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
          ...allocationAttendance(allocation.excuses),
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
        ...(hasSchedule === undefined ? {} : { hasSchedule }),
      };
    },
    async createTutorTimeSlot(auth0Id, input) {
      const tutorId = await findTutorProfileId(auth0Id);
      try {
        const timeSlot = await saveManualSchedule(prisma, tutorId, input);
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
        select: { id: true, startsAt: true, endsAt: true, status: true, excuses: { select: attendanceSelection } },
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
        !allocationAttendance(allocation.excuses).workLogEligible ||
        sessionDay(allocation.startsAt) !== input.workDate
      ) {
        throw createRouteError(
          409,
          "WORK_LOG_CONFLICT",
          "Worked hours must match a confirmed session owned by the tutor without an approved sick excuse.",
        );
      }
      if (new Date() <= allocation.endsAt) {
        throw createRouteError(
          400,
          "SESSION_NOT_ENDED",
          "Worked hours can only be logged after the session has ended.",
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
          isPrismaErrorCode(error, "P2004") || isPrismaErrorCode(error, "P2039")
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
        },
        select: { id: true },
      });
      if (!allocation) {
        throw createRouteError(
          404,
          "ALLOCATION_NOT_FOUND",
          "The assigned confirmed session could not be found.",
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
        const organiserIds = await listOrganiserProfileIds();
        await emitNotifications(buildExcuseSubmittedNotifications(excuse, organiserIds));
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
    async listNotifications(auth0Id, query) {
      return notificationService.list(await findTutorProfileIdForAnyRole(auth0Id), query);
    },
    async countUnreadNotifications(auth0Id) {
      return notificationService.unreadCount(await findTutorProfileIdForAnyRole(auth0Id));
    },
    async markNotificationRead(auth0Id, notificationId) {
      return notificationService.markRead(await findTutorProfileIdForAnyRole(auth0Id), notificationId);
    },
    async getNotification(auth0Id, notificationId) {
      return notificationService.getNotification(await findTutorProfileIdForAnyRole(auth0Id), notificationId);
    },
    async markAllNotificationsRead(auth0Id) {
      return notificationService.markAllRead(await findTutorProfileIdForAnyRole(auth0Id));
    },
    async runDueReminders() {
      return notificationService.runDueReminders(new Date());
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
    async submitTutorTimesheet(auth0Id, timesheetId) {
      // Resubmitting a returned timesheet needs an acknowledgement that covers
      // the corrected figures. Reported here in the caller's terms; the database
      // trigger enforces the same rule for anything that skips this check.
      await timesheetCorrectionsService.assertResubmissionReady(
        auth0Id,
        timesheetId,
      );
      const result = await timesheetWorkflowService.submit(auth0Id, timesheetId);
      await emitNotifications(
        async () => buildTimesheetSubmittedNotifications(result, await listOrganiserProfileIds()),
      );
      return result;
    },
    getTutorTimesheetHistory: timesheetCorrectionsService.history,
    correctTutorTimesheetWorkLog: timesheetCorrectionsService.correctWorkLog,
    declareTutorTimesheet: timesheetCorrectionsService.declare,
    async raiseTutorTimesheetDispute(auth0Id, timesheetId, input) {
      const dispute = await timesheetCorrectionsService.raiseDispute(
        auth0Id,
        timesheetId,
        input,
      );
      await emitNotifications(
        async () => buildTimesheetDisputedNotifications(
          dispute,
          await timesheetReviewerProfileIds(dispute.timesheetId),
        ),
      );
      return dispute;
    },
    listTimesheetDisputes: timesheetCorrectionsService.listDisputes,
    async resolveTimesheetDispute(auth0Id, disputeId, input) {
      const dispute = await timesheetCorrectionsService.resolveDispute(
        auth0Id,
        disputeId,
        input,
      );
      await emitNotifications(buildTimesheetDisputeResolvedNotifications(dispute));
      return dispute;
    },
    getTutorExcuseStatus: excuseWorkflowService.getStatus,
    decideExcuse: excuseWorkflowService.decide,
    async listAllocationCandidates(input) {
      const candidates = await findAllocationCandidates(queryClient, input);
      return candidates.map((candidate) => ({
        tutorId: candidate.tutorId,
        fullName: candidate.fullName,
        mark: candidate.mark ?? 0,
        weeklyLimit: candidate.weeklyLimit,
        usedHours: candidate.usedHours,
        remainingHours: candidate.remainingHours,
        hasClash: candidate.hasClash,
        isEligible: candidate.isEligible,
        reasonCodes: candidate.reasonCodes,
        clashDetails: candidate.clashDetails,
        markBand: candidate.markBand,
        capacityShare: candidate.capacityShare,
      }));
    },
    listOrganiserAllocations: organiserService.listAllocations,
    listOrganiserApprovals: organiserService.listApprovals,
    async createAllocation(auth0Id, input) {
      const result = await organiserService.createAllocation(auth0Id, input);
      await emitNotifications(buildAllocationNotifications(result, { created: true }));
      return result;
    },
    async updateAllocation(auth0Id, allocationId, input) {
      const result = await organiserService.updateAllocation(auth0Id, allocationId, input);
      await emitNotifications(buildAllocationNotifications(result, { created: false }));
      return result;
    },
    async removeAllocation(auth0Id, allocationId) {
      const result = await organiserService.removeAllocation(auth0Id, allocationId);
      if (result) {
        await emitNotifications(buildAllocationCancelledNotifications(result));
      }
      return result;
    },
    async decideTimesheet(auth0Id, timesheetId, input) {
      const result = await organiserService.decideTimesheet(auth0Id, timesheetId, input);
      if (result.status === "RETURNED") {
        // Recorded before the notification, because a resubmission clears the
        // reason from the sheet itself and this row is then all that is left of
        // it.
        await recordTimesheetReturn(auth0Id, timesheetId);
      }
      await emitNotifications(buildTimesheetDecisionNotifications(result));
      return result;
    },
    async decideVolunteerClaim(claimId, input) {
      const result = await organiserService.decideVolunteerClaim(claimId, input);
      await emitNotifications(buildVolunteerOutcomeNotifications(result));
      return result;
    },
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
    listTutorTimeSlots: listTimeSlots,
    async listOwnTutorTimeSlots(auth0Id) {
      return listTimeSlots(await findTutorProfileId(auth0Id));
    },
    async updateTutorTimeSlot(auth0Id, timeSlotId, input) {
      const tutorId = await findTutorProfileId(auth0Id);
      try {
        const timeSlot = await saveManualSchedule(prisma, tutorId, input, timeSlotId);
        return toTimeSlotSummary(timeSlot);
      } catch (error) {
        if (isPrismaErrorCode(error, "P2025")) {
          throw createRouteError(404, "TIME_SLOT_NOT_FOUND", "The requested time slot could not be found.");
        }
        if (isPrismaErrorCode(error, "P2003") || isPrismaErrorCode(error, "P2004")) {
          throw createRouteError(409, "TIME_SLOT_CONFLICT", "The time slot conflicts with tutor data rules.");
        }
        throw error;
      }
    },
    async deleteTutorTimeSlot(auth0Id, timeSlotId) {
      const tutorId = await findTutorProfileId(auth0Id);
      const removed = await prisma.timeSlot.deleteMany({
        where: { id: timeSlotId, tutorId },
      });
      if (removed.count === 0) {
        throw createRouteError(404, "TIME_SLOT_NOT_FOUND", "The requested time slot could not be found.");
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
        // Correction history references the work logs and the timesheet it
        // describes, so it is removed with them. The tutor's own rows go first,
        // then any line this profile wrote or answered on someone else's sheet:
        // the history stays and only the identity is cleared, the same rule this
        // transaction already applies to a timesheet's reviewer.
        await transaction.timesheetRevision.deleteMany({
          where: { tutorId: profile.id },
        });
        await transaction.timesheetDeclaration.deleteMany({
          where: { tutorId: profile.id },
        });
        await transaction.timesheetDispute.deleteMany({
          where: { tutorId: profile.id },
        });
        await transaction.timesheetRevision.updateMany({
          where: { authorProfileId: profile.id },
          data: { authorProfileId: null },
        });
        await transaction.timesheetDispute.updateMany({
          where: { resolvedByProfileId: profile.id },
          data: { resolvedByProfileId: null },
        });
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

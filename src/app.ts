import express, { type Express } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import {
  TUTOR_ROLES,
  type AccessTokenVerifier,
  type TutorRole,
} from "./auth/contract.js";
import {
  createAuthenticationMiddleware,
  createProfileRoleMiddleware,
  requireRole,
  type AuthenticatedRequest,
} from "./auth/middleware.js";
import type { PasswordResetRequester } from "./auth/password-reset.js";

type ReadinessCheck = () => Promise<void>;

export interface ApiRequestLog {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export type RequestLogger = (entry: ApiRequestLog) => void;

export interface CourseSummary {
  id: number;
  code: string;
  name: string;
}

export interface TutorSummary {
  id: number;
  auth0Id: string;
  email: string;
  fullName: string;
  role: TutorRole;
  weeklyHours: number | null;
}

export interface CourseWriteInput {
  code: string;
  name: string;
}

export interface TutorWriteInput {
  auth0Id: string;
  email: string;
  fullName: string;
  weeklyHours?: number;
}

export interface TutorUpdateInput {
  email?: string;
  fullName?: string;
  weeklyHours?: number;
}

export interface TutorAllocationSummary {
  id: number;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  allocatedHours: number;
  status: "PROPOSED" | "CONFIRMED";
}

export interface TutorDashboardSummary {
  allocations: TutorAllocationSummary[];
  weeklyLimit: number | null;
  usedHours: number;
  remainingHours: number | null;
}

export interface TutorTimeSlotWriteInput {
  type: "AVAILABLE" | "BUSY";
  startsAt: Date;
  endsAt: Date;
  recurrence?: "WEEKLY";
}

export interface TutorTimeSlotSummary {
  id: number;
  type: "AVAILABLE" | "BUSY";
  startsAt: string;
  endsAt: string;
  recurrence: "WEEKLY" | null;
}

export interface TutorWorkLogWriteInput {
  allocationId: number;
  workDate: string;
  hours: number;
  description: string;
}

export interface TutorWorkLogSummary extends TutorWorkLogWriteInput {
  id: number;
  timesheetId: number;
}

export interface TutorExcuseWriteInput {
  allocationId: number;
  reason: string;
}

export interface TutorExcuseSummary extends TutorExcuseWriteInput {
  id: number;
  status: "PENDING";
}

export type AllocationReasonCode =
  | "insufficient-mark"
  | "schedule-clash"
  | "hour-limit-exceeded";

export interface AllocationCandidateSummary {
  tutorId: number;
  fullName: string;
  mark: number;
  weeklyLimit: number;
  usedHours: number;
  remainingHours: number;
  hasClash: boolean;
  isEligible: boolean;
  reasonCodes: AllocationReasonCode[];
}

export interface AllocationCandidateQuery {
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  minimumMark: number;
  requestedHours: number;
}

export interface TutorMarkWriteInput {
  courseId: number;
  mark: number;
}

export interface TutorMarkSummary {
  id: number;
  courseId: number;
  courseCode: string;
  courseName: string;
  mark: number;
}

export interface ProfileSummary {
  id: number;
  email: string;
  fullName: string;
  role: TutorRole;
}

export interface RouteError extends Error {
  status: number;
  code: string;
}

export interface AppDependencies {
  corsOrigin?: string;
  findProfileByAuth0Id: (auth0Id: string) => Promise<ProfileSummary | null>;
  onboardUser: (auth0Id: string, role: TutorRole) => Promise<ProfileSummary>;
  allowSelfServiceOrganiser?: boolean;
  listCourses: () => Promise<CourseSummary[]>;
  createCourse: (input: CourseWriteInput) => Promise<CourseSummary>;
  updateCourse: (
    courseId: number,
    input: CourseWriteInput,
  ) => Promise<CourseSummary>;
  deleteCourse: (courseId: number) => Promise<void>;
  listTutors: () => Promise<TutorSummary[]>;
  createTutor: (input: TutorWriteInput) => Promise<TutorSummary>;
  updateTutor: (
    tutorId: number,
    input: TutorUpdateInput,
  ) => Promise<TutorSummary>;
  getTutorDashboard: (auth0Id: string) => Promise<TutorDashboardSummary>;
  createTutorTimeSlot: (
    auth0Id: string,
    input: TutorTimeSlotWriteInput,
  ) => Promise<TutorTimeSlotSummary>;
  createTutorWorkLog: (
    auth0Id: string,
    input: TutorWorkLogWriteInput,
  ) => Promise<TutorWorkLogSummary>;
  createTutorExcuse: (
    auth0Id: string,
    input: TutorExcuseWriteInput,
  ) => Promise<TutorExcuseSummary>;
  listAllocationCandidates: (
    input: AllocationCandidateQuery,
  ) => Promise<AllocationCandidateSummary[]>;
  upsertTutorMark: (
    tutorId: number,
    input: TutorMarkWriteInput,
  ) => Promise<TutorMarkSummary>;
  listTutorMarks: (tutorId: number) => Promise<TutorMarkSummary[]>;
  listTutorTimeSlots: (tutorId: number) => Promise<TutorTimeSlotSummary[]>;
  createTutorTimeSlotForTutor: (
    tutorId: number,
    input: TutorTimeSlotWriteInput,
  ) => Promise<TutorTimeSlotSummary>;
  requestPasswordReset: PasswordResetRequester;
  deleteAccount?: (auth0Id: string) => Promise<void>;
  verifyAccessToken: AccessTokenVerifier;
}

/* v8 ignore start -- configuration-only fail-closed stubs; route behavior is tested with injected dependencies */
const unavailableDependencies: AppDependencies = {
  async findProfileByAuth0Id() {
    throw new Error("Authentication is not configured");
  },
  async onboardUser() {
    throw new Error("Self-service onboarding is not configured");
  },
  async listCourses() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async createCourse() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async updateCourse() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async deleteCourse() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async listTutors() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async createTutor() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async updateTutor() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async getTutorDashboard() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async createTutorTimeSlot() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async createTutorWorkLog() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async createTutorExcuse() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async listAllocationCandidates() {
    throw new Error("Allocation candidate endpoint is not configured");
  },
  async upsertTutorMark() {
    throw new Error("Tutor mark endpoint is not configured");
  },
  async listTutorMarks() {
    throw new Error("Tutor mark endpoint is not configured");
  },
  async listTutorTimeSlots() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async createTutorTimeSlotForTutor() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async deleteAccount() {
    throw new Error("Account deletion is not configured");
  },
  async requestPasswordReset() {
    throw new Error("Authentication is not configured");
  },
  async verifyAccessToken() {
    throw new Error("Authentication is not configured");
  },
};
/* v8 ignore stop */

function isValidEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function error(status: number, code: string, message: string) {
  return { status, body: { error: { code, message } } };
}

export function createRouteError(
  status: number,
  code: string,
  message: string,
): RouteError {
  const routeError = new Error(message) as RouteError;
  routeError.status = status;
  routeError.code = code;
  return routeError;
}

function isRouteError(value: unknown): value is RouteError {
  return (
    typeof value === "object" &&
    value !== null &&
    value instanceof Error &&
    "status" in value &&
    typeof (value as RouteError).status === "number" &&
    "code" in value &&
    typeof (value as RouteError).code === "string"
  );
}

function sendRouteError(response: express.Response, value: unknown) {
  if (isRouteError(value)) {
    response.status(value.status).json({
      error: {
        code: value.code,
        message: value.message,
      },
    });
    return;
  }

  const result = error(
    500,
    "INTERNAL_ERROR",
    "The request could not be completed.",
  );
  response.status(result.status).json(result.body);
}

function parseRequiredText(
  value: unknown,
  _fieldName: string,
  maxLength = 255,
) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }

  return trimmed;
}

function parseOptionalWeeklyHours(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 168) {
    return null;
  }

  return numeric;
}

function parseCourseInput(body: unknown) {
  const payload = body as { code?: unknown; name?: unknown } | null;
  const code = parseRequiredText(payload?.code, "code", 50);
  const name = parseRequiredText(payload?.name, "name", 120);

  if (!code || !name) {
    return { error: "Enter a valid course code and name." } as const;
  }

  return { value: { code, name } } as const;
}

function parseTutorCreateInput(body: unknown) {
  const payload = body as {
    auth0Id?: unknown;
    email?: unknown;
    fullName?: unknown;
    weeklyHours?: unknown;
  } | null;
  const auth0Id = parseRequiredText(payload?.auth0Id, "auth0Id", 100);
  const email = parseRequiredText(payload?.email, "email", 254);
  const fullName = parseRequiredText(payload?.fullName, "fullName", 120);
  const weeklyHours = parseOptionalWeeklyHours(payload?.weeklyHours);

  if (
    !auth0Id ||
    !email ||
    !isValidEmail(email) ||
    !fullName ||
    weeklyHours === null
  ) {
    return {
      error:
        "Enter an Auth0 subject, email, full name and a valid weekly-hours value.",
    } as const;
  }

  const value: TutorWriteInput = {
    auth0Id,
    email,
    fullName,
  };

  if (weeklyHours !== undefined) {
    value.weeklyHours = weeklyHours;
  }

  return { value } as const;
}

function parseTutorUpdateInput(body: unknown) {
  const payload = body as {
    email?: unknown;
    fullName?: unknown;
    weeklyHours?: unknown;
  } | null;
  const email =
    payload?.email === undefined
      ? undefined
      : parseRequiredText(payload.email, "email", 254);
  const fullName =
    payload?.fullName === undefined
      ? undefined
      : parseRequiredText(payload.fullName, "fullName", 120);
  const weeklyHours = parseOptionalWeeklyHours(payload?.weeklyHours);

  if (
    (payload?.email !== undefined &&
      (email === null || !isValidEmail(email))) ||
    (payload?.fullName !== undefined && fullName === null) ||
    weeklyHours === null ||
    (payload?.email === undefined &&
      payload?.fullName === undefined &&
      payload?.weeklyHours === undefined)
  ) {
    return {
      error: "Provide at least one valid tutor field to update.",
    } as const;
  }

  const value: TutorUpdateInput = {};

  if (email !== undefined && email !== null) {
    value.email = email;
  }
  if (fullName !== undefined && fullName !== null) {
    value.fullName = fullName;
  }
  if (weeklyHours !== undefined) {
    value.weeklyHours = weeklyHours;
  }

  return { value } as const;
}

function parseIsoDateTime(value: unknown) {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function parseDateOnly(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function parsePositiveInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function parseTutorTimeSlotInput(body: unknown) {
  const payload = body as {
    type?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
    recurrence?: unknown;
  } | null;
  const type = payload?.type;
  const startsAt = parseIsoDateTime(payload?.startsAt);
  const endsAt = parseIsoDateTime(payload?.endsAt);
  const recurrence =
    payload?.recurrence === undefined ||
    payload?.recurrence === null ||
    payload?.recurrence === ""
      ? undefined
      : typeof payload.recurrence === "string"
        ? payload.recurrence.trim().toUpperCase()
        : null;

  if (
    (type !== "AVAILABLE" && type !== "BUSY") ||
    !startsAt ||
    !endsAt ||
    endsAt <= startsAt ||
    (recurrence !== undefined && recurrence !== "WEEKLY")
  ) {
    return {
      error:
        "Enter a valid slot type, start, end and supported recurrence.",
    } as const;
  }

  const value: TutorTimeSlotWriteInput = { type, startsAt, endsAt };
  if (recurrence === "WEEKLY") {
    value.recurrence = recurrence;
  }
  return { value } as const;
}

function parseTutorWorkLogInput(body: unknown) {
  const payload = body as {
    allocationId?: unknown;
    workDate?: unknown;
    hours?: unknown;
    description?: unknown;
  } | null;
  const allocationId = parsePositiveInteger(payload?.allocationId);
  const workDate = parseDateOnly(payload?.workDate);
  const hours = Number(payload?.hours);
  const description = parseRequiredText(
    payload?.description,
    "description",
    500,
  );

  if (
    !allocationId ||
    !workDate ||
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 24 ||
    !description
  ) {
    return {
      error:
        "Select a valid session and enter its date, 0-24 worked hours and a description.",
    } as const;
  }

  return {
    value: { allocationId, workDate, hours, description },
  } as const;
}

function parseTutorExcuseInput(body: unknown) {
  const payload = body as {
    allocationId?: unknown;
    reason?: unknown;
  } | null;
  const allocationId = parsePositiveInteger(payload?.allocationId);
  const reason = parseRequiredText(payload?.reason, "reason", 1000);

  if (!allocationId || !reason) {
    return {
      error: "Select an assigned session and enter a valid reason.",
    } as const;
  }

  return { value: { allocationId, reason } } as const;
}

function firstQueryParam(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parseMarkValue(value: unknown) {
  const normalized = firstQueryParam(value);
  if (
    normalized === null ||
    normalized === undefined ||
    typeof normalized === "boolean" ||
    (typeof normalized === "string" && normalized.trim() === "")
  ) {
    return null;
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return null;
  }
  return numeric;
}

function parseRequestedHours(value: unknown) {
  const numeric = Number(firstQueryParam(value));
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 24) {
    return null;
  }
  return numeric;
}

function parseAllocationCandidateQuery(query: unknown) {
  const params = (query ?? {}) as {
    courseId?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
    minimumMark?: unknown;
    requestedHours?: unknown;
  };
  const courseId = parsePositiveInteger(firstQueryParam(params.courseId));
  const startsAt = parseIsoDateTime(firstQueryParam(params.startsAt));
  const endsAt = parseIsoDateTime(firstQueryParam(params.endsAt));
  const minimumMark = parseMarkValue(params.minimumMark);
  const requestedHours = parseRequestedHours(params.requestedHours);

  if (
    !courseId ||
    !startsAt ||
    !endsAt ||
    endsAt <= startsAt ||
    minimumMark === null ||
    requestedHours === null
  ) {
    return {
      error:
        "Enter a valid course, start/end time, minimum mark (0-100) and requested hours.",
    } as const;
  }

  return {
    value: { courseId, startsAt, endsAt, minimumMark, requestedHours },
  } as const;
}

function parseTutorMarkInput(body: unknown) {
  const payload = body as { courseId?: unknown; mark?: unknown } | null;
  const courseId = parsePositiveInteger(payload?.courseId);
  const mark = parseMarkValue(payload?.mark);

  if (!courseId || mark === null) {
    return {
      error: "Select a course and enter a valid mark (0-100).",
    } as const;
  }

  return { value: { courseId, mark } } as const;
}

function parseNumericId(
  value: string | string[] | undefined,
  resourceName: string,
) {
  const resolved = Array.isArray(value) ? value[0] : value;
  const numeric = Number(resolved);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return {
      error: `${resourceName} identifier must be a positive whole number.`,
    } as const;
  }

  return { value: numeric } as const;
}

function currentProfileRoute(
  dependencies: AppDependencies,
  request: express.Request,
  response: express.Response,
) {
  return (async () => {
    const auth = (request as AuthenticatedRequest).auth!;
    const profile = await dependencies.findProfileByAuth0Id(auth.subject);

    if (!profile) {
      const result = error(
        404,
        "PROFILE_NOT_FOUND",
        "No Tutor Mx profile is linked to this account.",
      );
      response.status(result.status).json(result.body);
      return;
    }

    if (profile.role !== auth.role) {
      const result = error(
        403,
        "ROLE_MISMATCH",
        "Your account permissions are out of date. Sign in again or contact support.",
      );
      response.status(result.status).json(result.body);
      return;
    }

    response.status(200).json({ data: { profile } });
  })().catch((value) => sendRouteError(response, value));
}

export function createApp(
  checkReadiness: ReadinessCheck,
  dependencies: AppDependencies = unavailableDependencies,
  requestLogger?: RequestLogger,
): Express {
  const app = express();
  const authenticate = createAuthenticationMiddleware(
    dependencies.verifyAccessToken,
  );
  const resolveProfileRole = createProfileRoleMiddleware(dependencies.findProfileByAuth0Id);
  const requireTutorMxRole = requireRole(...TUTOR_ROLES);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  const sensitiveAuthLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  if (requestLogger) {
    app.use((request, response, next) => {
      const startedAt = process.hrtime.bigint();

      response.on("finish", () => {
        requestLogger({
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        });
      });

      next();
    });
  }

  app.use(express.json({ limit: "32kb" }));

  const corsOrigin = dependencies.corsOrigin;
  if (corsOrigin) {
    app.use((request, response, next) => {
      if (request.header("origin") === corsOrigin) {
        response.setHeader("Access-Control-Allow-Origin", corsOrigin);
        response.setHeader("Vary", "Origin");
        response.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        response.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PATCH, DELETE, OPTIONS",
        );
      }
      if (request.method === "OPTIONS") {
        response.status(204).end();
        return;
      }
      next();
    });
  }

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/ready", async (_request, response) => {
    try {
      await checkReadiness();
      response.status(200).json({
        status: "ready",
        database: "connected",
      });
    } catch {
      response.status(503).json({
        status: "not ready",
        database: "disconnected",
      });
    }
  });

  app.post("/api/auth/password-reset", sensitiveAuthLimiter, async (request, response) => {
    if (!isValidEmail(request.body?.email)) {
      const result = error(
        400,
        "VALIDATION_ERROR",
        "Enter a valid email address.",
      );
      response.status(result.status).json(result.body);
      return;
    }

    try {
      await dependencies.requestPasswordReset(request.body.email);
      response.status(202).json({
        data: {
          message:
            "If the account can be reset, Auth0 will send password-reset instructions.",
        },
      });
    } catch {
      const result = error(
        503,
        "PASSWORD_RESET_UNAVAILABLE",
        "Password reset is temporarily unavailable. Please try again later.",
      );
      response.status(result.status).json(result.body);
    }
  });

  app.post(
    "/api/auth/onboarding",
    sensitiveAuthLimiter,
    authenticate,
    async (request, response) => {
      const role = request.body?.role;
      if (!TUTOR_ROLES.includes(role)) {
        const result = error(400, "VALIDATION_ERROR", "Choose Student, Tutor or Organiser.");
        response.status(result.status).json(result.body);
        return;
      }
      if (role === "ORGANISER" && !dependencies.allowSelfServiceOrganiser) {
        const result = error(403, "ORGANISER_SELF_SIGNUP_DISABLED", "Organiser self-sign-up is not enabled for this environment.");
        response.status(result.status).json(result.body);
        return;
      }
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const profile = await dependencies.onboardUser(auth.subject, role);
        response.status(200).json({ data: { profile } });
      } catch (value) { sendRouteError(response, value); }
    },
  );

  app.get("/api/me", authenticate, resolveProfileRole, requireTutorMxRole, (request, response) =>
    currentProfileRoute(dependencies, request, response),
  );

  app.get(
    "/api/profile/current",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    (request, response) => currentProfileRoute(dependencies, request, response),
  );

  app.get(
    "/api/courses",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (_request, response) => {
      try {
        const courses = await dependencies.listCourses();
        response.status(200).json({ data: { courses } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/courses",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseCourseInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid course code and name.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const course = await dependencies.createCourse(parsed.value);
        response.status(201).json({ data: { course } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/courses/:courseId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const courseId = parseNumericId(request.params.courseId, "Course");
      if ("error" in courseId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          courseId.error ??
            "Course identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseCourseInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid course code and name.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const course = await dependencies.updateCourse(
          courseId.value,
          parsed.value,
        );
        response.status(200).json({ data: { course } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.delete(
    "/api/courses/:courseId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const courseId = parseNumericId(request.params.courseId, "Course");
      if ("error" in courseId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          courseId.error ??
            "Course identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        await dependencies.deleteCourse(courseId.value);
        response.status(204).end();
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutors",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (_request, response) => {
      try {
        const tutors = await dependencies.listTutors();
        response.status(200).json({ data: { tutors } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutors",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseTutorCreateInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ??
            "Enter an Auth0 subject, email, full name and a valid weekly-hours value.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const tutor = await dependencies.createTutor(parsed.value);
        response.status(201).json({ data: { tutor } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/tutors/:tutorId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const tutorId = parseNumericId(request.params.tutorId, "Tutor");
      if ("error" in tutorId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          tutorId.error ?? "Tutor identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseTutorUpdateInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Provide at least one valid tutor field to update.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const tutor = await dependencies.updateTutor(
          tutorId.value,
          parsed.value,
        );
        response.status(200).json({ data: { tutor } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/allocations/candidates",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseAllocationCandidateQuery(request.query);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ??
            "Enter a valid course, start/end time, minimum mark (0-100) and requested hours.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const candidates = await dependencies.listAllocationCandidates(
          parsed.value,
        );
        response.status(200).json({ data: { candidates } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutors/:tutorId/marks",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const tutorId = parseNumericId(request.params.tutorId, "Tutor");
      if ("error" in tutorId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          tutorId.error ?? "Tutor identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const marks = await dependencies.listTutorMarks(tutorId.value);
        response.status(200).json({ data: { marks } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.put(
    "/api/tutors/:tutorId/marks",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const tutorId = parseNumericId(request.params.tutorId, "Tutor");
      if ("error" in tutorId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          tutorId.error ?? "Tutor identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseTutorMarkInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Select a course and enter a valid mark (0-100).",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const mark = await dependencies.upsertTutorMark(
          tutorId.value,
          parsed.value,
        );
        response.status(200).json({ data: { mark } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutors/:tutorId/time-slots",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const tutorId = parseNumericId(request.params.tutorId, "Tutor");
      if ("error" in tutorId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          tutorId.error ?? "Tutor identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const timeSlots = await dependencies.listTutorTimeSlots(tutorId.value);
        response.status(200).json({ data: { timeSlots } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutors/:tutorId/time-slots",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const tutorId = parseNumericId(request.params.tutorId, "Tutor");
      if ("error" in tutorId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          tutorId.error ?? "Tutor identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseTutorTimeSlotInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid tutor availability slot.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const timeSlot = await dependencies.createTutorTimeSlotForTutor(
          tutorId.value,
          parsed.value,
        );
        response.status(201).json({ data: { timeSlot } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutor/dashboard",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const dashboard = await dependencies.getTutorDashboard(auth.subject);
        response.status(200).json({ data: { dashboard } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutor/time-slots",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const parsed = parseTutorTimeSlotInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid tutor availability slot.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const timeSlot = await dependencies.createTutorTimeSlot(
          auth.subject,
          parsed.value,
        );
        response.status(201).json({ data: { timeSlot } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutor/work-logs",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const parsed = parseTutorWorkLogInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid tutor work-log entry.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const workLog = await dependencies.createTutorWorkLog(
          auth.subject,
          parsed.value,
        );
        response.status(201).json({ data: { workLog } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutor/excuses",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const parsed = parseTutorExcuseInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid tutor excuse.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const excuse = await dependencies.createTutorExcuse(
          auth.subject,
          parsed.value,
        );
        response.status(201).json({ data: { excuse } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.delete(
    "/api/auth/delete-account",
    sensitiveAuthLimiter,
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.deleteAccount) {
          throw new Error("Account deletion is not configured");
        }
        await dependencies.deleteAccount(auth.subject);
        response.status(204).end();
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.use((_request, response) => {
    const result = error(
      404,
      "NOT_FOUND",
      "The requested route was not found.",
    );
    response.status(result.status).json(result.body);
  });

  app.use(
    (
      thrown: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;

      if (
        thrown instanceof SyntaxError &&
        "status" in thrown &&
        thrown.status === 400
      ) {
        const result = error(
          400,
          "INVALID_JSON",
          "The request body must contain valid JSON.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const result = error(
        500,
        "INTERNAL_ERROR",
        "The request could not be completed.",
      );
      response.status(result.status).json(result.body);
    },
  );

  return app;
}

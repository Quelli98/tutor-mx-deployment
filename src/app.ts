import express, { type Express } from "express";
import {
  TUTOR_ROLES,
  type AccessTokenVerifier,
  type TutorRole,
} from "./auth/contract.js";
import {
  createAuthenticationMiddleware,
  requireRole,
  type AuthenticatedRequest,
} from "./auth/middleware.js";
import type { PasswordResetRequester } from "./auth/password-reset.js";

type ReadinessCheck = () => Promise<void>;

export interface ProfileSummary {
  id: number;
  email: string;
  fullName: string;
  role: TutorRole;
}

interface AppDependencies {
  corsOrigin?: string;
  findProfileByAuth0Id: (auth0Id: string) => Promise<ProfileSummary | null>;
  requestPasswordReset: PasswordResetRequester;
  verifyAccessToken: AccessTokenVerifier;
}

const unavailableDependencies: AppDependencies = {
  async findProfileByAuth0Id() {
    throw new Error("Authentication is not configured");
  },
  async requestPasswordReset() {
    throw new Error("Authentication is not configured");
  },
  async verifyAccessToken() {
    throw new Error("Authentication is not configured");
  },
};

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

export function createApp(
  checkReadiness: ReadinessCheck,
  dependencies: AppDependencies = unavailableDependencies,
): Express {
  const app = express();
  const authenticate = createAuthenticationMiddleware(
    dependencies.verifyAccessToken,
  );
  const requireTutorMxRole = requireRole(...TUTOR_ROLES);

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
          "GET, POST, DELETE, OPTIONS",
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

  app.post("/api/auth/password-reset", async (request, response) => {
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

  app.get(
    "/api/me",
    authenticate,
    requireTutorMxRole,
    async (request, response) => {
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
    },
  );

  app.delete(
    "/api/auth/delete-account",
    authenticate,
    requireTutorMxRole,
    (_request, response) => {
      response.status(202).json({
        data: {
          status: "pending",
          message:
            "Account deletion was recorded for backend implementation after Sprint 1.",
        },
      });
    },
  );

  app.use((_request, response) => {
    const result = error(404, "NOT_FOUND", "The requested route was not found.");
    response.status(result.status).json(result.body);
  });

  app.use(
    (
      _thrown: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
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

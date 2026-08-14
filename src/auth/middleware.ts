import type { NextFunction, Request, RequestHandler, Response } from "express";
import type {
  AccessTokenVerifier,
  AuthContext,
  TutorRole,
} from "./contract.js";

export type AuthenticatedRequest = Request & { auth?: AuthContext };

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
) {
  return response.status(status).json({ error: { code, message } });
}

export function createAuthenticationMiddleware(
  verifyAccessToken: AccessTokenVerifier,
): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header("authorization");
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) {
      sendError(
        response,
        401,
        "AUTHENTICATION_REQUIRED",
        "A valid bearer token is required.",
      );
      return;
    }

    try {
      (request as AuthenticatedRequest).auth = await verifyAccessToken(match[1]);
      next();
    } catch {
      sendError(
        response,
        401,
        "INVALID_ACCESS_TOKEN",
        "A valid bearer token is required.",
      );
    }
  };
}

export function requireRole(...allowedRoles: TutorRole[]): RequestHandler {
  return (request, response, next) => {
    const auth = (request as AuthenticatedRequest).auth;
    if (!auth) {
      sendError(
        response,
        401,
        "AUTHENTICATION_REQUIRED",
        "A valid bearer token is required.",
      );
      return;
    }

    if (!auth.role || !allowedRoles.includes(auth.role)) {
      sendError(
        response,
        403,
        "FORBIDDEN",
        "You do not have permission to perform this action.",
      );
      return;
    }

    next();
  };
}

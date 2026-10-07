import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isMasterOrganiserRole, type AccessTokenVerifier, type AuthContext, type TutorRole } from "./contract.js";

export interface ResolvedProfileRole { role: TutorRole }
export type AuthenticatedRequest = Request & { auth?: AuthContext };

function sendError(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}

export function createAuthenticationMiddleware(verifyAccessToken: AccessTokenVerifier): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    const match = request.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) { sendError(response, 401, "AUTHENTICATION_REQUIRED", "A valid bearer token is required."); return; }
    try { (request as AuthenticatedRequest).auth = await verifyAccessToken(match[1]); next(); }
    catch { sendError(response, 401, "INVALID_ACCESS_TOKEN", "A valid bearer token is required."); }
  };
}

/** Resolve Neon role after Auth0 identity verification. A fresh first-login token may not yet contain the custom role claim. */
export function createProfileRoleMiddleware(findProfileByAuth0Id: (auth0Id: string) => Promise<ResolvedProfileRole | null>): RequestHandler {
  return async (request, response, next) => {
    const auth = (request as AuthenticatedRequest).auth;
    if (!auth) { sendError(response, 401, "AUTHENTICATION_REQUIRED", "A valid bearer token is required."); return; }
    try {
      const profile = await findProfileByAuth0Id(auth.subject);
      if (!profile) { sendError(response, 404, "PROFILE_NOT_FOUND", "No CSAM Tutor Hub profile is linked to this account."); return; }
      if (auth.role && auth.role !== profile.role) {
        sendError(response, 403, "ROLE_MISMATCH", "Your account permissions are out of date. Sign in again or contact support."); return;
      }
      auth.role = profile.role;
      next();
    } catch { sendError(response, 500, "INTERNAL_ERROR", "The request could not be completed."); }
  };
}

export function requireRole(...allowedRoles: TutorRole[]): RequestHandler {
  return (request, response, next) => {
    const auth = (request as AuthenticatedRequest).auth;
    if (!auth) { sendError(response, 401, "AUTHENTICATION_REQUIRED", "A valid bearer token is required."); return; }
    if (!auth.role || !allowedRoles.includes(auth.role)) {
      sendError(response, 403, "FORBIDDEN", "You do not have permission to perform this action."); return;
    }
    next();
  };
}

export function hasMasterOrganiserAccess(auth: AuthContext | undefined): boolean {
  return Boolean(auth?.auth0Roles?.some(isMasterOrganiserRole));
}

/**
 * MASTER_ORGANIZER is an Auth0 privilege layered on top of the normal
 * ORGANISER application role. It is intentionally not stored as Profile.role,
 * so existing role-specific Tutor Mx data and routes remain unchanged.
 */
export function requireMasterOrganiser(): RequestHandler {
  return (request, response, next) => {
    const auth = (request as AuthenticatedRequest).auth;
    if (!auth) {
      sendError(response, 401, "AUTHENTICATION_REQUIRED", "A valid bearer token is required.");
      return;
    }
    if (!hasMasterOrganiserAccess(auth)) {
      sendError(response, 403, "MASTER_ORGANISER_REQUIRED", "Only a master organiser can review organiser applications.");
      return;
    }
    next();
  };
}

export const TUTOR_ROLES = ["ORGANISER", "TUTOR", "STUDENT"] as const;

export type TutorRole = (typeof TUTOR_ROLES)[number];

export interface AuthContext {
  subject: string;
  role: TutorRole | null;
  /** All Auth0 role names from the configured custom claim. Optional on test/legacy contexts. */
  auth0Roles?: string[];
  email?: string;
  claims: Record<string, unknown>;
}

export type AccessTokenVerifier = (token: string) => Promise<AuthContext>;

export function normalizeTutorRole(value: unknown): TutorRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === "ORGANIZER" || normalized === "ORGANISER") {
    return "ORGANISER";
  }
  if (normalized === "MENTOR" || normalized === "TUTOR") {
    return "TUTOR";
  }
  if (normalized === "LEARNER" || normalized === "STUDENT") {
    return "STUDENT";
  }

  return null;
}

export function normalizeAuth0Role(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return normalized || null;
}

export function isMasterOrganiserRole(value: unknown): boolean {
  const normalized = normalizeAuth0Role(value);
  return normalized === "MASTER_ORGANIZER" || normalized === "MASTER_ORGANISER";
}

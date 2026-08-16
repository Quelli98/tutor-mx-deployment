export const TUTOR_ROLES = ["ORGANISER", "TUTOR", "STUDENT"] as const;

export type TutorRole = (typeof TUTOR_ROLES)[number];

export interface AuthContext {
  subject: string;
  role: TutorRole | null;
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

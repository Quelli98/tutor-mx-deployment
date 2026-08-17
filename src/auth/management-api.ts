import type { TutorRole } from "./contract.js";

interface Auth0ManagementConfig {
  domain: string;
  clientId: string;
  clientSecret: string;
}

export interface Auth0ManagedUser {
  email: string;
  fullName: string;
  emailVerified: boolean;
}

function cleanDomain(domain: string) {
  const value = domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9.-]+$/i.test(value)) throw new Error("AUTH0_DOMAIN must be a hostname");
  return value;
}

async function getManagementToken(config: Auth0ManagementConfig, domain: string, fetchImplementation: typeof fetch) {
  const response = await fetchImplementation(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      audience: `https://${domain}/api/v2/`,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Auth0 Management API authentication failed");
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string") throw new Error("Auth0 Management API returned no access token");
  return body.access_token;
}

export function createAuth0UserDeleter(config: Auth0ManagementConfig, fetchImplementation: typeof fetch = fetch) {
  const domain = cleanDomain(config.domain);
  return async (auth0Id: string) => {
    const token = await getManagementToken(config, domain, fetchImplementation);
    const response = await fetchImplementation(`https://${domain}/api/v2/users/${encodeURIComponent(auth0Id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok && response.status !== 404) throw new Error("Auth0 user deletion failed");
  };
}

/** Server-only first-login provisioning. The browser never receives Management API credentials. */
export function createAuth0RoleProvisioner(config: Auth0ManagementConfig, fetchImplementation: typeof fetch = fetch) {
  const domain = cleanDomain(config.domain);
  let roleIdsPromise: Promise<Record<TutorRole, string>> | null = null;

  async function resolveRoleIds(token: string) {
    if (roleIdsPromise) return roleIdsPromise;
    roleIdsPromise = (async () => {
      const response = await fetchImplementation(`https://${domain}/api/v2/roles?per_page=100`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Auth0 roles could not be read");
      const roles = (await response.json()) as Array<{ id?: unknown; name?: unknown }>;
      const result = {} as Record<TutorRole, string>;
      for (const expected of ["ORGANISER", "TUTOR", "STUDENT"] as const) {
        const match = roles.find((candidate) => candidate.name === expected && typeof candidate.id === "string");
        if (!match || typeof match.id !== "string") throw new Error(`Auth0 role ${expected} is not configured`);
        result[expected] = match.id;
      }
      return result;
    })().catch((error) => { roleIdsPromise = null; throw error; });
    return roleIdsPromise;
  }

  return async (auth0Id: string, selectedRole: TutorRole): Promise<Auth0ManagedUser> => {
    const token = await getManagementToken(config, domain, fetchImplementation);
    const encodedId = encodeURIComponent(auth0Id);
    const [roleIds, userResponse, rolesResponse] = await Promise.all([
      resolveRoleIds(token),
      fetchImplementation(`https://${domain}/api/v2/users/${encodedId}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000),
      }),
      fetchImplementation(`https://${domain}/api/v2/users/${encodedId}/roles`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000),
      }),
    ]);
    if (!userResponse.ok) throw new Error("Auth0 user profile could not be read");
    if (!rolesResponse.ok) throw new Error("Auth0 user roles could not be read");

    const user = (await userResponse.json()) as { email?: unknown; email_verified?: unknown; name?: unknown; nickname?: unknown };
    if (typeof user.email !== "string" || !user.email.trim()) throw new Error("Auth0 user has no usable email address");
    const email = user.email.trim().toLowerCase();
    const fullName = (typeof user.name === "string" && user.name.trim()) ||
      (typeof user.nickname === "string" && user.nickname.trim()) || email.split("@")[0] || "Tutor Mx user";
    if (user.email_verified !== true) return { email, fullName, emailVerified: false };

    const currentRoles = (await rolesResponse.json()) as Array<{ id?: unknown }>;
    const knownIds = new Set(Object.values(roleIds));
    const selectedId = roleIds[selectedRole];
    const staleIds = currentRoles.map((r) => r.id).filter((id): id is string => typeof id === "string" && knownIds.has(id) && id !== selectedId);
    const alreadyAssigned = currentRoles.some((r) => r.id === selectedId);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    if (staleIds.length) {
      const response = await fetchImplementation(`https://${domain}/api/v2/users/${encodedId}/roles`, {
        method: "DELETE", headers, body: JSON.stringify({ roles: staleIds }), signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Auth0 existing Tutor Mx role could not be removed");
    }
    if (!alreadyAssigned) {
      const response = await fetchImplementation(`https://${domain}/api/v2/users/${encodedId}/roles`, {
        method: "POST", headers, body: JSON.stringify({ roles: [selectedId] }), signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Auth0 Tutor Mx role could not be assigned");
    }
    return { email, fullName, emailVerified: true };
  };
}

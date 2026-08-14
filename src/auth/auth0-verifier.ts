import {
  createPublicKey,
  verify as verifySignature,
  type JsonWebKeyInput,
} from "node:crypto";
import {
  normalizeTutorRole,
  type AccessTokenVerifier,
  type TutorRole,
} from "./contract.js";

interface Auth0VerifierConfig {
  domain: string;
  audience: string;
  rolesClaim: string;
}

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
}

interface JwtClaims extends Record<string, unknown> {
  aud?: unknown;
  email?: unknown;
  exp?: unknown;
  iss?: unknown;
  nbf?: unknown;
  sub?: unknown;
}

type Jwk = JsonWebKeyInput["key"] & {
  alg?: string;
  kid?: string;
  use?: string;
};

function cleanDomain(domain: string): string {
  const value = domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9.-]+$/i.test(value)) {
    throw new Error("AUTH0_DOMAIN must be a hostname");
  }
  return value;
}

function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    throw new Error("Malformed access token");
  }
}

function audienceMatches(actual: unknown, expected: string): boolean {
  if (typeof actual === "string") {
    return actual === expected;
  }
  return Array.isArray(actual) && actual.includes(expected);
}

function extractRole(value: unknown): TutorRole | null {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    const role = normalizeTutorRole(candidate);
    if (role) {
      return role;
    }
  }
  return null;
}

export function createAuth0AccessTokenVerifier(
  config: Auth0VerifierConfig,
  fetchImplementation: typeof fetch = fetch,
): AccessTokenVerifier {
  const domain = cleanDomain(config.domain);
  const issuer = `https://${domain}/`;
  const keysById = new Map<string, ReturnType<typeof createPublicKey>>();

  async function getKey(keyId: string) {
    const cached = keysById.get(keyId);
    if (cached) {
      return cached;
    }

    const response = await fetchImplementation(`${issuer}.well-known/jwks.json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error("Unable to retrieve Auth0 signing keys");
    }

    const body = (await response.json()) as { keys?: Jwk[] };
    const jwk = body.keys?.find(
      (candidate) =>
        candidate.kid === keyId &&
        (!candidate.alg || candidate.alg === "RS256") &&
        (!candidate.use || candidate.use === "sig"),
    );
    if (!jwk) {
      throw new Error("Unknown access-token signing key");
    }

    const key = createPublicKey({ key: jwk, format: "jwk" });
    keysById.set(keyId, key);
    return key;
  }

  return async (token) => {
    const segments = token.split(".");
    if (segments.length !== 3) {
      throw new Error("Malformed access token");
    }

    const [encodedHeader, encodedClaims, encodedSignature] = segments;
    const header = decodeJson<JwtHeader>(encodedHeader);
    const claims = decodeJson<JwtClaims>(encodedClaims);

    if (header.alg !== "RS256" || typeof header.kid !== "string") {
      throw new Error("Unsupported access-token signature");
    }

    const key = await getKey(header.kid);
    const isValidSignature = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      key,
      Buffer.from(encodedSignature, "base64url"),
    );
    if (!isValidSignature) {
      throw new Error("Invalid access-token signature");
    }

    const now = Math.floor(Date.now() / 1_000);
    if (
      claims.iss !== issuer ||
      !audienceMatches(claims.aud, config.audience) ||
      typeof claims.sub !== "string" ||
      typeof claims.exp !== "number" ||
      claims.exp <= now ||
      (typeof claims.nbf === "number" && claims.nbf > now)
    ) {
      throw new Error("Invalid or expired access-token claims");
    }

    return {
      subject: claims.sub,
      role: extractRole(claims[config.rolesClaim]),
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
      claims,
    };
  };
}

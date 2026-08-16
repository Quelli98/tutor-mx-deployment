import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAuth0AccessTokenVerifier } from "./auth0-verifier.js";

const rolesClaim = "https://tutormx.example/roles";
const domain = "tenant.example.auth0.com";
const audience = "https://api.tutormx.example";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({ format: "jwk" });

function token(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: `https://${domain}/`,
      aud: audience,
      sub: "auth0|123",
      exp: Math.floor(Date.now() / 1_000) + 60,
      [rolesClaim]: ["Tutor"],
      ...overrides,
    }),
  ).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${claims}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

function jwksFetch() {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

describe("Auth0 access-token verifier", () => {
  it("verifies RS256, issuer, audience, expiry and the role claim", async () => {
    const fetchImplementation = jwksFetch();
    const verify = createAuth0AccessTokenVerifier(
      { domain, audience, rolesClaim },
      fetchImplementation,
    );

    await expect(verify(token())).resolves.toMatchObject({
      subject: "auth0|123",
      role: "TUTOR",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `https://${domain}/.well-known/jwks.json`,
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("rejects expired tokens", async () => {
    const verify = createAuth0AccessTokenVerifier(
      { domain, audience, rolesClaim },
      jwksFetch(),
    );

    await expect(
      verify(token({ exp: Math.floor(Date.now() / 1_000) - 1 })),
    ).rejects.toThrow(/expired/i);
  });

  it("rejects a token for another API audience", async () => {
    const verify = createAuth0AccessTokenVerifier(
      { domain, audience, rolesClaim },
      jwksFetch(),
    );

    await expect(verify(token({ aud: "https://other.example" }))).rejects.toThrow(
      /claims/i,
    );
  });

  it("accepts an audience array and returns null for an unsupported role", async () => {
    const verify = createAuth0AccessTokenVerifier(
      { domain, audience, rolesClaim },
      jwksFetch(),
    );

    await expect(
      verify(token({ aud: ["another-audience", audience], [rolesClaim]: ["OBSERVER"] })),
    ).resolves.toMatchObject({ role: null });
  });

  it("rejects malformed and unsupported tokens before trusting claims", async () => {
    const verify = createAuth0AccessTokenVerifier(
      { domain, audience, rolesClaim },
      jwksFetch(),
    );

    await expect(verify("not-a-jwt")).rejects.toThrow(/malformed/i);

    const badHeader = Buffer.from(JSON.stringify({ alg: "none" })).toString(
      "base64url",
    );
    const claims = Buffer.from(JSON.stringify({ sub: "auth0|123" })).toString(
      "base64url",
    );
    await expect(verify(`${badHeader}.${claims}.signature`)).rejects.toThrow(
      /unsupported/i,
    );
  });

  it("rejects a bad signature", async () => {
    const verify = createAuth0AccessTokenVerifier(
      { domain, audience, rolesClaim },
      jwksFetch(),
    );
    const validToken = token();
    const [header, claims] = validToken.split(".");

    await expect(verify(`${header}.${claims}.ZmFrZQ`)).rejects.toThrow(/signature/i);
  });

  it("rejects a future not-before claim", async () => {
    const verify = createAuth0AccessTokenVerifier(
      { domain, audience, rolesClaim },
      jwksFetch(),
    );

    await expect(
      verify(token({ nbf: Math.floor(Date.now() / 1_000) + 60 })),
    ).rejects.toThrow(/claims/i);
  });

  it("rejects an invalid Auth0 domain and unavailable signing keys", async () => {
    expect(() =>
      createAuth0AccessTokenVerifier({
        domain: "https://tenant.example/path",
        audience,
        rolesClaim,
      }),
    ).toThrow(/hostname/i);

    const verify = createAuth0AccessTokenVerifier(
      { domain, audience, rolesClaim },
      vi.fn().mockResolvedValue(new Response("no", { status: 503 })),
    );
    await expect(verify(token())).rejects.toThrow(/signing keys/i);
  });

  it("caches a verified signing key by key id", async () => {
    const fetchImplementation = jwksFetch();
    const verify = createAuth0AccessTokenVerifier(
      { domain, audience, rolesClaim },
      fetchImplementation,
    );

    await verify(token());
    await verify(token({ sub: "auth0|456" }));

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

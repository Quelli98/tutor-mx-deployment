import { describe, expect, it, vi } from "vitest";
import {
  createAuth0RoleProvisioner,
  createAuth0UserDeleter,
  createAuth0UserReader,
  createAuth0VerificationEmailSender,
} from "./management-api.js";

describe("Auth0 Management API user deletion", () => {
  it("uses a server-side client-credentials token and URL-encodes the verified subject", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "management-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const deleteUser = createAuth0UserDeleter(
      {
        domain: "tenant.us.auth0.com",
        clientId: "server-only-client",
        clientSecret: "server-only-secret",
      },
      fetchImplementation,
    );

    await deleteUser("google-oauth2|123/456");

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://tenant.us.auth0.com/api/v2/users/google-oauth2%7C123%2F456",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer management-token" },
      }),
    );
  });

  it("does not expose the Management API response when authentication fails", async () => {
    const deleteUser = createAuth0UserDeleter(
      {
        domain: "tenant.us.auth0.com",
        clientId: "server-only-client",
        clientSecret: "server-only-secret",
      },
      vi.fn<typeof fetch>().mockResolvedValue(new Response("private detail", { status: 401 })),
    );

    await expect(deleteUser("auth0|user")).rejects.toThrow(
      "Auth0 Management API authentication failed",
    );
  });
});


describe("Auth0 Management API verification email", () => {
  it("posts a verification-email job for the subject using a server-side token", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "management-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const requestVerificationEmail = createAuth0VerificationEmailSender(
      {
        domain: "tenant.us.auth0.com",
        clientId: "server-only-client",
        clientSecret: "server-only-secret",
      },
      fetchImplementation,
    );

    await expect(requestVerificationEmail("auth0|tutor")).resolves.toBeUndefined();

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://tenant.us.auth0.com/api/v2/jobs/verification-email",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer management-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: "auth0|tutor" }),
      }),
    );
  });

  it("does not leak the Management API response when the job fails", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "management-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("private detail", { status: 429 }));

    const requestVerificationEmail = createAuth0VerificationEmailSender(
      {
        domain: "tenant.us.auth0.com",
        clientId: "server-only-client",
        clientSecret: "server-only-secret",
      },
      fetchImplementation,
    );

    await expect(requestVerificationEmail("auth0|tutor")).rejects.toThrow(
      "Auth0 verification email could not be sent",
    );
  });
});


describe("Auth0 Management API role provisioning", () => {
  it("reads the verified user, resolves role IDs and assigns the selected role", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "management-token" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "r-org", name: "ORGANISER" }, { id: "r-tutor", name: "TUTOR" }, { id: "r-student", name: "STUDENT" }]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: "New.User@example.com", email_verified: true, name: "New User" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provision = createAuth0RoleProvisioner({ domain: "tenant.us.auth0.com", clientId: "server-only-client", clientSecret: "server-only-secret" }, fetchImplementation);
    await expect(provision("auth0|new", "STUDENT")).resolves.toEqual({ email: "new.user@example.com", fullName: "New User", emailVerified: true });
    expect(fetchImplementation).toHaveBeenLastCalledWith("https://tenant.us.auth0.com/api/v2/users/auth0%7Cnew/roles", expect.objectContaining({ method: "POST", body: JSON.stringify({ roles: ["r-student"] }) }));
  });
  it("does not assign a role before Auth0 email verification", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "management-token" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "r-org", name: "ORGANISER" }, { id: "r-tutor", name: "TUTOR" }, { id: "r-student", name: "STUDENT" }]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: "new@example.com", email_verified: false }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provision = createAuth0RoleProvisioner({ domain: "tenant.us.auth0.com", clientId: "id", clientSecret: "secret" }, fetchImplementation);
    await expect(provision("auth0|new", "TUTOR")).resolves.toEqual({ email: "new@example.com", fullName: "new", emailVerified: false });
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });
});

describe("Auth0 Management API user lookup", () => {
  it("reads lecturer identity without assigning any Tutor MX role", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "management-token" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: "Lecturer@Wits.ac.za", email_verified: true, name: "Demo Lecturer" }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const readUser = createAuth0UserReader(
      { domain: "tenant.us.auth0.com", clientId: "server-only-client", clientSecret: "server-only-secret" },
      fetchImplementation,
    );

    await expect(readUser("auth0|lecturer")).resolves.toEqual({
      email: "lecturer@wits.ac.za",
      fullName: "Demo Lecturer",
      emailVerified: true,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://tenant.us.auth0.com/api/v2/users/auth0%7Clecturer",
      expect.objectContaining({ headers: { Authorization: "Bearer management-token" } }),
    );
  });
});

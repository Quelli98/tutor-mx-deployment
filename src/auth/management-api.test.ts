import { describe, expect, it, vi } from "vitest";
import { createAuth0UserDeleter } from "./management-api.js";

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

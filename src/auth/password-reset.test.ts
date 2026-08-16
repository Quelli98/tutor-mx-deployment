import { describe, expect, it, vi } from "vitest";
import { createAuth0PasswordResetRequester } from "./password-reset.js";

describe("Auth0 password reset requester", () => {
  it("posts only the public connection contract to Auth0", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response("ok"));
    const requestReset = createAuth0PasswordResetRequester(
      {
        clientId: "spa-client-id",
        connection: "Username-Password-Authentication",
        domain: "tenant.example.auth0.com",
      },
      fetchImplementation,
    );

    await requestReset("user@tutormx.example");

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://tenant.example.auth0.com/dbconnections/change_password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_id: "spa-client-id",
          connection: "Username-Password-Authentication",
          email: "user@tutormx.example",
        }),
      }),
    );
  });

  it("reports an unavailable Auth0 reset service", async () => {
    const requestReset = createAuth0PasswordResetRequester(
      {
        clientId: "spa-client-id",
        connection: "Username-Password-Authentication",
        domain: "tenant.example.auth0.com",
      },
      vi.fn().mockResolvedValue(new Response("no", { status: 503 })),
    );

    await expect(requestReset("user@tutormx.example")).rejects.toThrow(
      /unavailable/i,
    );
  });

  it("does not reveal an unknown Auth0 database user", async () => {
    const requestReset = createAuth0PasswordResetRequester(
      {
        clientId: "spa-client-id",
        connection: "Username-Password-Authentication",
        domain: "tenant.example.auth0.com",
      },
      vi.fn().mockResolvedValue(new Response("unknown", { status: 400 })),
    );

    await expect(requestReset("unknown@tutormx.example")).resolves.toBeUndefined();
  });
});

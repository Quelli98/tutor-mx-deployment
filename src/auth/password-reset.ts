interface PasswordResetConfig {
  clientId: string;
  connection: string;
  domain: string;
}

export type PasswordResetRequester = (email: string) => Promise<void>;

export function createAuth0PasswordResetRequester(
  config: PasswordResetConfig,
  fetchImplementation: typeof fetch = fetch,
): PasswordResetRequester {
  const domain = config.domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!/^[a-z0-9.-]+$/i.test(domain)) {
    throw new Error("AUTH0_DOMAIN must be a hostname");
  }

  return async (email) => {
    const response = await fetchImplementation(
      `https://${domain}/dbconnections/change_password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: config.clientId,
          connection: config.connection,
          email,
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );

    // Auth0 tenant settings can use 400/404 for an unknown database user.
    // Treat those exactly like an accepted request so this API cannot be used
    // to discover which email addresses are registered.
    if (!response.ok && response.status !== 400 && response.status !== 404) {
      throw new Error("Auth0 password reset is unavailable");
    }
  };
}

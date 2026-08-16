interface Auth0ManagementConfig {
  domain: string;
  clientId: string;
  clientSecret: string;
}

function cleanDomain(domain: string) {
  const value = domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9.-]+$/i.test(value)) {
    throw new Error("AUTH0_DOMAIN must be a hostname");
  }
  return value;
}

export function createAuth0UserDeleter(
  config: Auth0ManagementConfig,
  fetchImplementation: typeof fetch = fetch,
) {
  const domain = cleanDomain(config.domain);
  const audience = `https://${domain}/api/v2/`;

  return async (auth0Id: string) => {
    const tokenResponse = await fetchImplementation(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        audience,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!tokenResponse.ok) {
      throw new Error("Auth0 Management API authentication failed");
    }

    const tokenBody = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof tokenBody.access_token !== "string") {
      throw new Error("Auth0 Management API returned no access token");
    }

    const deleteResponse = await fetchImplementation(
      `https://${domain}/api/v2/users/${encodeURIComponent(auth0Id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      throw new Error("Auth0 user deletion failed");
    }
  };
}

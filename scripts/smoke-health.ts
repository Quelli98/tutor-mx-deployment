const baseUrlValue = process.env.SMOKE_BASE_URL;

if (!baseUrlValue) {
  throw new Error("SMOKE_BASE_URL is not configured");
}

const baseUrl = new URL(baseUrlValue);
if (!['http:', 'https:'].includes(baseUrl.protocol)) {
  throw new Error("SMOKE_BASE_URL must use http or https");
}

async function check(path: string, expectedStatus: string): Promise<void> {
  const url = new URL(path, baseUrl);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        throw new Error(`${path} returned HTTP ${response.status}`);
      }

      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("status" in body) ||
        body.status !== expectedStatus
      ) {
        throw new Error(`${path} returned an unexpected response`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  throw lastError;
}

await check("/health", "ok");
await check("/ready", "ready");
console.log(`Deployment smoke passed for ${baseUrl.origin}.`);

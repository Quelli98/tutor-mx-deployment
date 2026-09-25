import { createHash } from "node:crypto";
import { createRouteError } from "./errors.js";

export function normalizeIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw createRouteError(400, "INVALID_IDEMPOTENCY_KEY", "Use an Idempotency-Key of 8–128 letters, digits, dots, underscores, colons or hyphens.");
  }
  return value;
}

/** Hash only the validated request. Object key order must not change its identity. */
export function requestFingerprint(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
    }
    return item;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export interface ReceiptTransaction {
  $queryRawUnsafe?<T>(sql: string, ...values: unknown[]): Promise<T>;
}

/** Receipt and domain writes share the caller's serializable transaction. */
export async function withWriteReceipt<T>(transaction: ReceiptTransaction, profileId: number, key: string | undefined, input: unknown, operation: () => Promise<T>, scope = "timetable-import"): Promise<T> {
  if (!key) return operation();
  if (!transaction.$queryRawUnsafe) throw createRouteError(503, "IDEMPOTENCY_UNAVAILABLE", "Safe retry storage is unavailable.");
  key = requestFingerprint({ scope, key });
  const fingerprint = requestFingerprint(input);
  await transaction.$queryRawUnsafe(
    `INSERT INTO "ApiWriteReceipt" ("profileId", "key", "fingerprint") VALUES ($1, $2, $3) ON CONFLICT ("profileId", "key") DO NOTHING`, profileId, key, fingerprint,
  );
  const rows = await transaction.$queryRawUnsafe<Array<{ fingerprint: string; result: T | null }>>(
    `SELECT "fingerprint", "result" FROM "ApiWriteReceipt" WHERE "profileId" = $1 AND "key" = $2 FOR UPDATE`, profileId, key,
  );
  const receipt = rows[0];
  if (!receipt || receipt.fingerprint !== fingerprint) throw createRouteError(409, "IDEMPOTENCY_KEY_REUSED", "This key belongs to a different request. Use a new key for changed content.");
  if (receipt.result !== null) return receipt.result;
  const result = await operation();
  await transaction.$queryRawUnsafe(
    `UPDATE "ApiWriteReceipt" SET "result" = $3::jsonb WHERE "profileId" = $1 AND "key" = $2 RETURNING "key"`, profileId, key, JSON.stringify(result),
  );
  return result;
}

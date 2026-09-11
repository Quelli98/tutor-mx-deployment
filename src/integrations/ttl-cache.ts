/**
 * Generic in-memory TTL cache for external API results.
 *
 * Only successful (source: "external") results should be cached; fallback
 * results represent a failure to reach the upstream service and must never
 * be stored — otherwise a transient outage would silently masquerade as
 * valid data until the TTL expires.
 *
 * The `retrievedAt` field on cached results is preserved from the original
 * fetch, so downstream consumers always see when the data was truly
 * obtained from the external service.
 */

export interface TtlCacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export interface TtlCacheOptions {
  /** Default time-to-live in milliseconds for new entries. */
  readonly ttlMs: number;
  /** Injectable clock; defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface TtlCache<T> {
  /** Return the cached value if present and not expired, or null. */
  get(key: string): T | null;
  /** Store a value with the default TTL. */
  set(key: string, value: T): void;
  /** Remove a specific entry. */
  invalidate(key: string): void;
  /** Remove all entries. */
  clear(): void;
}

export function createTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new RangeError("ttlMs must be greater than zero");
  }

  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, TtlCacheEntry<T>>();

  return {
    get(key: string): T | null {
      const entry = entries.get(key);
      if (entry === undefined) {
        return null;
      }
      if (now() >= entry.expiresAt) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },

    set(key: string, value: T): void {
      entries.set(key, {
        value,
        expiresAt: now() + options.ttlMs,
      });
    },

    invalidate(key: string): void {
      entries.delete(key);
    },

    clear(): void {
      entries.clear();
    },
  };
}

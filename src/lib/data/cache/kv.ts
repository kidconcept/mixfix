/**
 * Two-tier cache: L1 in-memory Map + L2 Upstash Redis (Vercel KV replacement).
 *
 * Historical energy data is immutable once a full day (25 hours, 0-24) is
 * recorded. Incomplete entries are re-fetched on every request until complete.
 *
 * Graceful fallback: if Redis env vars are missing or the connection fails,
 * L2 is silently skipped and the app runs with L1 only.
 */

import { Redis } from "@upstash/redis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry<T> {
  data: T;
  hours: number;      // count of hours present (target: 25)
  complete: boolean;   // true when hours === 25
  fetchedAt: string;   // ISO-8601 timestamp
}

// ---------------------------------------------------------------------------
// L2 – Upstash Redis (lazy singleton)
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.mixfix_KV_REST_API_URL;
  const token = process.env.mixfix_KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

// ---------------------------------------------------------------------------
// L1 – Module-level Map (survives across requests in the same process)
// ---------------------------------------------------------------------------

const l1 = new Map<string, CacheEntry<unknown>>();

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

export function pricingCacheKey(iso: string, node: string, date: string): string {
  return `gs:lmp:${iso.toUpperCase()}:${node}:${date}`;
}

export function fuelMixCacheKey(ba: string, date: string): string {
  return `eia:fuel:${ba.toUpperCase()}:${date}`;
}

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

/**
 * Read from cache. Checks L1 first, falls back to L2, promotes L2 hits to L1.
 */
export async function cacheGet<T>(key: string): Promise<CacheEntry<T> | null> {
  // L1
  const l1Hit = l1.get(key) as CacheEntry<T> | undefined;
  if (l1Hit) {
    return l1Hit;
  }

  // L2
  const client = getRedis();
  if (!client) return null;

  try {
    const raw = await client.get<CacheEntry<T>>(key);
    if (raw) {
      // Promote to L1
      l1.set(key, raw as CacheEntry<unknown>);
      return raw;
    }
  } catch (err) {
    console.warn("[Cache] Redis GET failed, skipping L2:", (err as Error).message);
  }

  return null;
}

/**
 * Write to both L1 and L2.
 */
export async function cacheSet<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  // L1
  l1.set(key, entry as CacheEntry<unknown>);

  // L2
  const client = getRedis();
  if (!client) return;

  try {
    await client.set(key, entry);
  } catch (err) {
    console.warn("[Cache] Redis SET failed, skipping L2:", (err as Error).message);
  }
}

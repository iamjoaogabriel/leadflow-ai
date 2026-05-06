// src/lib/rate-limit.ts
//
// Token-bucket rate limiter backed by Redis. Used to protect public
// endpoints (webhooks, OAuth callbacks) from abuse and accidental floods.
//
// Algorithm: sliding fixed-window using a single INCR + EXPIRE per key.
// For a typical SaaS webhook this is more than good enough — not a
// replacement for a full DDoS edge, but catches misbehaving integrations
// and prevents single tenants from starving the queue.

import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "rate-limit" });

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  limit: number;
}

export interface RateLimitOptions {
  /** Identifier (usually IP or `tenant:action`) */
  key: string;
  /** Maximum requests allowed in the window */
  max: number;
  /** Window in seconds */
  windowSec: number;
}

/**
 * Increment the counter and return whether the request is allowed.
 * Fails open on Redis errors — we never want rate limiting to cause
 * production downtime.
 */
export async function rateLimit(
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${opts.key}:${Math.floor(Date.now() / (opts.windowSec * 1000))}`;
  try {
    const redis = getRedis();
    const multi = redis.multi();
    multi.incr(redisKey);
    multi.expire(redisKey, opts.windowSec);
    const res = await multi.exec();
    const count = (res && (res[0]?.[1] as number)) || 0;
    const allowed = count <= opts.max;
    const remaining = Math.max(0, opts.max - count);
    const resetInMs =
      opts.windowSec * 1000 - (Date.now() % (opts.windowSec * 1000));
    return {
      allowed,
      remaining,
      resetInMs,
      limit: opts.max,
    };
  } catch (err) {
    log.warn("rate limit fail-open", { err, key: opts.key });
    return {
      allowed: true,
      remaining: opts.max,
      resetInMs: opts.windowSec * 1000,
      limit: opts.max,
    };
  }
}

/**
 * Extract the best-effort client IP from a NextRequest, respecting
 * standard proxy headers.
 */
export function getClientIp(req: Request): string {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp;
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf;
  return "unknown";
}

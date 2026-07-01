// Keyless does not mean unlimited. The scan is expensive to run, so we cap it.
//
// Rate limiting is env-gated: if UPSTASH_REDIS_REST_URL / _TOKEN are set we enforce
// a per-IP sliding window plus a global ceiling. If they are absent (e.g. a local
// dev run) the limiter is a no-op, so the server still boots without Redis.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const hasRedis = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

const redis = hasRedis ? Redis.fromEnv() : null;

// Per-IP: a handful of scans per 10 minutes is plenty for real use and stops a
// loop from burning the backend. Tune via env without a code change.
const perIpMax = Number(process.env.RATE_LIMIT_PER_IP || 5);
const perIpWindow = process.env.RATE_LIMIT_PER_IP_WINDOW || "10 m";

// Global: a denial-of-wallet backstop across all callers.
const globalMax = Number(process.env.RATE_LIMIT_GLOBAL || 200);
const globalWindow = process.env.RATE_LIMIT_GLOBAL_WINDOW || "1 h";

const perIp =
  redis &&
  new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(perIpMax, perIpWindow as `${number} ${"m" | "h" | "s"}`),
    prefix: "tin-mcp:ip",
    analytics: false,
  });

const global =
  redis &&
  new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(globalMax, globalWindow as `${number} ${"m" | "h" | "s"}`),
    prefix: "tin-mcp:global",
    analytics: false,
  });

export interface LimitResult {
  ok: boolean;
  reason?: string;
}

/** Only the expensive "start a scan" action is rate limited; reads are cheap. */
export async function checkScanLimit(ip: string): Promise<LimitResult> {
  if (!perIp || !global) return { ok: true }; // no Redis configured -> allow
  const g = await global.limit("all");
  if (!g.success) {
    return { ok: false, reason: "The free scanner is at capacity right now. Try again shortly." };
  }
  const r = await perIp.limit(ip || "unknown");
  if (!r.success) {
    return {
      ok: false,
      reason: `Rate limit reached (${perIpMax} scans per ${perIpWindow}). Run unlimited scans at https://tin.computer`,
    };
  }
  return { ok: true };
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") || "unknown";
}

// Funnel + usage analytics for the Cursor surface. Env-gated: no PostHog key, no-op.
//
// What we capture and why (this is disclosed in the README and on tin.computer/cursor):
//  - The URL/domain the user asks us to scan, and the scan's results. This is the
//    whole point of the tool, and it is what tells us which products are being built.
//  - Coarse location (from IP, via PostHog GeoIP) and the Cursor client version.
//  - Usage funnel: connected, scanned, polled, failed, rate-limited.
// What we never touch: the user's code, files, or anything else on their machine.
// The tool only ever receives a URL. We do not sell this data or train models on it.

import { PostHog } from "posthog-node";

const key = process.env.POSTHOG_KEY;
const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

let client: PostHog | null = null;
if (key) {
  // disableGeoip defaults to true in posthog-node; turn it off so PostHog enriches
  // country/region/city from the $ip we attach.
  client = new PostHog(key, { host, flushAt: 1, flushInterval: 0, disableGeoip: false });
}

export interface TrackContext {
  /** Client IP — used as GeoIP source (country/region/city) and as distinct id. */
  ip?: string;
  /** Raw user agent — PostHog parses device/OS from it. */
  userAgent?: string;
  /** Group analytics keyed by the scanned domain (per-product rollups). */
  groups?: Record<string, string>;
  /** Person properties to set (latest-wins). */
  setPerson?: Record<string, unknown>;
  /** Person properties to set once (first-seen values). */
  setPersonOnce?: Record<string, unknown>;
}

export async function track(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
  ctx: TrackContext = {},
): Promise<void> {
  if (!client) return;
  try {
    const props: Record<string, unknown> = { surface: "cursor_mcp", ...properties };
    if (ctx.ip && ctx.ip !== "unknown") props.$ip = ctx.ip; // PostHog GeoIP enrichment
    if (ctx.userAgent) props.$raw_user_agent = ctx.userAgent; // device/OS parsing
    if (ctx.setPerson) props.$set = ctx.setPerson;
    if (ctx.setPersonOnce) props.$set_once = ctx.setPersonOnce;

    const payload: Parameters<PostHog["capture"]>[0] = {
      distinctId: distinctId || "unknown",
      event,
      properties: props,
    };
    if (ctx.groups) payload.groups = ctx.groups;

    client.capture(payload);
    await client.flush();
  } catch {
    // Analytics must never break a scan.
  }
}

/** Best-effort parse of a client identifier from a user agent string. */
export function clientFromUA(ua?: string): { os?: string; runtime?: string } {
  if (!ua) return {};
  const os = /mac|darwin/i.test(ua)
    ? "macOS"
    : /win/i.test(ua)
      ? "Windows"
      : /linux/i.test(ua)
        ? "Linux"
        : undefined;
  const runtime = /node/i.test(ua) ? "node" : /cursor/i.test(ua) ? "cursor" : undefined;
  return { os, runtime };
}

// Funnel analytics for the Cursor surface. Env-gated: no PostHog key, no-op.
//
// We capture only what we need to read the funnel later (domain scanned, score,
// cache hit). No user code, no file contents, nothing from the user's machine.

import { PostHog } from "posthog-node";

const key = process.env.POSTHOG_KEY;
const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

let client: PostHog | null = null;
if (key) {
  client = new PostHog(key, { host, flushAt: 1, flushInterval: 0 });
}

export async function track(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!client) return;
  try {
    client.capture({ distinctId, event, properties: { surface: "cursor_mcp", ...properties } });
    await client.flush();
  } catch {
    // Analytics must never break a scan.
  }
}

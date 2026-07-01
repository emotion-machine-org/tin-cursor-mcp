// Tin Computer growth-readiness scanner, exposed as a remote MCP server.
//
// Transport: Streamable HTTP (the `/mcp` path). Deployed on Vercel; the public URL
// (e.g. https://mcp.tin.computer/mcp) is the only thing a Cursor user needs.
//
// This server holds no state and reads nothing from the user's machine. It takes a
// URL, forwards it to Tin's public scan endpoint, and formats the result.

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  startScan,
  pollUntilDone,
  getScan,
  isTerminal,
  encodeHandle,
  decodeHandle,
  toDomain,
} from "../../lib/scan";
import { formatReport, formatProgress, formatFailure } from "../../lib/format";
import { track } from "../../lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel function ceiling; polling budget stays under this.

const POLL_BUDGET_MS = 45_000; // leave headroom under maxDuration

// Best-effort client IP from whatever request context the adapter exposes.
function ipFrom(extra: unknown): string {
  const headers = (extra as { requestInfo?: { headers?: Record<string, unknown> } })?.requestInfo
    ?.headers;
  const fwd = headers?.["x-forwarded-for"] ?? headers?.["X-Forwarded-For"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof raw === "string" && raw) return raw.split(",")[0].trim();
  return "unknown";
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "scan_growth",
      "Run a growth-readiness audit on a live website URL and return a prioritized fix list. " +
        "Scores the site 0-100 across landing page, discoverability (whether AI assistants mention " +
        "it), funnel, and positioning, then lists the highest-impact things to fix. Use this when the " +
        "user wants to know how their product's website or landing page is doing for growth, SEO, or " +
        "getting found. A scan takes about a minute; if it is still running you will get a handle to " +
        "poll with get_growth_scan.",
      { url: z.string().describe("The website URL or domain to scan, e.g. https://acme.com") },
      async ({ url }, extra) => {
        let domain: string;
        try {
          domain = toDomain(url);
        } catch {
          return text(`That does not look like a valid URL: "${url}". Try something like https://acme.com`);
        }

        // Abuse / cost control lives on the control plane (the scan endpoint owns
        // the rate limit, since that is where the expensive work runs). Here we
        // only derive an IP to use as the analytics distinct id.
        const ip = ipFrom(extra);

        let started;
        try {
          started = await startScan(url);
        } catch (e) {
          return text(`Could not start the scan: ${(e as Error).message}`);
        }

        await track("cursor_mcp_scan_started", ip, { domain, cache_hit: started.cacheHit });

        const snap = await pollUntilDone(started.submissionId, started.readerToken, POLL_BUDGET_MS);
        const handle = encodeHandle(started.submissionId, started.readerToken);

        if (snap.status === "completed" && snap.report) {
          await track("cursor_mcp_scan_completed", ip, {
            domain,
            score: snap.report.overall_score?.value ?? null,
          });
          return text(formatReport(snap.report, domain));
        }
        if (snap.status === "failed" || snap.status === "error") {
          return text(formatFailure(domain));
        }
        // Still running: hand back a handle so the agent can poll.
        return text(formatProgress(snap, handle, domain));
      },
    );

    server.tool(
      "get_growth_scan",
      "Retrieve the result of a growth scan that was still running. Pass the handle returned by " +
        "scan_growth. Returns the finished report if ready, or a short progress note if not.",
      { handle: z.string().describe("The scan handle returned by scan_growth") },
      async ({ handle }) => {
        let ids;
        try {
          ids = decodeHandle(handle);
        } catch {
          return text("That scan handle is not valid. Run scan_growth again to get a fresh one.");
        }

        const snap = await getScan(ids.submissionId, ids.readerToken);
        if (snap.status === "completed" && snap.report) {
          // We do not know the original domain here; the report carries enough context.
          return text(formatReport(snap.report, snap.report.headline || "your site"));
        }
        if (snap.status === "failed" || snap.status === "error") {
          return text(formatFailure("your site"));
        }
        if (isTerminal(snap.status)) {
          return text("The scan finished but no report was produced. Try running scan_growth again.");
        }
        return text(formatProgress(snap, handle, "your site"));
      },
    );
  },
  {},
  { basePath: "", maxDuration, verboseLogs: false },
);

export { handler as GET, handler as POST, handler as DELETE };

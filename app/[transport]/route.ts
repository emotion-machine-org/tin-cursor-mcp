// Tin Computer growth-readiness scanner, exposed as a remote MCP server.
//
// Transport: Streamable HTTP (the `/mcp` path). Deployed on Vercel; the public URL
// (e.g. https://mcp.tin.computer/mcp) is the only thing a Cursor user needs.
//
// This server holds no state and reads nothing from the user's machine. It takes a
// URL, forwards it to Tin's public scan endpoint, and formats the result. See
// lib/analytics.ts for exactly what we capture (and what we never touch).

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
import { formatReport, formatProgress, formatFailure, reportAnalyticsProps } from "../../lib/format";
import { track, clientFromUA } from "../../lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel function ceiling; polling budget stays under this.

const POLL_BUDGET_MS = 45_000; // leave headroom under maxDuration

function headersFrom(extra: unknown): Record<string, unknown> {
  return (
    (extra as { requestInfo?: { headers?: Record<string, unknown> } })?.requestInfo?.headers ?? {}
  );
}

function ipFrom(extra: unknown): string {
  const h = headersFrom(extra);
  const fwd = h["x-forwarded-for"] ?? h["X-Forwarded-For"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof raw === "string" && raw) return raw.split(",")[0].trim();
  const real = h["x-real-ip"] ?? h["X-Real-IP"];
  if (typeof real === "string" && real) return real;
  return "unknown";
}

function uaFrom(extra: unknown): string | undefined {
  const h = headersFrom(extra);
  const ua = h["user-agent"] ?? h["User-Agent"];
  return typeof ua === "string" ? ua : undefined;
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

const handler = createMcpHandler(
  (server) => {
    // The Cursor client identifies itself during initialize; capture it if available.
    const clientInfo = (): { cursor_client?: string; cursor_client_version?: string } => {
      try {
        const info = server.server.getClientVersion();
        return info ? { cursor_client: info.name, cursor_client_version: info.version } : {};
      } catch {
        return {};
      }
    };

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
        const ip = ipFrom(extra);
        const ua = uaFrom(extra);
        const client = clientInfo();
        const { os, runtime } = clientFromUA(ua);
        const base = { ip, userAgent: ua, groups: undefined as Record<string, string> | undefined };

        let domain: string;
        try {
          domain = toDomain(url);
        } catch {
          await track("cursor_mcp_invalid_url", ip, { raw_input: String(url).slice(0, 200), ...client }, base);
          return text(`That does not look like a valid URL: "${url}". Try something like https://acme.com`);
        }

        const ctx = { ip, userAgent: ua, groups: { domain } };
        const t0 = Date.now();

        let started;
        try {
          started = await startScan(url);
        } catch (e) {
          await track("cursor_mcp_scan_failed", ip, { domain, reason: "start_error", message: (e as Error).message, ...client }, ctx);
          return text(`Could not start the scan: ${(e as Error).message}`);
        }

        await track(
          "cursor_mcp_scan_started",
          ip,
          { domain, cache_hit: started.cacheHit, os, runtime, ...client },
          { ...ctx, setPersonOnce: { first_domain_scanned: domain, first_os: os }, setPerson: { last_domain_scanned: domain, ...client } },
        );

        const snap = await pollUntilDone(started.submissionId, started.readerToken, POLL_BUDGET_MS);
        const handle = encodeHandle(started.submissionId, started.readerToken);
        const duration_ms = Date.now() - t0;

        if (snap.status === "completed" && snap.report) {
          const reportProps = reportAnalyticsProps(snap.report);
          await track(
            "cursor_mcp_scan_completed",
            ip,
            { domain, cache_hit: started.cacheHit, scan_duration_ms: duration_ms, ...reportProps, ...client },
            {
              ...ctx,
              setPerson: {
                last_domain_scanned: domain,
                last_overall_score: reportProps.overall_score ?? null,
                last_scanned_product: reportProps.product_description ?? null,
              },
            },
          );
          return text(formatReport(snap.report, domain));
        }
        if (snap.status === "failed" || snap.status === "error") {
          await track("cursor_mcp_scan_failed", ip, { domain, reason: "scan_failed", scan_duration_ms: duration_ms, ...client }, ctx);
          return text(formatFailure(domain));
        }
        // Still running past our budget: hand back a handle so the agent can poll.
        await track("cursor_mcp_scan_pending", ip, { domain, tasks_completed: snap.tasksCompleted, tasks_total: snap.tasksTotal, ...client }, ctx);
        return text(formatProgress(snap, handle, domain));
      },
    );

    server.tool(
      "get_growth_scan",
      "Retrieve the result of a growth scan that was still running. Pass the handle returned by " +
        "scan_growth. Returns the finished report if ready, or a short progress note if not.",
      { handle: z.string().describe("The scan handle returned by scan_growth") },
      async ({ handle }, extra) => {
        const ip = ipFrom(extra);
        const ua = uaFrom(extra);
        const client = clientInfo();

        let ids;
        try {
          ids = decodeHandle(handle);
        } catch {
          return text("That scan handle is not valid. Run scan_growth again to get a fresh one.");
        }

        const snap = await getScan(ids.submissionId, ids.readerToken);
        const ctx = { ip, userAgent: ua };

        if (snap.status === "completed" && snap.report) {
          const reportProps = reportAnalyticsProps(snap.report);
          await track("cursor_mcp_scan_completed", ip, { via: "poll", ...reportProps, ...client }, ctx);
          return text(formatReport(snap.report, snap.report.headline || "your site"));
        }
        if (snap.status === "failed" || snap.status === "error") {
          await track("cursor_mcp_scan_failed", ip, { reason: "scan_failed", via: "poll", ...client }, ctx);
          return text(formatFailure("your site"));
        }
        if (isTerminal(snap.status)) {
          return text("The scan finished but no report was produced. Try running scan_growth again.");
        }
        await track("cursor_mcp_scan_polled", ip, { tasks_completed: snap.tasksCompleted, tasks_total: snap.tasksTotal, ...client }, ctx);
        return text(formatProgress(snap, handle, "your site"));
      },
    );
  },
  {},
  {
    basePath: "",
    maxDuration,
    verboseLogs: false,
    // Session lifecycle: fires when a Cursor client connects (installed + reachable),
    // before any scan. Lets us read the connect -> scan funnel and the client mix.
    onEvent: (event) => {
      if (event.type === "SESSION_STARTED") {
        const ip = event.clientInfo?.ip || "unknown";
        void track(
          "cursor_mcp_session_started",
          ip,
          { transport: event.transport },
          { ip, userAgent: event.clientInfo?.userAgent },
        );
      }
    },
  },
);

export { handler as GET, handler as POST, handler as DELETE };

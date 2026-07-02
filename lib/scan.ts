// Thin client for Tin Computer's public, keyless onboarding-scan endpoint.
//
// The scan itself runs entirely on Tin's control plane (api.tin.computer). This
// server never reads the user's files or codebase. The only thing that leaves the
// user's machine is the URL they explicitly pass to the tool.

const TIN_API_BASE = process.env.TIN_API_BASE || "https://api.tin.computer";

// One scan is heavy (~30-60s: PageSpeed, an AI-citation panel across several
// models, headless-browser competitor checks). We POST once to start it, then
// poll the read endpoint (gated by an opaque reader_token) until it completes.

export interface StartedScan {
  submissionId: string;
  readerToken: string;
  cacheHit: boolean;
}

export interface ScanSnapshot {
  status: string; // "queued" | "running" | "completed" | "failed" | ...
  tasksCompleted: number;
  tasksTotal: number;
  report: ScanReport | null;
  raw: unknown;
}

export interface ScanReport {
  product_description?: string;
  headline?: string;
  overall_score?: { value: number; total: number; verdict?: string };
  sub_grades?: Array<{ dimension: string; value: number; total: number; verdict?: string }>;
  issues?: unknown[];
  good_things?: unknown[];
  first_task?: { title?: string; description?: string };
  top_tasks?: Array<{ title?: string }>;
  [key: string]: unknown;
}

/** Normalize whatever the user passed (URL, bare domain, with or without scheme) to a domain. */
export function toDomain(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) throw new Error("Empty URL");
  let host: string;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    host = new URL(withScheme).hostname;
  } catch {
    host = trimmed.replace(/^https?:\/\//i, "").split("/")[0];
  }
  return host.replace(/^www\./i, "").toLowerCase();
}

/** Start (or resume, via server-side domain dedup) a scan. */
export async function startScan(url: string): Promise<StartedScan> {
  const domain = toDomain(url);
  const res = await fetch(`${TIN_API_BASE}/api/onboarding-scans`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Attribution so the control plane can tell Cursor traffic apart.
      "x-tin-source": "cursor-mcp",
    },
    // The live web scanner posts just { domain }; mode defaults server-side.
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to start scan (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const submissionId = String(data.submission_id ?? data.submissionId ?? data.scan_id ?? "");
  const readerToken = String(data.reader_token ?? data.readerToken ?? "");
  if (!submissionId || !readerToken) {
    throw new Error("Scan started but response was missing submission_id / reader_token");
  }
  return { submissionId, readerToken, cacheHit: Boolean(data.cache_hit) };
}

/** Read the current state of a scan. */
export async function getScan(submissionId: string, readerToken: string): Promise<ScanSnapshot> {
  const url = `${TIN_API_BASE}/api/onboarding-scans/${encodeURIComponent(
    submissionId,
  )}?reader_token=${encodeURIComponent(readerToken)}`;
  const res = await fetch(url, { headers: { "x-tin-source": "cursor-mcp" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to read scan (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  // The read endpoint wraps the scan state under `snapshot`; status is mirrored at
  // the top level. Prefer the nested snapshot, fall back to top-level for safety.
  const snap = (data.snapshot as Record<string, unknown> | undefined) ?? data;
  return {
    status: String(snap.status ?? data.status ?? "unknown"),
    tasksCompleted: Number(snap.tasks_completed ?? 0),
    tasksTotal: Number(snap.tasks_total ?? 0),
    report: (snap.report as ScanReport | null) ?? null,
    raw: data,
  };
}

export function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "error";
}

/** Poll until the scan is terminal or the time budget (ms) runs out. */
export async function pollUntilDone(
  submissionId: string,
  readerToken: string,
  budgetMs: number,
  intervalMs = 4000,
): Promise<ScanSnapshot> {
  const deadline = Date.now() + budgetMs;
  let snap = await getScan(submissionId, readerToken);
  while (!isTerminal(snap.status) && Date.now() + intervalMs < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    snap = await getScan(submissionId, readerToken);
  }
  return snap;
}

// Stateless handle: we cannot keep the reader_token in memory across serverless
// invocations, so we hand the agent a self-contained token that encodes both ids
// plus the original domain (so a later get_growth_scan poll can label the report
// correctly without guessing from report content).
export function encodeHandle(submissionId: string, readerToken: string, domain: string): string {
  return Buffer.from(`${submissionId}:${readerToken}:${domain}`, "utf8").toString("base64url");
}

export function decodeHandle(handle: string): { submissionId: string; readerToken: string; domain: string } {
  const decoded = Buffer.from(handle, "base64url").toString("utf8");
  const first = decoded.indexOf(":");
  const second = first === -1 ? -1 : decoded.indexOf(":", first + 1);
  if (first === -1 || second === -1) throw new Error("Malformed scan handle");
  return {
    submissionId: decoded.slice(0, first),
    readerToken: decoded.slice(first + 1, second),
    domain: decoded.slice(second + 1),
  };
}

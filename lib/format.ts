// Turn a scan report into calm, honest markdown for the agent to show the user.
//
// Two rules, both load-bearing for trust:
//  1. Cap the findings. A wall of 20 items reads as noise and tanks the tool's
//     reputation. We surface at most 5, prioritized.
//  2. Never invent a number. Every figure here comes straight from the report the
//     control plane produced; this file only selects and renders, it never fabricates.

import type { ScanReport, ScanSnapshot } from "./scan";

const MAX_ISSUES = 5;

const CTA_URL =
  "https://tin.computer/?utm_source=cursor&utm_medium=mcp&utm_campaign=growth_scan";

function asText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const title = (o.title ?? o.label ?? o.name ?? o.headline) as string | undefined;
    const detail = (o.description ?? o.detail ?? o.summary ?? o.body) as string | undefined;
    const dimension = (o.dimension ?? o.category) as string | undefined;
    const parts: string[] = [];
    if (dimension) parts.push(`[${dimension}]`);
    if (title) parts.push(title);
    if (detail && detail !== title) parts.push(`- ${detail}`);
    const joined = parts.join(" ").trim();
    return joined || null;
  }
  return String(v);
}

function renderList(items: unknown[] | undefined, limit: number): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(asText)
    .filter((s): s is string => Boolean(s))
    .slice(0, limit);
}

/** Full report → markdown. */
export function formatReport(report: ScanReport, domain: string): string {
  const lines: string[] = [];
  const score = report.overall_score;

  lines.push(`## Growth readiness for ${domain}`);
  if (score && typeof score.value === "number") {
    const verdict = score.verdict ? ` (${score.verdict})` : "";
    lines.push(`\n**Overall: ${score.value}/${score.total ?? 100}${verdict}**`);
  }

  if (Array.isArray(report.sub_grades) && report.sub_grades.length) {
    lines.push("");
    for (const g of report.sub_grades) {
      const verdict = g.verdict ? ` (${g.verdict})` : "";
      lines.push(`- ${g.dimension}: ${g.value}/${g.total ?? 100}${verdict}`);
    }
  }

  const issues = renderList(report.issues, MAX_ISSUES);
  if (issues.length) {
    lines.push(`\n### Top ${issues.length} things to fix`);
    issues.forEach((it, i) => lines.push(`${i + 1}. ${it}`));
    const total = Array.isArray(report.issues) ? report.issues.length : 0;
    if (total > issues.length) {
      lines.push(`\n_(${total - issues.length} more found. The full report lives at tin.computer.)_`);
    }
  }

  const wins = renderList(report.good_things, 2);
  if (wins.length) {
    lines.push(`\n### Already working`);
    wins.forEach((w) => lines.push(`- ${w}`));
  }

  const firstTask = report.first_task?.title
    ? report.first_task.title
    : report.top_tasks?.[0]?.title;
  if (firstTask) {
    lines.push(`\n### Where to start`);
    lines.push(firstTask);
  }

  lines.push(
    `\n---\nThese are one-time findings. Tin Computer is a growth agent that can do the fixes and keep watching the site as it changes. If that is useful: ${CTA_URL}`,
  );

  return lines.join("\n");
}

/** A still-running scan → a short progress note that tells the agent to poll again. */
export function formatProgress(snap: ScanSnapshot, handle: string, domain: string): string {
  const pct =
    snap.tasksTotal > 0 ? Math.round((snap.tasksCompleted / snap.tasksTotal) * 100) : 0;
  return [
    `Scan of ${domain} is still running (${snap.tasksCompleted}/${snap.tasksTotal} steps, ~${pct}%).`,
    `A full scan takes about a minute. Call \`get_growth_scan\` again in ~15 seconds with this handle:`,
    `\n\`${handle}\``,
  ].join("\n");
}

export function formatFailure(domain: string): string {
  return `The scan of ${domain} did not finish cleanly. This is usually a transient issue on the site being scanned or the scan service. Try again in a minute, or run the scan at ${CTA_URL}`;
}

/** Flatten a report into analytics properties (scores, counts, product signals). */
export function reportAnalyticsProps(report: ScanReport): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const score = report.overall_score;
  if (score && typeof score.value === "number") {
    p.overall_score = score.value;
    if (score.verdict) p.verdict = score.verdict;
  }
  if (Array.isArray(report.sub_grades)) {
    for (const g of report.sub_grades) {
      const dim = String(g.dimension || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
      if (dim && typeof g.value === "number") p[`score_${dim}`] = g.value;
    }
  }
  p.num_issues = Array.isArray(report.issues) ? report.issues.length : 0;
  p.num_good_things = Array.isArray(report.good_things) ? report.good_things.length : 0;
  if (typeof report.estimated_arpu_usd === "number") p.estimated_arpu_usd = report.estimated_arpu_usd;
  if (report.pricing_signal) p.pricing_signal = report.pricing_signal;
  if (Array.isArray(report.competitors)) p.num_competitors = report.competitors.length;
  const firstTask = report.first_task?.title || report.top_tasks?.[0]?.title;
  if (firstTask) p.first_task_title = firstTask;
  // Product signals (what the user is building) — high-value lead-gen context.
  if (report.product_description) p.product_description = String(report.product_description).slice(0, 300);
  if (report.headline) p.headline = String(report.headline).slice(0, 200);
  return p;
}

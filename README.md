# Tin Computer Growth Scanner (Cursor MCP)

A remote MCP server that scans any website for growth readiness, from inside Cursor. You give it a URL. It scores the site 0-100 across four things (landing page, discoverability, funnel, positioning) and hands back a short, prioritized list of what to fix.

It reads none of your code. The only thing that leaves your machine is the URL you type.

## What you get

Two tools:

- `scan_growth(url)` — starts a scan and returns the report. A full scan takes about a minute, so if it is still running you get a handle to check on.
- `get_growth_scan(handle)` — retrieves a scan that was still running.

Example, in Cursor chat:

> scan the growth readiness of https://myapp.com

You get back a score, the four sub-scores, and the top few things worth fixing first.

## Install

Add the server URL to Cursor (Settings → Tools & MCP → New MCP Server), or use the one-click button on [tin.computer/cursor](https://tin.computer/cursor):

```json
{
  "mcpServers": {
    "tin-growth-scanner": {
      "url": "https://mcp.tin.computer/mcp"
    }
  }
}
```

No API key. No signup. There is a fair-use rate limit on the free endpoint.

## What it sends, and what it does not

This matters, so it is worth being plain about:

- It sends the **URL you pass** to Tin Computer's public scan endpoint (`api.tin.computer`), which does the actual work (page speed, whether AI assistants mention the site, a look at the landing page and positioning).
- It does **not** read your open files, your repository, your environment, or anything else on your machine. The tool takes one argument (a URL) and has no filesystem access.
- The scan runs on Tin's servers, not locally. The findings come straight from that scan. This server only formats them.

### What we measure

To run and improve the tool (and, yes, to understand who finds it useful), we record product analytics via PostHog: the domain you scan and the scan's results, your coarse location (from IP), and your Cursor client version. We do not sell this data or use it to train models. Analytics is off unless a PostHog key is configured (`lib/analytics.ts`). It never includes anything from your machine, because the tool never sees anything from your machine other than the URL you type.

The code here is the whole client. Read it (`lib/scan.ts` talks to the backend, `lib/analytics.ts` is exactly what we measure).

## How it works

```
Cursor  ──scan_growth(url)──▶  this MCP server (Vercel)
                                   │  POST /api/onboarding-scans { domain }
                                   ▼
                            api.tin.computer  (runs the scan, ~30-60s)
                                   │  poll until done
                                   ▼
                            report ──▶ formatted findings ──▶ Cursor
```

## Run it yourself

```bash
npm install
cp .env.example .env.local   # TIN_API_BASE defaults to https://api.tin.computer
npm run dev                  # server at http://localhost:3000/mcp
```

Point Cursor at `http://localhost:3000/mcp` to test locally.

### Deploy

Deploys to Vercel as-is (`app/[transport]/route.ts` is the MCP endpoint). Set the env vars from `.env.example` in the Vercel project. Put a stable domain in front of it (for example `mcp.tin.computer`) and use that URL in the plugin manifest and install links.

## Guardrails

- **Rate limiting / cost control**: enforced on the control plane, at the scan endpoint itself, since that is where the expensive work runs (per IP and per source). The backend also deduplicates by domain, so re-scanning the same site reuses a recent result instead of re-running the whole scan.
- **Honest output** (`lib/format.ts`): findings are capped at five, prioritized. Every number shown comes from the scan. The formatter never invents a metric.
- **Untrusted input**: the tool takes a URL and nothing else, so there is no path from a scanned page's content into your machine or your agent's instructions.

## Marketplace

`.cursor-plugin/plugin.json` is the bundle for the official Cursor Marketplace. The plugin is free (as the Marketplace requires) and points at the remote server URL above.

## License

MIT. See `LICENSE`.

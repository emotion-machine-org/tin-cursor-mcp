# Cursor Marketplace submission

Everything needed to submit this plugin, and the steps to do it. Verified against
the schema in `github.com/cursor/plugins` and the Marketplace Publisher Terms.

## The package (what a submission requires)

A submission is this public Git repo. For a remote MCP plugin the shippable bundle
is small — the manifest plus supporting files:

| File | Purpose | Status |
|---|---|---|
| `.cursor-plugin/plugin.json` | Plugin manifest (points at the remote MCP URL) | present, spec-checked |
| `README.md` | What it does, install, and data handling | present |
| `LICENSE` | Must be a permissive license (MIT/BSD/Apache-2.0) | present (MIT) |
| `assets/logo.svg` | Listing logo (relative path must resolve) | present (placeholder — replace with the real Tin logo) |
| `CHANGELOG.md` | Optional but expected | present |
| Public repo | Required — all plugins must be open source | `github.com/emotion-machine-org/tin-cursor-mcp` |

The remote MCP server itself (this Next.js app) is deployed separately and is live
at `https://mcp.tin.computer/mcp`. The manifest references that URL.

## Manifest shape (already applied)

- `name` is the only required field; kebab-case, starts and ends alphanumeric.
- `author` is an **object** `{ name, email }` (not a string).
- Use `category` (single string, `developer-tools`) + `tags` + `keywords`. There is
  **no** `categories` field — the schema is `additionalProperties: false`, so an
  unknown key fails validation in their CI.
- `license` must be permissive.
- Remote MCP is declared as `mcpServers: { "<name>": { "url": "..." } }`.

## Hard rules (Publisher Terms)

- Must be **free** — cannot charge users directly or indirectly through the plugin.
- Must be **open source** (public repo).
- **No selling** plugin data; **no training** models on plugin/user data.
- Only collect what the disclosed functionality needs (our README discloses the
  analytics, and the tool only ever receives a URL — it reads nothing from the
  user's machine).

## Steps

1. **Replace the logo** — commit the real Tin Computer mark at `assets/logo.svg`
   (or `.png`) so the listing is on-brand.
2. **Smoke-test locally** — drop the plugin in `~/.cursor/plugins/local/tin-growth-scanner/`
   and run a real scan through Cursor once, end to end, so the reviewer's first run
   is clean.
3. **Confirm the endpoint** — `https://mcp.tin.computer/mcp` returns `tools/list`
   (it does today).
4. **Submit** the repo link at `https://cursor.com/marketplace/publish` (needs a
   Cursor login). Review is manual; every update is re-reviewed.

## Notes for review

- The reviewer audits data handling. Our data handling is disclosed in the README
  under "What we measure" and matches what the code does (`lib/analytics.ts`).
- The value proposition ("URL-only, reads none of your code") is literally true:
  the tool's only input is a URL and it has no filesystem access.

# Changelog

## 0.1.0

Initial release. A remote MCP server that scans a website URL for growth readiness
from inside Cursor.

- `scan_growth(url)` — starts a scan, returns a 0-100 score across landing page,
  discoverability, funnel, and positioning, plus a prioritized fix list.
- `get_growth_scan(handle)` — retrieves a scan that was still running.
- URL-only. Reads nothing from the user's machine.
- Product analytics via PostHog (env-gated), disclosed in the README.

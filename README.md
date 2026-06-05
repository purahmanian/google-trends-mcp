# google-trends-mcp

> Free Google Trends data inside any MCP-compatible AI client. No API key required.

[![CI](https://github.com/purahmanian/google-trends-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/purahmanian/google-trends-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/google-trends-mcp)](https://www.npmjs.com/package/google-trends-mcp)

---

> **UNOFFICIAL ENDPOINT DISCLAIMER**
>
> This server communicates with the same internal endpoints that the
> [trends.google.com](https://trends.google.com) frontend uses. These endpoints are
> undocumented and unofficial. Google can change, rate-limit, or remove them at any time
> without notice. This project is not affiliated with, endorsed by, or sponsored by
> Google LLC. "Google Trends" is a trademark of Google LLC.
>
> If requests start failing, open an issue. The fix is usually a URL or parameter tweak.

---

## What it does

| Tool | Description | Example prompt |
|------|-------------|----------------|
| `interest_over_time` | Weekly interest scores (0-100) for up to 5 terms | "Show me interest in 'matcha latte' over the past year in the US" |
| `compare_terms` | Normalized comparison of 2-5 terms with winner callout | "Compare 'coffee', 'tea', and 'matcha' in Canada" |
| `related_queries` | Top and rising related search queries for a term | "What related queries are rising for 'cold plunge'?" |
| `trending_now` | Today's daily trending searches for a country | "What's trending on Google in the UK right now?" |
| `interest_by_region` | Regional breakdown of interest (country or sub-region) | "Which US states search for 'pickleball' most?" |

---

## Quick start

No API key is needed. Install and run via `npx`.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "google-trends-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add google-trends -- npx -y google-trends-mcp
```

### OpenAI Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.google-trends]
command = "npx"
args = ["-y", "google-trends-mcp"]
```

---

## Example conversations

**Spotting seasonality:**
> "Use Google Trends to show me interest in 'pumpkin spice' over the past 5 years worldwide."
>
> The model calls `interest_over_time` with `terms=["pumpkin spice"]`, `timeframe="today 5-y"` and
> narrates the clear September-October spikes each year.

**Keyword competition:**
> "Compare search interest in 'Notion', 'Obsidian', and 'Roam Research' in the US this year."
>
> The model calls `compare_terms`, reads the averages, and identifies the winner with supporting
> time-series data.

**Opportunity discovery:**
> "What are the fastest-rising related queries for 'sourdough bread' right now?"
>
> The model calls `related_queries` and surfaces the rising queries, often revealing adjacent
> niches and trending subtopics.

---

## Development

```bash
# Clone and install
git clone https://github.com/purahmanian/google-trends-mcp.git
cd google-trends-mcp
npm install

# Run tests (no network calls; all HTTP is mocked)
npm test

# Build TypeScript to dist/
npm run build

# Run the server locally (stdio mode)
node dist/index.js
```

### Rate limits and blocking

Google does not publish a rate limit for these endpoints. In practice, a few requests
per minute works reliably. If you hit HTTP 429 or get blocked, the server returns a
descriptive error message. Waiting 2-5 minutes usually resolves it.

---

## Built by

Built by **Puya Ventures LLC**. I build custom MCP servers and AI integrations for
product teams and researchers. Get in touch:
[purahmanian@gmail.com](mailto:purahmanian@gmail.com)

---

## License

MIT. See [LICENSE](./LICENSE).

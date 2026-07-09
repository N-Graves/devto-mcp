# devto-mcp

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server for the [Dev.to](https://dev.to) (Forem) API — list, read, create, and update articles from an MCP-compatible AI client.

## Why this exists

At the time this was built, no trustworthy pre-built Dev.to MCP server existed. The two candidates found were either a thin pointer to a third-party hosted gateway (routing your API traffic through someone else's infrastructure with no way to audit it) or an npm package with no visible source repository at all. Dev.to's own API is small and well-documented, so this wraps it directly — no third party in the middle, ~150 lines of code you can read in five minutes.

## Setup

```bash
npm install
npm run build
```

Requires a Dev.to API key (Settings → Extensions → DEV API Keys on dev.to).

### Configuration

```json
{
  "mcpServers": {
    "devto": {
      "command": "node",
      "args": ["/path/to/devto-mcp/dist/index.js"],
      "env": {
        "DEVTO_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

## Available tools

| Tool | Description |
|---|---|
| `devto_get_me` | Get the authenticated user's profile |
| `devto_list_my_articles` | List the authenticated user's articles (published and drafts) |
| `devto_get_article` | Get a single article by numeric id |
| `devto_create_article` | Create a new article (`published: false` saves it as a draft) |
| `devto_update_article` | Update an existing article by id |

## Security model: `agent_id` capability gating

This server was built for a multi-agent fleet where several AI agents share one MCP process, and the underlying platform (OpenClaw) doesn't propagate per-agent caller identity down to MCP tool calls — a real, documented limitation of the current MCP ecosystem, not specific to this server. So `devto_create_article` and `devto_update_article` both **require an `agent_id` argument**, which the server verifies against an external authorization endpoint (`FLEET_BOARD_URL`, default `http://127.0.0.1:8420`) before doing anything.

**Honest limitation:** `agent_id` is self-reported by the caller, not cryptographically bound by the MCP protocol. This does not stop a determined, malicious actor from lying about its own identity — what it does is turn a *silent, undetected* wrong-agent action into a *loud, immediate, auditable rejection*, closing the actual failure mode this was built to prevent (an agent calling a tool that isn't its job because nothing stopped it).

If you're using this server standalone (not as part of a multi-agent fleet with that authorization endpoint), you can either run your own minimal service at `FLEET_BOARD_URL` that returns a JSON array of capability strings for `GET /agents/{id}/capabilities`, or fork this and remove the `checkCapability` calls in `src/index.ts` — they're isolated to two tools and clearly marked.

## Notes on safety

- Every request goes to `dev.to/api` only — no telemetry, no third-party calls, no dynamic code execution.
- `devto_create_article` defaults to nothing published unless you explicitly pass `published: true` — always create as a draft first if you want a human review step before anything goes live.

## License

MIT — see [LICENSE](LICENSE).

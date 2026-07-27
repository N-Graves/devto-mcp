# devto-mcp

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server for the [Dev.to](https://dev.to) (Forem) API — list, read, search, create and update articles, plus author analytics, from an MCP-compatible AI client.

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

Reads are ungated. Writes require an `agent_id` holding the `content` capability — see the security model below.

| Tool | Description |
|---|---|
| `devto_get_me` | Get the authenticated user's profile |
| `devto_list_my_articles` | List your own articles. `state`: `all` (default), `published`, `unpublished` |
| `devto_get_article` | Get a single article by numeric id |
| `devto_get_article_by_path` | Get a live article from its `username`/`slug` URL parts |
| `devto_get_article_comments` | Read the public comment thread on an article |
| `devto_list_tags` | List Dev.to's real tags (tags must already exist; max 4 per article) |
| `devto_search_articles` | Search/browse others' published articles by `q`, `tag`, `username`, `top` |
| `devto_get_analytics` | Author analytics: `totals`, `past_day`, `historical`, `referrers` |
| `devto_create_article` | Create an article — **always as a draft** |
| `devto_update_article` | Update an article's content — **cannot change publish state** |

`devto_list_my_articles` defaults to `state: "all"` deliberately. Dev.to's `/articles/me` returns *published articles only*, so while that was the only listing path, every draft this server created was invisible to the agent that wrote it.

### Article fields

`create`/`update` accept `title`, `body_markdown`, `tags`, `main_image`, `description`, `series`, `canonical_url`.

- **`main_image`** (cover image) must be a **publicly reachable URL** — Dev.to fetches it server-side, so a local file path will not work.
- **`description`** is the preview/SEO snippet. Omit it and Dev.to just truncates your opening paragraph.
- **`published`** is not accepted, by design (below).
- **`organization_id`** is not exposed: the Forem API accepts it, but it is only meaningful for accounts that belong to an organization.

### Deliberately not exposed

The Forem API has 131 operations; most are instance administration (`/api/admin/*`, badges, segments, billboards, moderation) that a normal author account cannot use. Beyond those:

- **`PUT /articles/{id}/unpublish`** — works, omitted on purpose. Taking a live article *down* is the same class of unreviewed change to a public site as putting one up, and this server's design keeps publish state a human decision.
- **`POST /reactions`, `POST /follows`** — real public social actions performed as the account; out of scope for a writing tool.
- **`GET /followers/users`** — returns `500` from Dev.to itself (verified 2026-07-27). Follower totals are available through `devto_get_analytics` instead.

## Security model: `agent_id` capability gating

This server was built for a multi-agent fleet where several AI agents share one MCP process, and the underlying platform (OpenClaw) doesn't propagate per-agent caller identity down to MCP tool calls — a real, documented limitation of the current MCP ecosystem, not specific to this server. So `devto_create_article` and `devto_update_article` both **require an `agent_id` argument**, which the server verifies against an external authorization endpoint (`FLEET_BOARD_URL`, default `http://127.0.0.1:8420`) before doing anything.

**Honest limitation:** `agent_id` is self-reported by the caller, not cryptographically bound by the MCP protocol. This does not stop a determined, malicious actor from lying about its own identity — what it does is turn a *silent, undetected* wrong-agent action into a *loud, immediate, auditable rejection*, closing the actual failure mode this was built to prevent (an agent calling a tool that isn't its job because nothing stopped it).

If you're using this server standalone (not as part of a multi-agent fleet with that authorization endpoint), you can either run your own minimal service at `FLEET_BOARD_URL` that returns a JSON array of capability strings for `GET /agents/{id}/capabilities`, or fork this and remove the `checkCapability` calls in `src/index.ts` — they're isolated to two tools and clearly marked.

## Notes on safety

- Every request goes to `dev.to/api` only — no telemetry, no third-party calls, no dynamic code execution.
- **Publishing is structurally impossible through this server.** `devto_create_article` hard-codes `published: false` server-side — there is no argument that overrides it — and `devto_update_article` strips `published` from the payload entirely, so a draft stays a draft and a live post stays live. Publishing is a human action taken in Dev.to's own UI.
- `published` is stripped on update rather than forced to `false`, so fixing a typo in a live article cannot silently unpublish it.

## License

MIT — see [LICENSE](LICENSE).

#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ArticleState, DevToClient } from "./devto-client.js";
import { CapabilityError, requireCapability } from "./agent-capability.js";
import { requireBrand, BrandError } from "./brand-gate.js";

const REQUIRED_CAPABILITY = "content"; // HERALD owns Dev.to content
// This server publishes for NAS DIGITAL only - see brand-gate.ts. With Nate work goes to Instagram/Facebook/Threads instead.
const SERVER_BRAND = "nas_digital";

/**
 * Coverage note (audit 2026-07-27, against the official Forem OpenAPI spec and
 * verified live against this account rather than assumed).
 *
 * The Forem API exposes 131 operations. Most are irrelevant here: /api/admin/*,
 * badges, segments, billboards, surveys, pages, concepts and the user
 * moderation surface (suspend/spam/trust/limited) are Forem *instance
 * administration*, which a normal dev.to author account cannot use.
 *
 * Deliberately NOT exposed, each for a stated reason:
 *
 * - `PUT /articles/{id}/unpublish` - works, and is left out on purpose. This
 *   server's whole design is that publish state is a human decision made in
 *   Dev.to's own UI (see createArticle/updateArticle). Taking a live article
 *   DOWN is the same class of unreviewed change to the public site as putting
 *   one up. Nathan's call to add it, not an oversight.
 * - `POST /reactions`, `POST /reactions/toggle`, `POST /follows` - real public
 *   social actions performed as the business account. Outward engagement is
 *   ECHO's remit and belongs behind HITL, not a side effect of a writing tool.
 * - `GET /followers/users` - probed live 2026-07-27 and returns
 *   500 Internal Server Error from Dev.to itself. Not shipping a tool that
 *   cannot work; follower totals are available via analytics instead.
 * - `GET /organizations` - 404s on hosted dev.to, and this account belongs to
 *   no organization, which is also why `organization_id` is absent from the
 *   article payload.
 * - readinglist / videos / podcast_episodes / trends / instance /
 *   profile_images - all work, none serve HERALD's job; omitted to keep the
 *   tool surface something an agent can actually hold in context.
 */

const API_KEY = process.env.DEVTO_API_KEY;
if (!API_KEY) {
  console.error("DEVTO_API_KEY environment variable is required");
  process.exit(1);
}

const client = new DevToClient(API_KEY);

const tools: Tool[] = [
  {
    name: "devto_get_me",
    description: "Get the authenticated Dev.to user's profile.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "devto_list_my_articles",
    description:
      "List your own articles. `state` defaults to 'all', which INCLUDES DRAFTS - every article " +
      "this server creates is a draft, so 'all' or 'unpublished' is normally what you want. " +
      "(Until 2026-07-27 this tool could only see published articles, which meant 6 real drafts " +
      "were invisible to HERALD.) Use state='unpublished' to see exactly what is awaiting review " +
      "or publication.",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: ["all", "published", "unpublished"],
          description: "Which slice to list. Default 'all'.",
        },
        page: { type: "number", description: "Page number, default 1" },
        per_page: { type: "number", description: "Results per page, default 30" },
      },
    },
  },
  {
    name: "devto_get_article",
    description: "Get one of your articles by its numeric id, including its full body_markdown.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Article id" } },
      required: ["id"],
    },
  },
  {
    name: "devto_get_article_by_path",
    description:
      "Get a live article from its public URL parts, i.e. dev.to/{username}/{slug}. Use this when " +
      "you have a link rather than a numeric id.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "e.g. 'nasdigital'" },
        slug: { type: "string", description: "The URL slug, without the leading slash" },
      },
      required: ["username", "slug"],
    },
  },
  {
    name: "devto_get_article_comments",
    description:
      "Read the public comment thread on an article. Real reader feedback on published work - " +
      "worth checking before writing a follow-up piece. Read-only: this cannot post a reply.",
    inputSchema: {
      type: "object",
      properties: { article_id: { type: "number", description: "Numeric article id" } },
      required: ["article_id"],
    },
  },
  {
    name: "devto_list_tags",
    description:
      "List Dev.to's real tags. Tags must already exist on the site, so check here before tagging " +
      "rather than inventing one - an article may carry at most 4, and extras are silently dropped.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number" },
        per_page: { type: "number", description: "Default 30" },
      },
    },
  },
  {
    name: "devto_search_articles",
    description:
      "Search or browse OTHER people's published articles - what already exists on a topic before " +
      "you write another one. Pass `q` for a text search, or `tag`/`username` to browse. `top` is " +
      "a number of days to rank by reactions over.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Free-text search query" },
        tag: { type: "string", description: "Single tag to filter by" },
        username: { type: "string", description: "Author to filter by" },
        top: { type: "number", description: "Rank by most-reacted over this many days" },
        page: { type: "number" },
        per_page: { type: "number" },
      },
    },
  },
  {
    name: "devto_get_analytics",
    description:
      "Real performance data for your own articles - reactions, comments, follows, page views and " +
      "referring domains. All four reports verified working on this account. Use it to answer " +
      "whether content actually worked, instead of guessing. Reports: 'totals' (all-time), " +
      "'past_day', 'historical' (needs `start`, and optionally `end`, as YYYY-MM-DD), 'referrers' " +
      "(which domains sent traffic).",
    inputSchema: {
      type: "object",
      properties: {
        report: {
          type: "string",
          enum: ["totals", "past_day", "historical", "referrers"],
          description: "Which report to fetch",
        },
        start: { type: "string", description: "YYYY-MM-DD. Required for 'historical'." },
        end: { type: "string", description: "YYYY-MM-DD. Optional for 'historical'." },
      },
      required: ["report"],
    },
  },
  {
    name: "devto_create_article",
    description:
      "Create a new Dev.to article. It is ALWAYS created as a DRAFT - there is no argument that " +
      "publishes it, and the server hard-codes published:false. Submit the draft's id/URL for HITL " +
      "review; Nathan publishes it himself in Dev.to. Requires agent_id (must hold the 'content' " +
      "capability, e.g. herald).",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Your fleet-board agent id, e.g. 'herald'" },
        task_id: {
          type: "string",
          description:
            "The board task this belongs to. This is a NAS DIGITAL channel - the task's "
            + "brand must be nas_digital, or it is refused. With Nate work goes to Instagram/Facebook/Threads instead.",
        },
        title: { type: "string" },
        body_markdown: { type: "string", description: "Full article body in Markdown" },
        tags: { type: "array", items: { type: "string" }, description: "Up to 4 tags" },
        main_image: {
          type: "string",
          description:
            "Cover image URL. Must be PUBLICLY REACHABLE - Dev.to fetches it server-side, so a " +
            "local path from MUSE will NOT work. Run publish_image_public first and pass the URL " +
            "it returns.",
        },
        description: {
          type: "string",
          description:
            "The preview/SEO snippet shown in feeds and social cards. Omit it and Dev.to just " +
            "truncates your opening paragraph, which is why existing articles have poor previews.",
        },
        series: { type: "string", description: "Series name; the same string groups articles together" },
        canonical_url: { type: "string", description: "Original URL if this is a cross-post" },
      },
      required: ["agent_id", "task_id", "title", "body_markdown"],
    },
  },
  {
    name: "devto_update_article",
    description:
      "Update an existing Dev.to article by id. It CANNOT change publish state in either " +
      "direction - a draft stays a draft, a live post stays live. Use it to correct a draft after " +
      "review feedback. Fields you omit are left untouched. Requires agent_id (must hold the " +
      "'content' capability).",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Your fleet-board agent id, e.g. 'herald'" },
        id: { type: "number" },
        title: { type: "string" },
        body_markdown: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        main_image: { type: "string", description: "Cover image URL - must be publicly reachable" },
        description: { type: "string", description: "Preview/SEO snippet" },
        series: { type: "string" },
        canonical_url: { type: "string" },
      },
      required: ["agent_id", "id"],
    },
  },
];

const server = new Server({ name: "devto-mcp", version: "1.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  let result: unknown;

  try {
    switch (name) {
      // --- reads: deliberately ungated -------------------------------------
      // Same split gumroad-mcp uses: reads are open, mutations are gated. It
      // matters here because LEDGER holds "finance", not "content", and its
      // whole job is asking whether published work actually earned anything -
      // which it cannot do if analytics require the writer's capability.
      case "devto_get_me":
        result = await client.getMe();
        break;
      case "devto_list_my_articles":
        result = await client.listMyArticles(
          (args.state as ArticleState | undefined) ?? "all",
          args.page as number | undefined,
          args.per_page as number | undefined,
        );
        break;
      case "devto_get_article":
        result = await client.getArticle(args.id as number);
        break;
      case "devto_get_article_by_path":
        result = await client.getArticleByPath(args.username as string, args.slug as string);
        break;
      case "devto_get_article_comments":
        result = await client.getArticleComments(args.article_id as number);
        break;
      case "devto_list_tags":
        result = await client.listTags(args.page as number | undefined, args.per_page as number | undefined);
        break;
      case "devto_search_articles":
        result = await client.searchArticles({
          q: args.q as string | undefined,
          tag: args.tag as string | undefined,
          username: args.username as string | undefined,
          top: args.top as number | undefined,
          page: args.page as number | undefined,
          per_page: args.per_page as number | undefined,
        });
        break;
      case "devto_get_analytics":
        result = await client.getAnalytics(
          args.report as "totals" | "past_day" | "historical" | "referrers",
          args.start as string | undefined,
          args.end as string | undefined,
        );
        break;

      // --- mutations: gated to the "content" capability ---------------------
      case "devto_create_article":
        await requireCapability(args.agent_id as string | undefined, REQUIRED_CAPABILITY);
        await requireBrand(args.task_id as string | undefined, SERVER_BRAND);
        result = await client.createArticle({
          title: args.title as string,
          body_markdown: args.body_markdown as string,
          tags: args.tags as string[] | undefined,
          main_image: args.main_image as string | undefined,
          description: args.description as string | undefined,
          series: args.series as string | undefined,
          canonical_url: args.canonical_url as string | undefined,
        });
        break;
      case "devto_update_article":
        await requireCapability(args.agent_id as string | undefined, REQUIRED_CAPABILITY);
        result = await client.updateArticle(args.id as number, {
          title: args.title as string | undefined,
          body_markdown: args.body_markdown as string | undefined,
          tags: args.tags as string[] | undefined,
          main_image: args.main_image as string | undefined,
          description: args.description as string | undefined,
          series: args.series as string | undefined,
          canonical_url: args.canonical_url as string | undefined,
        });
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    // A capability rejection is an expected, actionable outcome - the caller
    // asked for something its role does not cover. Return it as readable text
    // rather than letting it surface as an unhandled transport error, which is
    // what happened before (CapabilityError was imported but never caught).
    if (err instanceof CapabilityError) {
      return { content: [{ type: "text", text: `Rejected: ${err.message}` }], isError: true };
    }
    throw err;
  }

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("devto-mcp server running on stdio");

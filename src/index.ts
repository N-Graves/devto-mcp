#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import { DevToClient } from "./devto-client.js";
import { CapabilityError, requireCapability } from "./agent-capability.js";

const REQUIRED_CAPABILITY = "content"; // HERALD owns Dev.to content

const API_KEY = process.env.DEVTO_API_KEY;
if (!API_KEY) {
  console.error("DEVTO_API_KEY environment variable is required");
  process.exit(1);
}

const client = new DevToClient(API_KEY);

const tools: Tool[] = [
  {
    name: "devto_get_me",
    description: "Get the authenticated Dev.to user's profile",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "devto_list_my_articles",
    description: "List the authenticated user's articles (published and drafts)",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "Page number, default 1" },
        per_page: { type: "number", description: "Results per page, default 30" },
      },
    },
  },
  {
    name: "devto_get_article",
    description: "Get a single article by its numeric id",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Article id" } },
      required: ["id"],
    },
  },
  {
    name: "devto_create_article",
    description:
      "Create a new Dev.to article (set published:false to save as a draft). Requires agent_id " +
      "(must hold the 'content' capability, e.g. herald).",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Your fleet-board agent id, e.g. 'herald'" },
        title: { type: "string" },
        body_markdown: { type: "string", description: "Full article body in Markdown" },
        published: { type: "boolean", description: "true to publish immediately, false for a draft" },
        tags: { type: "array", items: { type: "string" }, description: "Up to 4 tags" },
        canonical_url: { type: "string", description: "Original URL if this is a cross-post" },
      },
      required: ["agent_id", "title", "body_markdown"],
    },
  },
  {
    name: "devto_update_article",
    description:
      "Update an existing Dev.to article by id. Requires agent_id (must hold the 'content' capability).",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Your fleet-board agent id, e.g. 'herald'" },
        id: { type: "number" },
        title: { type: "string" },
        body_markdown: { type: "string" },
        published: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["agent_id", "id"],
    },
  },
];

const server = new Server({ name: "devto-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  let result: unknown;

  switch (name) {
    case "devto_get_me":
      result = await client.getMe();
      break;
    case "devto_list_my_articles":
      result = await client.listMyArticles(args.page as number | undefined, args.per_page as number | undefined);
      break;
    case "devto_get_article":
      result = await client.getArticle(args.id as number);
      break;
    case "devto_create_article":
      await requireCapability(args.agent_id as string | undefined, REQUIRED_CAPABILITY);
      result = await client.createArticle({
        title: args.title as string,
        body_markdown: args.body_markdown as string,
        published: args.published as boolean | undefined,
        tags: args.tags as string[] | undefined,
        canonical_url: args.canonical_url as string | undefined,
      });
      break;
    case "devto_update_article":
      await requireCapability(args.agent_id as string | undefined, REQUIRED_CAPABILITY);
      result = await client.updateArticle(args.id as number, {
        title: args.title as string | undefined,
        body_markdown: args.body_markdown as string | undefined,
        published: args.published as boolean | undefined,
        tags: args.tags as string[] | undefined,
      });
      break;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("devto-mcp server running on stdio");

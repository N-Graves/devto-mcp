const BASE_URL = "https://dev.to/api";

/**
 * The article fields the Forem API actually accepts on create/update, verified
 * against the official OpenAPI spec (forem/forem swagger/v1/api_v1.json,
 * 2026-07-27) rather than from memory.
 *
 * The spec lists nine: title, body_markdown, published, series, main_image,
 * canonical_url, description, tags, organization_id. Two are deliberately
 * absent here:
 *
 * - `published` - see createArticle/updateArticle. Nothing reachable from an
 *   agent can set it, in either direction.
 * - `organization_id` - the authenticated account (nasdigital, "With Nate")
 *   belongs to no organization; /users/me returns no org fields and
 *   GET /api/organizations 404s on hosted dev.to. Exposing it would be a
 *   dead argument that can only ever be passed wrong. Add it if an org is
 *   created later.
 */
interface ArticlePayload {
  title: string;
  body_markdown: string;
  /** Up to 4 tags. Dev.to silently drops extras. */
  tags?: string[];
  /**
   * Cover image. Must be a PUBLICLY REACHABLE URL - Dev.to fetches it
   * server-side, so a local path from MUSE will not work. Run it through
   * publish_image_public first and pass the returned URL.
   */
  main_image?: string;
  /**
   * The preview/SEO snippet shown in feeds and social cards. If omitted,
   * Dev.to auto-derives it from the opening of the body, which is why every
   * existing NAS Digital article currently has a truncated first paragraph
   * as its description.
   */
  description?: string;
  /** Series name. Setting the same string on several articles groups them. */
  series?: string;
  /** Original URL when the piece is cross-posted from elsewhere. */
  canonical_url?: string;
}

/** Which slice of the author's own articles to list. */
export type ArticleState = "all" | "published" | "unpublished";

export class DevToClient {
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      "api-key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  private async get(path: string): Promise<unknown> {
    const res = await fetch(`${BASE_URL}${path}`, { headers: this.headers() });
    return res.json();
  }

  async getMe(): Promise<unknown> {
    return this.get("/users/me");
  }

  /**
   * List the author's own articles.
   *
   * `state` defaults to "all", which is a deliberate change from the original
   * behaviour. This method used to hit /articles/me unconditionally, and that
   * endpoint returns PUBLISHED articles only - so every draft the fleet has
   * ever created was invisible to it. Since createArticle is hard-coded to
   * produce drafts, that meant HERALD could not see any of its own output.
   * Verified live 2026-07-27: /articles/me returned 2 items while
   * /articles/me/unpublished returned 6 real drafts.
   */
  async listMyArticles(state: ArticleState = "all", page = 1, perPage = 30): Promise<unknown> {
    const suffix = state === "all" ? "/all" : state === "published" ? "/published" : "/unpublished";
    return this.get(`/articles/me${suffix}?page=${page}&per_page=${perPage}`);
  }

  async getArticle(id: number): Promise<unknown> {
    return this.get(`/articles/${id}`);
  }

  /** Fetch a live article from its public path, i.e. dev.to/{username}/{slug}. */
  async getArticleByPath(username: string, slug: string): Promise<unknown> {
    return this.get(`/articles/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`);
  }

  /** Public comment thread for an article. Reader feedback on published work. */
  async getArticleComments(articleId: number): Promise<unknown> {
    return this.get(`/comments?a_id=${articleId}`);
  }

  /** The site's real tag list - tags must exist, so this is how to tag correctly. */
  async listTags(page = 1, perPage = 30): Promise<unknown> {
    return this.get(`/tags?page=${page}&per_page=${perPage}`);
  }

  /**
   * Search/browse other people's published articles - what already exists on a
   * topic, before writing another one.
   */
  async searchArticles(opts: {
    q?: string;
    tag?: string;
    username?: string;
    top?: number;
    page?: number;
    per_page?: number;
  }): Promise<unknown> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined && v !== null && `${v}` !== "") params.set(k, `${v}`);
    }
    // /articles/search only honours q; tag/username/top filtering lives on
    // /articles. Route to whichever the caller actually asked for.
    const path = opts.q ? "/articles/search" : "/articles";
    return this.get(`${path}?${params.toString()}`);
  }

  /**
   * Author analytics. All four reports verified working on this account
   * 2026-07-27 (they are commonly gated on other Forem instances, so this was
   * checked rather than assumed).
   */
  async getAnalytics(
    report: "totals" | "past_day" | "historical" | "referrers",
    start?: string,
    end?: string,
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const qs = params.toString();
    return this.get(`/analytics/${report}${qs ? `?${qs}` : ""}`);
  }

  /**
   * Always creates a DRAFT. `published: false` is hard-coded here, not passed
   * in, so there is no argument any caller can set to make an article go live.
   *
   * Real incident, 2026-07-26: HERALD published two versions of the same
   * product article straight to the live site 52 minutes apart, then submitted
   * the LIVE URL as the output for HITL review - so by the time a human saw it,
   * it had been public for an hour, and the review gate reviewed something it
   * could no longer prevent. The tool description already said to pass
   * `published: false`. Prose lost. Nathan's rule is absolute ("nothing should
   * go live until after I've approved it at HITL, ever"), so it now lives
   * somewhere prose cannot be ignored.
   *
   * Publishing is a human action taken in Dev.to's own UI. That is the whole
   * design, not a missing feature.
   */
  async createArticle(article: ArticlePayload): Promise<unknown> {
    const res = await fetch(`${BASE_URL}/articles`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ article: { ...article, published: false } }),
    });
    return res.json();
  }

  /**
   * Edits an article's content without ever touching its publish state.
   *
   * `published` is stripped rather than forced: forcing false would silently
   * UNPUBLISH a live article the moment an agent fixed a typo in it, which is
   * its own kind of unreviewed change to the public site. Omitting the field
   * leaves Dev.to's stored state exactly as the human last set it - a draft
   * stays a draft, a live post stays live.
   */
  async updateArticle(id: number, article: Partial<ArticlePayload>): Promise<unknown> {
    const content: Record<string, unknown> = { ...article };
    delete content.published;
    // Drop keys the caller left undefined so a partial edit doesn't blank out
    // fields it never mentioned - PUT here is a merge, and sending
    // `"description": null` would really clear it.
    for (const [k, v] of Object.entries(content)) {
      if (v === undefined) delete content[k];
    }
    const res = await fetch(`${BASE_URL}/articles/${id}`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ article: content }),
    });
    return res.json();
  }
}

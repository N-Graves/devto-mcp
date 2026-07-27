const BASE_URL = "https://dev.to/api";

/**
 * Note there is no `published` field, deliberately - see createArticle and
 * updateArticle. Nothing reachable from an agent can set it.
 */
interface ArticlePayload {
  title: string;
  body_markdown: string;
  tags?: string[];
  series?: string;
  canonical_url?: string;
}

export class DevToClient {
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      "api-key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  async getMe(): Promise<unknown> {
    const res = await fetch(`${BASE_URL}/users/me`, { headers: this.headers() });
    return res.json();
  }

  async listMyArticles(page = 1, perPage = 30): Promise<unknown> {
    const res = await fetch(`${BASE_URL}/articles/me?page=${page}&per_page=${perPage}`, {
      headers: this.headers(),
    });
    return res.json();
  }

  async getArticle(id: number): Promise<unknown> {
    const res = await fetch(`${BASE_URL}/articles/${id}`, { headers: this.headers() });
    return res.json();
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
    const { ...content } = article;
    delete (content as Record<string, unknown>).published;
    const res = await fetch(`${BASE_URL}/articles/${id}`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ article: content }),
    });
    return res.json();
  }
}

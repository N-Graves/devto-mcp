const BASE_URL = "https://dev.to/api";

interface ArticlePayload {
  title: string;
  body_markdown: string;
  published?: boolean;
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

  async createArticle(article: ArticlePayload): Promise<unknown> {
    const res = await fetch(`${BASE_URL}/articles`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ article }),
    });
    return res.json();
  }

  async updateArticle(id: number, article: Partial<ArticlePayload>): Promise<unknown> {
    const res = await fetch(`${BASE_URL}/articles/${id}`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ article }),
    });
    return res.json();
  }
}

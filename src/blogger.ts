export interface BloggerPost {
  id?: string;
  title: string;
  content: string;
  labels?: string[];
  url?: string;
  status?: 'DRAFT' | 'LIVE';
  published?: string;
}

export class BloggerClient {
  private blogId: string;
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(blogId: string, clientId: string, clientSecret: string, refreshToken: string) {
    this.blogId = blogId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google OAuth 토큰 갱신 실패: ${err}`);
    }

    const data = (await res.json()) as any;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return this.accessToken!;
  }

  async createDraftPost(title: string, htmlContent: string, labels: string[]): Promise<BloggerPost> {
    const token = await this.getAccessToken();
    const url = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts?isDraft=true`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'blogger#post',
        title,
        content: htmlContent,
        labels,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Blogger Draft 등록 실패: ${err}`);
    }

    const data = (await res.json()) as any;
    return {
      id: data.id,
      title: data.title,
      content: data.content,
      labels: data.labels,
      url: data.url,
      status: 'DRAFT',
    };
  }

  async publishPost(postId: string): Promise<BloggerPost> {
    const token = await this.getAccessToken();
    const url = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts/${postId}/publish`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Blogger 글 발행 실패: ${err}`);
    }

    const data = (await res.json()) as any;
    return {
      id: data.id,
      title: data.title,
      content: data.content,
      labels: data.labels,
      url: data.url,
      status: 'LIVE',
    };
  }

  async getPost(postId: string): Promise<BloggerPost> {
    const token = await this.getAccessToken();
    const url = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts/${postId}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Blogger 글 조회 실패: ${err}`);
    }

    const data = (await res.json()) as any;
    return {
      id: data.id,
      title: data.title,
      content: data.content,
      labels: data.labels,
      url: data.url,
      status: data.status,
    };
  }

  async deletePost(postId: string): Promise<void> {
    const token = await this.getAccessToken();
    const url = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts/${postId}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Blogger 글 삭제 실패: ${err}`);
    }
  }

  async updatePost(postId: string, title: string, content: string, labels: string[] = []): Promise<BloggerPost> {
    const token = await this.getAccessToken();
    const url = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts/${postId}`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'blogger#post',
        id: postId,
        title,
        content,
        labels,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Blogger 글 수정 실패: ${err}`);
    }

    const data = (await res.json()) as any;
    return {
      id: data.id,
      title: data.title,
      content: data.content,
      labels: data.labels,
      url: data.url,
      status: data.status,
    };
  }

  async getPosts(maxResults: number = 30): Promise<BloggerPost[]> {
    const token = await this.getAccessToken();
    const url = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts?maxResults=${maxResults}&fetchBodies=true&status=live`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Blogger 글 목록 조회 실패: ${err}`);
    }

    const data = (await res.json()) as any;
    return (data.items || []).map((item: any) => ({
      id: item.id,
      title: item.title,
      content: item.content,
      labels: item.labels || [],
      url: item.url,
      published: item.published,
      status: 'LIVE',
    }));
  }

  async getPostById(postId: string): Promise<BloggerPost | null> {
    const token = await this.getAccessToken();
    const url = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts/${postId}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      const err = await res.text();
      throw new Error(`Blogger 글 상세 조회 실패: ${err}`);
    }

    const item = (await res.json()) as any;
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      labels: item.labels || [],
      url: item.url,
      published: item.published,
      status: item.status === 'DRAFT' ? 'DRAFT' : 'LIVE',
    };
  }
}

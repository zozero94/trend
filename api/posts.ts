import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BloggerClient } from '../src/blogger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const blogId = process.env.BLOGGER_BLOG_ID || '';
  const clientId = process.env.BLOGGER_CLIENT_ID || '';
  const clientSecret = process.env.BLOGGER_CLIENT_SECRET || '';
  const refreshToken = process.env.BLOGGER_REFRESH_TOKEN || '';

  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { id, category } = req.query;
    const blogger = new BloggerClient(blogId, clientId, clientSecret, refreshToken);

    if (id) {
      const post = await blogger.getPostById(String(id));
      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      const formatted = {
        ID: post.id,
        title: post.title,
        date: post.published || new Date().toISOString(),
        content: post.content,
        categories: { [detectCategory(post.labels || [])]: {} },
        tags: (post.labels || []).reduce((acc: any, t: string) => {
          acc[t] = {};
          return acc;
        }, {}),
      };

      return res.status(200).json(formatted);
    }

    const rawPosts = await blogger.getPosts(30);

    let posts = rawPosts.map((p) => {
      const cat = detectCategory(p.labels || []);
      const excerpt = (p.content || '').replace(/<[^>]*>?/gm, '').trim().slice(0, 180);

      return {
        ID: p.id,
        title: p.title,
        date: p.published || new Date().toISOString(),
        excerpt: `<p>${excerpt}...</p>`,
        content: p.content,
        categories: { [cat]: {} },
        tags: (p.labels || []).reduce((acc: any, t: string) => {
          acc[t] = {};
          return acc;
        }, {}),
      };
    });

    if (category) {
      const catQuery = String(category).replace(/[·\s]/g, '').toLowerCase();
      posts = posts.filter((p) => {
        const catKeys = Object.keys(p.categories || {});
        return catKeys.some((k) => {
          const cleanK = k.replace(/[·\s]/g, '').toLowerCase();
          return cleanK.includes(catQuery) || catQuery.includes(cleanK);
        });
      });
    }

    return res.status(200).json({ found: posts.length, posts });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Failed to fetch posts from Trend Blogger' });
  }
}

function detectCategory(labels: string[]): string {
  const text = labels.join(' ');
  if (text.includes('맛집') || text.includes('핫플') || text.includes('카페')) return '핫플레이스';
  if (text.includes('꿀템') || text.includes('쇼핑') || text.includes('다이소') || text.includes('쿠팡')) return '바이럴쇼핑';
  return '트렌드이슈';
}

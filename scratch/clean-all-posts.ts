import 'dotenv/config';
import { BloggerClient } from '../src/blogger.js';
import { auditAndFixHtmlLinks } from '../src/verifier.js';

async function main() {
  const blogger = new BloggerClient(
    process.env.BLOGGER_BLOG_ID!,
    process.env.BLOGGER_CLIENT_ID!,
    process.env.BLOGGER_CLIENT_SECRET!,
    process.env.BLOGGER_REFRESH_TOKEN!
  );

  const posts = await blogger.getPosts(10);
  const token = await (blogger as any).getAccessToken();

  for (const post of posts) {
    if (!post.id) continue;
    console.log(`Processing post: ${post.id} - ${post.title}`);

    const cleanKw = post.title.replace(/[^\w가-힣\s]/g, '').trim().slice(0, 10);
    const validUrls = {
      youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(post.title)}`,
      naver: `https://m.search.naver.com/search.naver?query=${encodeURIComponent(post.title)}`,
      naverMap: `https://m.map.naver.com/search2/search.naver?query=${encodeURIComponent(post.title)}`,
      coupang: `https://www.coupang.com/np/search?q=${encodeURIComponent(cleanKw)}`,
    };

    let cleaned = auditAndFixHtmlLinks(post.content, validUrls, post.title);

    const url = `https://www.googleapis.com/blogger/v3/blogs/${process.env.BLOGGER_BLOG_ID}/posts/${post.id}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: post.id,
        title: post.title,
        content: cleaned,
        labels: post.labels,
      }),
    });

    if (res.ok) {
      console.log(`✅ Post ${post.id} updated with safe Coupang link + referrerpolicy="no-referrer"!`);
    }
  }
}
main();

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

    const validUrls = {
      youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(post.title)}`,
      naver: `https://m.search.naver.com/search.naver?query=${encodeURIComponent(post.title)}`,
      naverMap: `https://m.map.naver.com/search2/search.naver?query=${encodeURIComponent(post.title)}`,
      coupang: `https://m.coupang.com/nm/search?q=${encodeURIComponent(post.title.slice(0, 10))}`,
    };

    let cleaned = auditAndFixHtmlLinks(post.content, validUrls, post.title);

    // Further explicit cleanups
    cleaned = cleaned.replace(/<div[^>]*>[\s\S]*?(📸|\[이미지:|Alt:|이미지 가이드|포토존)[\s\S]*?<\/div>/gi, '');
    cleaned = cleaned.replace(/📸\s*\[이미지:[^\]]*\]/gi, '');
    cleaned = cleaned.replace(/<p[^>]*>[\s\S]*?📸[\s\S]*?<\/p>/gi, '');
    cleaned = cleaned.replace(/<div[^>]*>[\s\S]*?단톡방 공유용 카톡 템플릿[\s\S]*?<\/div>/gi, '');
    cleaned = cleaned.replace(/<div[^>]*>[\s\S]*?친구에게 공유하고 약속 잡기[\s\S]*?<\/div>/gi, '');
    cleaned = cleaned.replace(/href=['"]https:\/\/(?:www|m)\.coupang\.com\/[^'"]*['"]/g, `href="https://m.coupang.com/nm/search?q=${encodeURIComponent('신라면')}"`);

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
      console.log(`✅ Post ${post.id} cleaned and updated!`);
    }
  }
}
main();

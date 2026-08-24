import 'dotenv/config';
import { BloggerClient } from '../src/blogger.js';

async function main() {
  const blogger = new BloggerClient(
    process.env.BLOGGER_BLOG_ID!,
    process.env.BLOGGER_CLIENT_ID!,
    process.env.BLOGGER_CLIENT_SECRET!,
    process.env.BLOGGER_REFRESH_TOKEN!
  );

  const token = await (blogger as any).getAccessToken();

  // Fetch both LIVE and DRAFT posts
  const url = `https://www.googleapis.com/blogger/v3/blogs/${process.env.BLOGGER_BLOG_ID}/posts?maxResults=50&fetchBodies=true&status=LIVE&status=DRAFT`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = (await res.json()) as any;
  const items = data.items || [];

  console.log(`Found ${items.length} total posts (LIVE + DRAFT):`);

  for (const post of items) {
    console.log(`\n--------------------------------------------------`);
    console.log(`ID: ${post.id} | STATUS: ${post.status} | TITLE: ${post.title}`);

    if (post.content.includes('사진') || post.content.includes('이미지') || post.content.includes('영역') || post.content.includes('포토존')) {
      console.log('  ⚠️ MATCH FOUND in content!');
      const matches = post.content.match(/\[[^\]]*(사진|이미지|영역|포토존)[^\]]*\]/gi) || [];
      console.log('  Matches:', matches);

      // Clean all bracketed image/photo placeholders
      let cleaned = post.content;
      cleaned = cleaned.replace(/\[[^\]]*(사진|이미지|영역|포토존|가이드)[^\]]*\]/gi, '');
      cleaned = cleaned.replace(/<div[^>]*>[\s\S]*?(📸|\[이미지:|Alt:|이미지 가이드|포토존|사진 영역)[\s\S]*?<\/div>/gi, '');
      cleaned = cleaned.replace(/<p[^>]*>[\s\S]*?(📸|사진 영역|이미지 영역)[\s\S]*?<\/p>/gi, '');
      cleaned = cleaned.replace(/<!--[\s\S]*?-->/gi, '');

      // Update post in Blogger
      const updateUrl = `https://www.googleapis.com/blogger/v3/blogs/${process.env.BLOGGER_BLOG_ID}/posts/${post.id}`;
      const updateRes = await fetch(updateUrl, {
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

      if (updateRes.ok) {
        console.log(`  ✅ Successfully purged and updated post ${post.id}!`);
      } else {
        console.error(`  ❌ Update failed:`, await updateRes.text());
      }
    }
  }
}
main();

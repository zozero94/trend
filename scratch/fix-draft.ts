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

  const postId = '3345858965161476618';
  const post = await blogger.getPost(postId);

  const validUrls = {
    youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent('신라면 팝업스토어')}`,
    naver: `https://m.search.naver.com/search.naver?query=${encodeURIComponent('성수동 신라면 분식')}`,
    naverMap: `https://m.map.naver.com/search2/search.naver?query=${encodeURIComponent('성수동 신라면 분식')}`,
    coupang: `https://www.coupang.com/np/search?q=${encodeURIComponent('신라면')}`,
  };

  let cleanContent = auditAndFixHtmlLinks(post.content, validUrls, '성수동 신라면 분식', 'HOT_PLACE');

  // Update post in Blogger
  const token = await (blogger as any).getAccessToken();
  const url = `https://www.googleapis.com/blogger/v3/blogs/${process.env.BLOGGER_BLOG_ID}/posts/${postId}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: postId,
      title: post.title,
      content: cleanContent,
      labels: post.labels,
    }),
  });

  if (res.ok) {
    console.log('✅ Post 3345858965161476618 updated with real image, fixed map link, and removed kakao dummy box!');
  } else {
    console.error('Update failed:', await res.text());
  }
}
main();

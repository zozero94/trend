import 'dotenv/config';
import { BloggerClient } from '../src/blogger.js';

async function main() {
  const blogger = new BloggerClient(
    process.env.BLOGGER_BLOG_ID!,
    process.env.BLOGGER_CLIENT_ID!,
    process.env.BLOGGER_CLIENT_SECRET!,
    process.env.BLOGGER_REFRESH_TOKEN!
  );

  const postId = '3755351522176544124';
  const post = await blogger.getPost(postId);
  const token = await (blogger as any).getAccessToken();

  let content = post.content;

  // Add official MU:DS direct link banner
  const officialBanner = `
  <div style="margin: 28px 0; padding: 20px; background: #fdf6e3; border-radius: 12px; border: 1px solid #d4a373; text-align: center;">
    <p style="margin: 0 0 10px 0; font-size: 15px; font-weight: bold; color: #7f4f24;">🏛️ 국립박물관 문화재단 공식 인증 판매처</p>
    <a href="https://www.museumshop.or.kr" target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer" style="display: inline-block; padding: 12px 24px; background: #7f4f24; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 10px rgba(127,79,36,0.25);">
      🔗 [뮷즈 MU:DS 공식몰] 국새 키링 실시간 재고 & 예약 바로가기 &rarr;
    </a>
    <p style="font-size: 11.5px; color: #936639; margin-top: 8px; margin-bottom: 0;">※ 국립중앙박물관 문화상품 공식 온라인 스토어로 안전하게 직통 연결됩니다.</p>
  </div>`;

  if (!content.includes('museumshop.or.kr')) {
    // Insert after 3-line summary
    if (content.includes('</div>')) {
      const idx = content.indexOf('</div>') + 6;
      content = content.slice(0, idx) + officialBanner + content.slice(idx);
    } else {
      content = officialBanner + content;
    }
  }

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
      content,
      labels: post.labels,
    }),
  });

  if (res.ok) {
    console.log(`✅ Post ${postId} (국새 키링) updated with official MU:DS mall direct link!`);
  } else {
    console.error('Update failed:', await res.text());
  }
}
main();

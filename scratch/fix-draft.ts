import 'dotenv/config';
import { BloggerClient } from '../src/blogger.js';

async function main() {
  const blogger = new BloggerClient(
    process.env.BLOGGER_BLOG_ID!,
    process.env.BLOGGER_CLIENT_ID!,
    process.env.BLOGGER_CLIENT_SECRET!,
    process.env.BLOGGER_REFRESH_TOKEN!
  );

  const postId = '3345858965161476618';
  const post = await blogger.getPost(postId);

  let updatedContent = post.content.replace(
    /href=['"]https:\/\/www\.coupang\.com\/np\/search\?component=&q=%EC%8B%A0%EB%9D%BC%EB%A9%B4&channel=user['"]/g,
    `href="https://www.coupang.com/np/search?q=%EC%8B%A0%EB%9D%BC%EB%A9%B4"`
  );

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
      content: updatedContent,
      labels: post.labels,
    }),
  });

  if (res.ok) {
    console.log('✅ Draft post Coupang URL updated successfully!');
  } else {
    console.error('Update failed:', await res.text());
  }
}
main();

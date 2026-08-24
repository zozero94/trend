import 'dotenv/config';
import { BloggerClient } from '../src/blogger.js';

async function main() {
  const blogger = new BloggerClient(
    process.env.BLOGGER_BLOG_ID!,
    process.env.BLOGGER_CLIENT_ID!,
    process.env.BLOGGER_CLIENT_SECRET!,
    process.env.BLOGGER_REFRESH_TOKEN!
  );
  const post = await blogger.getPost('3345858965161476618');
  console.log('TITLE:', post.title);
  console.log('FULL CONTENT:');
  console.log(post.content);
}
main();

import 'dotenv/config';
import { BloggerClient } from '../src/blogger.js';

async function main() {
  const blogger = new BloggerClient(
    process.env.BLOGGER_BLOG_ID!,
    process.env.BLOGGER_CLIENT_ID!,
    process.env.BLOGGER_CLIENT_SECRET!,
    process.env.BLOGGER_REFRESH_TOKEN!
  );
  const posts = await blogger.getPosts(5);
  for (const p of posts) {
    console.log('\n=============================================');
    console.log('ID:', p.id, '| TITLE:', p.title);
    console.log('CONTENT SNIPPET:\n', p.content.slice(0, 500));
    console.log('ALL LINKS:', p.content.match(/href=['"][^'"]*['"]/gi));
    console.log('ALL DIVS/IMAGES:', p.content.match(/<div[^>]*>[\s\S]*?<\/div>/gi)?.filter(d => d.includes('이미지') || d.includes('Alt:')));
  }
}
main();

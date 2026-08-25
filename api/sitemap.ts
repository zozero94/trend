import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BloggerClient } from '../src/blogger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const blogId = process.env.BLOGGER_BLOG_ID || '2498717653629376483';
  const clientId = process.env.BLOGGER_CLIENT_ID || '';
  const clientSecret = process.env.BLOGGER_CLIENT_SECRET || '';
  const refreshToken = process.env.BLOGGER_REFRESH_TOKEN || '';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const domain = 'https://trend.zozero94.com';

  try {
    const blogger = new BloggerClient(blogId, clientId, clientSecret, refreshToken);
    const posts = await blogger.getPosts(50);

    const postUrls = posts
      .map((p) => {
        const lastMod = p.published ? new Date(p.published).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        return `
  <url>
    <loc>${domain}/post.html?id=${p.id}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`;
      })
      .join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${domain}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${domain}/about.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${domain}/privacy.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${domain}/disclaimer.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>${postUrls}
</urlset>`;

    return res.status(200).send(xml);
  } catch (error) {
    console.error('Sitemap Error:', error);
    const fallbackXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${domain}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <priority>1.0</priority>
  </url>
</urlset>`;
    return res.status(200).send(fallbackXml);
  }
}

import { createRssXml } from '@/lib/rss';

export async function GET() {
  return new Response(createRssXml(), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

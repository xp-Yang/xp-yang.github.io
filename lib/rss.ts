import { contentHref, getLatestWriting } from '@/lib/content';
import { siteConfig } from '@/site.config';

const escapeXml = (value: string) =>
  value.replace(
    /[<>&'"]/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;',
      })[character] ?? character,
  );

export function createRssXml() {
  const items = getLatestWriting(50)
    .map(
      (item) => `
    <item>
      <title>${escapeXml(item.title)}</title>
      <description>${escapeXml(item.summary)}</description>
      <link>${escapeXml(new URL(contentHref(item), siteConfig.siteUrl).toString())}</link>
      <guid>${escapeXml(new URL(contentHref(item), siteConfig.siteUrl).toString())}</guid>
      <pubDate>${new Date(`${item.publishedAt}T00:00:00Z`).toUTCString()}</pubDate>
    </item>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" ?>
  <rss version="2.0">
    <channel>
      <title>${escapeXml(siteConfig.name)}｜创作与技术档案</title>
      <description>${escapeXml(siteConfig.description)}</description>
      <link>${escapeXml(siteConfig.siteUrl)}</link>${items}
    </channel>
  </rss>`;
}

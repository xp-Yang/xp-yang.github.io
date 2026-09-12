import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { createRssXml } from '../lib/rss';
import sitemap from '../app/sitemap';

const outputPath = resolve(process.argv[2] ?? 'dist/client/rss.xml');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, createRssXml(), 'utf8');

// Pages serves directory indexes, including /works/ where both a collection and
// detail pages exist. Keep the flat export files for compatibility with Vinext.
async function addDirectoryIndexes(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !entry.name.startsWith('_')) {
        await addDirectoryIndexes(entryPath);
      }
    } else if (
      entry.name.endsWith('.html') &&
      !['index.html', '404.html'].includes(entry.name)
    ) {
      const pageDirectory = join(directory, basename(entry.name, '.html'));
      await mkdir(pageDirectory, { recursive: true });
      await copyFile(entryPath, join(pageDirectory, 'index.html'));
    }
  }
}

await addDirectoryIndexes(dirname(outputPath));

const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[character] ?? character,
  );
const urls = sitemap()
  .map((entry) => {
    const lastModified =
      entry.lastModified instanceof Date
        ? entry.lastModified.toISOString()
        : entry.lastModified;
    return `<url><loc>${escapeXml(entry.url)}</loc>${lastModified ? `<lastmod>${escapeXml(lastModified)}</lastmod>` : ''}</url>`;
  })
  .join('\n');
await writeFile(
  join(dirname(outputPath), 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
  'utf8',
);

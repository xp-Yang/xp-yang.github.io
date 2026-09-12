import { Client } from '@notionhq/client';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { isPublished, normalizePage, plainText, toSpans, validateUniqueSlugs } from './notion-core';
import type { ContentBlock, ContentItem, ContentSnapshot } from '../types/content';

type NotionRecord = Record<string, any>;

try {
  loadEnvFile('.env.local');
} catch {
  // CI or an already configured shell can provide environment variables directly.
}

const projectRoot = process.cwd();
const outputFile = path.join(projectRoot, 'content', 'content.json');
const finalAssetRoot = path.join(projectRoot, 'public', 'content', 'notion');
const stagingRoot = path.join(projectRoot, 'work', `notion-sync-${Date.now()}`);
const stagingAssetRoot = path.join(stagingRoot, 'assets');

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

if (!token || !databaseId) {
  console.error('缺少 NOTION_TOKEN 或 NOTION_DATABASE_ID。请复制 .env.example 为 .env.local 并填写。');
  process.exit(1);
}

const notion = new Client({ auth: token });
const notionDatabaseId = databaseId as string;

async function queryAllPages(): Promise<NotionRecord[]> {
  const pages: NotionRecord[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({ data_source_id: notionDatabaseId, start_cursor: cursor, page_size: 100 });
    pages.push(...(response.results as NotionRecord[]));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return pages;
}

async function listChildren(blockId: string): Promise<NotionRecord[]> {
  const blocks: NotionRecord[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    blocks.push(...(response.results as NotionRecord[]));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return blocks;
}

function extensionFor(sourceUrl: string, contentType: string | null): string {
  const pathname = new URL(sourceUrl).pathname;
  const fromPath = path.extname(pathname).toLowerCase();
  if (/^\.[a-z0-9]{1,5}$/.test(fromPath)) return fromPath;
  const known: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
  return known[contentType ?? ''] ?? '.bin';
}

async function downloadAsset(sourceUrl: string, pageId: string, assetId: string): Promise<string> {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`下载图片失败 (${response.status})：${sourceUrl}`);
  const extension = extensionFor(sourceUrl, response.headers.get('content-type'));
  const safePageId = pageId.replace(/[^a-zA-Z0-9-]/g, '');
  const safeAssetId = assetId.replace(/[^a-zA-Z0-9-]/g, '');
  const relativeDir = safePageId;
  const fileName = `${safeAssetId}${extension}`;
  const targetDir = path.join(stagingAssetRoot, relativeDir);
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, fileName), Buffer.from(await response.arrayBuffer()));
  return `/content/notion/${relativeDir}/${fileName}`;
}

function sourceUrl(value: NotionRecord | undefined): string | undefined {
  if (!value) return undefined;
  if (value.type === 'file') return value.file?.url;
  if (value.type === 'external') return value.external?.url;
  return value.file?.url ?? value.external?.url;
}

async function transformBlocks(pageId: string, parentId: string): Promise<ContentBlock[]> {
  const rawBlocks = await listChildren(parentId);
  const blocks: ContentBlock[] = [];

  for (const block of rawBlocks) {
    const id = block.id;
    const data = block[block.type] ?? {};
    if (['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote'].includes(block.type)) {
      blocks.push({ id, type: block.type, spans: toSpans(data.rich_text) } as ContentBlock);
    } else if (block.type === 'callout') {
      blocks.push({ id, type: 'callout', spans: toSpans(data.rich_text), icon: data.icon?.emoji ?? '✦' });
    } else if (block.type === 'code') {
      blocks.push({ id, type: 'code', code: plainText(data.rich_text), language: data.language, caption: plainText(data.caption) || undefined });
    } else if (block.type === 'image') {
      const url = sourceUrl(data);
      if (url) {
        const caption = plainText(data.caption) || undefined;
        blocks.push({ id, type: 'image', url: await downloadAsset(url, pageId, id), alt: caption ?? '文章配图', caption });
      }
    } else if (block.type === 'divider') {
      blocks.push({ id, type: 'divider' });
    } else if (block.type === 'table') {
      const rowBlocks = await listChildren(id);
      blocks.push({ id, type: 'table', hasColumnHeader: Boolean(data.has_column_header), rows: rowBlocks.filter((row) => row.type === 'table_row').map((row) => (row.table_row?.cells ?? []).map((cell: NotionRecord[]) => plainText(cell))) });
    } else {
      blocks.push({ id, type: 'unsupported', label: block.type, text: plainText(data.rich_text) || undefined });
    }

    if (block.has_children && block.type !== 'table') blocks.push(...(await transformBlocks(pageId, id)));
  }

  return blocks;
}

async function coverForPage(page: NotionRecord): Promise<string | undefined> {
  const coverFiles = page.properties?.Cover?.files;
  const file = Array.isArray(coverFiles) ? coverFiles[0] : undefined;
  const url = sourceUrl(file);
  return url ? downloadAsset(url, page.id, 'cover') : undefined;
}

async function writeSnapshot(items: ContentItem[]): Promise<void> {
  const snapshot: ContentSnapshot = { syncedAt: new Date().toISOString(), source: 'notion', items };
  const temporaryFile = path.join(stagingRoot, 'content.json');
  await writeFile(temporaryFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await mkdir(path.dirname(outputFile), { recursive: true });
  await mkdir(finalAssetRoot, { recursive: true });
  await cp(stagingAssetRoot, finalAssetRoot, { recursive: true, force: true });
  await cp(temporaryFile, outputFile, { force: true });
}

async function main() {
  await mkdir(stagingAssetRoot, { recursive: true });
  const pages = await queryAllPages();
  const items: ContentItem[] = [];

  for (const page of pages) {
    try {
      if (!page.properties) continue;
      if (!isPublished(page)) continue;
      const blocks = await transformBlocks(page.id, page.id);
      const item = normalizePage(page, blocks, await coverForPage(page));
      if (item) items.push(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`同步页面 ${page.url ?? page.id} 时失败：${message}`);
    }
  }

  validateUniqueSlugs(items);
  items.sort((a, b) => a.order - b.order || b.publishedAt.localeCompare(a.publishedAt));
  await writeSnapshot(items);
  console.log(`同步完成：${items.length} 条已发布内容。`);
}

main().catch(async (error) => {
  const previous = await readFile(outputFile, 'utf8').catch(() => null);
  console.error(error instanceof Error ? error.message : error);
  console.error(previous ? '原有内容快照保持不变。' : '尚无可保留的内容快照。');
  process.exitCode = 1;
}).finally(() => rm(stagingRoot, { recursive: true, force: true }));

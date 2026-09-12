import { z } from 'zod';

import type { ContentBlock, ContentItem, ContentType, DemoMode, RichTextSpan } from '../types/content';

type NotionRecord = Record<string, any>;

const contentTypeSchema = z.enum(['Project', 'Blog', 'Literature', 'Note']);
const demoModeSchema = z.enum(['Embed', 'Link']);

export function plainText(richText: NotionRecord[] | undefined): string {
  return (richText ?? []).map((span) => span.plain_text ?? span.text?.content ?? '').join('');
}

export function toSpans(richText: NotionRecord[] | undefined): RichTextSpan[] {
  return (richText ?? []).map((span) => ({
    text: span.plain_text ?? span.text?.content ?? '',
    href: span.href ?? span.text?.link?.url ?? undefined,
    bold: Boolean(span.annotations?.bold),
    italic: Boolean(span.annotations?.italic),
    code: Boolean(span.annotations?.code),
    strikethrough: Boolean(span.annotations?.strikethrough),
    underline: Boolean(span.annotations?.underline),
  }));
}

function property(page: NotionRecord, name: string): NotionRecord | undefined {
  return page.properties?.[name];
}

function propertyText(page: NotionRecord, name: string): string {
  const value = property(page, name);
  if (!value) return '';
  if (value.type === 'title') return plainText(value.title);
  if (value.type === 'rich_text') return plainText(value.rich_text);
  return '';
}

function propertyChoice(page: NotionRecord, name: string): string {
  const value = property(page, name);
  if (!value) return '';
  if (value.type === 'select') return value.select?.name ?? '';
  if (value.type === 'status') return value.status?.name ?? '';
  return '';
}

function propertyUrl(page: NotionRecord, name: string): string | undefined {
  const value = property(page, name);
  return value?.type === 'url' && value.url ? value.url : undefined;
}

function propertyTags(page: NotionRecord, name: string): string[] {
  const value = property(page, name);
  return value?.type === 'multi_select' ? value.multi_select.map((option: NotionRecord) => option.name).filter(Boolean) : [];
}

function safeHttpsUrl(value: string | undefined, field: string, title: string): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`页面“${title}”的 ${field} 不是有效 URL。`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`页面“${title}”的 ${field} 必须使用 HTTPS。`);
  return parsed.toString();
}

function excerptFromBlocks(blocks: ContentBlock[]): string {
  const paragraph = blocks.find((block) => 'spans' in block && block.spans.some((span) => span.text.trim()));
  if (!paragraph || !('spans' in paragraph)) return '';
  const value = paragraph.spans.map((span) => span.text).join('').trim();
  return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}

export function isPublished(page: NotionRecord): boolean {
  const status = propertyChoice(page, 'Status');
  if (!status) throw new Error(`Notion 页面 ${page.id ?? '(unknown)'} 缺少必填字段 Status。`);
  return status === 'Published';
}

export function normalizePage(page: NotionRecord, blocks: ContentBlock[], cover?: string): ContentItem | null {
  if (!isPublished(page)) return null;

  const title = propertyText(page, 'Title').trim();
  const slug = propertyText(page, 'Slug').trim();
  const typeValue = propertyChoice(page, 'Type');
  const publishedAt = property(page, 'PublishedAt')?.date?.start;
  const identity = title || page.id || '(unknown)';

  if (!title) throw new Error(`页面 ${page.id} 缺少必填字段 Title。`);
  if (!slug) throw new Error(`页面“${title}”缺少必填字段 Slug。`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`页面“${title}”的 Slug 只能包含小写字母、数字和单个连字符。`);
  const type = contentTypeSchema.parse(typeValue) as ContentType;
  if (!publishedAt) throw new Error(`页面“${title}”缺少必填字段 PublishedAt。`);

  const summary = propertyText(page, 'Summary').trim() || excerptFromBlocks(blocks);
  const demoModeValue = propertyChoice(page, 'DemoMode');
  let project: ContentItem['project'];

  if (type === 'Project') {
    let demoMode: DemoMode = 'Link';
    if (demoModeValue) {
      const parsed = demoModeSchema.safeParse(demoModeValue);
      if (!parsed.success) throw new Error(`页面“${identity}”的 DemoMode 必须是 Embed 或 Link。`);
      demoMode = parsed.data;
    }
    project = {
      demoMode,
      demoUrl: safeHttpsUrl(propertyUrl(page, 'DemoURL'), 'DemoURL', identity),
      sourceUrl: safeHttpsUrl(propertyUrl(page, 'SourceURL'), 'SourceURL', identity),
      tech: propertyTags(page, 'Tech'),
    };
  }

  return {
    id: page.id,
    slug,
    type,
    title,
    summary,
    publishedAt: publishedAt.slice(0, 10),
    updatedAt: page.last_edited_time?.slice(0, 10),
    tags: propertyTags(page, 'Tags'),
    cover,
    featured: property(page, 'Featured')?.checkbox === true,
    order: property(page, 'Order')?.number ?? 999,
    blocks,
    project,
  };
}

export function validateUniqueSlugs(items: ContentItem[]): void {
  const seen = new Map<string, string>();
  for (const item of items) {
    const previous = seen.get(item.slug);
    if (previous) throw new Error(`Slug“${item.slug}”重复：${previous} / ${item.title}。`);
    seen.set(item.slug, item.title);
  }
}

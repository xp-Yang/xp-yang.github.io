import snapshotJson from '@/content/content.json';
import localProjects from '@/content/local-projects.json';
import type { ContentItem, ContentSnapshot, ContentType } from '@/types/content';

const localItems = localProjects as ContentItem[];
const snapshot: ContentSnapshot = {
  ...(snapshotJson as ContentSnapshot),
  items: [...localItems, ...snapshotJson.items.filter(item => !localItems.some(local => local.id === item.id || (local.type === item.type && local.slug === item.slug))) as ContentItem[]],
};

export const contentLabels: Record<ContentType, { title: string; eyebrow: string; description: string }> = {
  Project: {
    title: '作品与实验',
    eyebrow: 'Interactive archive',
    description: '浏览器里的小游戏、实时图形和那些值得被保存的实验。',
  },
  Blog: {
    title: '博客',
    eyebrow: 'Essays & opinions',
    description: '关于技术、设计和创作过程的个人思考。',
  },
  Literature: {
    title: '文学',
    eyebrow: 'Prose & poetry',
    description: '短文章、现代诗，以及语言尚未抵达的地方。',
  },
  Note: {
    title: '学习笔记',
    eyebrow: 'Learning log',
    description: '把模糊的理解拆开、验证，再重新组织成可以返回的路径。',
  },
};

export function getSnapshot(): ContentSnapshot {
  return snapshot;
}

export function getAllContent(): ContentItem[] {
  return [...snapshot.items].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

export function getContentByType(type: ContentType): ContentItem[] {
  return getAllContent().filter((item) => item.type === type);
}

export function getContentItem(type: ContentType, slug: string): ContentItem | undefined {
  return snapshot.items.find((item) => item.type === type && item.slug === slug);
}

export function getFeatured(type?: ContentType, limit = 3): ContentItem[] {
  const items = type ? getContentByType(type) : getAllContent();
  return items.filter((item) => item.featured).slice(0, limit);
}

export function getLatestWriting(limit = 4): ContentItem[] {
  return getWritingContent().slice(0, limit);
}

export function getWritingContent(): ContentItem[] {
  return getAllContent()
    .filter((item) => item.type !== 'Project')
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function getWritingItem(slug: string): ContentItem | undefined {
  return snapshot.items.find((item) => item.type !== 'Project' && item.slug === slug);
}

export function getWritingCategory(item: Pick<ContentItem, 'type' | 'tags'>): '文章' | '小说' | '诗' | '笔记' {
  const tags = item.tags.join(' ').toLowerCase();
  if (tags.includes('小说') || tags.includes('fiction')) return '小说';
  if (tags.includes('诗') || tags.includes('poetry')) return '诗';
  if (item.type === 'Note' || tags.includes('笔记') || tags.includes('note')) return '笔记';
  return '文章';
}

export function contentHref(item: Pick<ContentItem, 'type' | 'slug'>): string {
  return item.type === 'Project' ? `/works/${item.slug}` : `/blog/${item.slug}`;
}

export function formatContentDate(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function estimateReadingTime(item: ContentItem): number {
  const characters = item.blocks.reduce((total, block) => {
    if ('spans' in block) return total + block.spans.reduce((count, span) => count + span.text.length, 0);
    if (block.type === 'code') return total + block.code.length;
    if (block.type === 'table') return total + block.rows.flat().join('').length;
    return total;
  }, 0);
  return Math.max(1, Math.ceil(characters / 500));
}

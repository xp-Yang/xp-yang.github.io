import type { Metadata } from 'next';

import { siteConfig } from '@/site.config';
import type { ContentItem } from '@/types/content';

export function createContentMetadata(item: ContentItem | undefined): Metadata {
  if (!item) return {};
  const image = item.cover ? new URL(item.cover, siteConfig.siteUrl).toString() : undefined;
  return {
    title: item.title,
    description: item.summary,
    openGraph: {
      type: 'article',
      title: item.title,
      description: item.summary,
      publishedTime: item.publishedAt,
      tags: item.tags,
      images: image ? [{ url: image, alt: item.title }] : [],
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: item.title,
      description: item.summary,
      images: image ? [image] : [],
    },
  };
}

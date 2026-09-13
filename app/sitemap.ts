import type { MetadataRoute } from 'next';

import { contentHref, getAllContent } from '@/lib/content';
import { siteConfig } from '@/site.config';
import { shaderExamples } from '@/lib/shader-examples';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ['', '/works', '/blog'];
  return [
    ...shaderExamples.map((item) => ({ url: new URL(`/works/shaders/${item.slug}/`, siteConfig.siteUrl).toString(), changeFrequency: 'monthly' as const, priority: 0.7 })),
    ...staticRoutes.map((path) => ({ url: new URL(path || '/', siteConfig.siteUrl).toString(), lastModified: new Date(), changeFrequency: path ? ('weekly' as const) : ('daily' as const), priority: path ? 0.8 : 1 })),
    ...getAllContent().map((item) => ({ url: new URL(contentHref(item), siteConfig.siteUrl).toString(), lastModified: new Date(item.updatedAt ?? item.publishedAt), changeFrequency: 'monthly' as const, priority: item.type === 'Project' ? 0.8 : 0.7 })),
  ];
}

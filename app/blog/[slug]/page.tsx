import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ContentDetail } from '@/components/content-detail';
import { createContentMetadata } from '@/lib/content-metadata';
import { getWritingContent, getWritingItem } from '@/lib/content';

export function generateStaticParams() {
  return getWritingContent().map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return createContentMetadata(getWritingItem(slug));
}

export default async function BlogDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = getWritingItem(slug);
  if (!item) notFound();
  return <ContentDetail item={item} />;
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProjectExperience } from '@/components/project-experience';
import { createContentMetadata } from '@/lib/content-metadata';
import { getContentByType, getContentItem } from '@/lib/content';

export function generateStaticParams() {
  return getContentByType('Project').map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return createContentMetadata(getContentItem('Project', slug));
}

export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = getContentItem('Project', slug);
  if (!item) notFound();
  const projects = getContentByType('Project');
  const index = projects.findIndex((project) => project.slug === slug);
  return (
    <ProjectExperience
      item={item}
      index={Math.max(0, index)}
      total={projects.length}
    />
  );
}

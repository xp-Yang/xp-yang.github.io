import { LegacyBlogRedirect } from '@/components/legacy-blog-redirect';
import { getWritingContent } from '@/lib/content';

export function generateStaticParams() {
  return getWritingContent().map(({ slug }) => ({ slug }));
}

export default async function LiteratureDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <LegacyBlogRedirect slug={slug} />;
}

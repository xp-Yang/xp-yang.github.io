import type { Metadata } from 'next';

import { ContentCard } from '@/components/content-card';
import { PageHeader } from '@/components/page-header';
import { getWritingContent } from '@/lib/content';

export const metadata: Metadata = { title: '博客', description: '文章、小说、诗与学习笔记。' };

export default function BlogPage() {
  const items = getWritingContent();
  return (
    <main className="min-h-screen bg-[#050608]">
      <PageHeader eyebrow="Writing archive" title="博客" description="文章、小说、诗与学习笔记。" count={items.length} />
      <section className="site-shell py-10 md:py-16">
        {items.length > 0 ? items.map((item, index) => <ContentCard key={item.id} item={item} index={index} />) : <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-white/15 text-center text-stone-500">这里还没有已发布内容。</div>}
      </section>
    </main>
  );
}

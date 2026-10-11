import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { WorksGallery } from '@/components/works-gallery';
import { ShaderGallery } from '@/components/shader-gallery';
import { contentLabels, getContentByType } from '@/lib/content';

export const metadata: Metadata = {
  title: '作品与实验',
  description: '浏览器里的小游戏、实时图形和互动实验。',
};

export default function WorksPage() {
  const items = getContentByType('Project');
  const gameSlugs = new Set(['inkloop', 'pindou']);
  const works = items.filter((item) => !gameSlugs.has(item.slug));
  const games = items.filter((item) => gameSlugs.has(item.slug));

  return (
    <main className="min-h-screen bg-[#050608]">
      <PageHeader eyebrow={contentLabels.Project.eyebrow} title={contentLabels.Project.title} />
      <section aria-labelledby="works-heading" className="site-shell mb-8 border-b border-white/15 pb-8 pt-10 md:pt-14">
        <h2 id="works-heading" className="mb-6 text-xl font-medium tracking-tight text-stone-100">作品</h2>
        {works.length > 0 ? (
          <WorksGallery items={works} />
        ) : (
          <div className="grid min-h-72 place-items-center border border-dashed border-white/15 text-center text-stone-500">
            这里还没有已发布作品。
          </div>
        )}
      </section>
      <section aria-labelledby="games-heading" className="site-shell mb-8 border-b border-white/15 pb-8">
        <h2 id="games-heading" className="mb-6 text-xl font-medium tracking-tight text-stone-100">小游戏</h2>
        <WorksGallery items={games} />
      </section>
      <section id="shader-examples" aria-labelledby="shader-heading" className="site-shell scroll-mt-24 pb-24">
        <h2 id="shader-heading" className="mb-6 text-xl font-medium tracking-tight text-stone-100">shader</h2>
        <ShaderGallery />
      </section>
    </main>
  );
}

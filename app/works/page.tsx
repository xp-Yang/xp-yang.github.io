import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { WorksGallery } from '@/components/works-gallery';
import { contentLabels, getContentByType } from '@/lib/content';

export const metadata: Metadata = {
  title: '作品与实验',
  description: '浏览器里的小游戏、实时图形和互动实验。',
};

export default function WorksPage() {
  const items = getContentByType('Project');

  return (
    <main className="min-h-screen bg-[#050608]">
      <PageHeader {...contentLabels.Project} count={items.length} />
      <section className="site-shell pb-24 pt-10 md:pt-14">
        {items.length > 0 ? (
          <WorksGallery items={items} />
        ) : (
          <div className="grid min-h-72 place-items-center border border-dashed border-white/15 text-center text-stone-500">
            这里还没有已发布作品。
          </div>
        )}
      </section>
    </main>
  );
}

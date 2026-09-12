import { ContentCard } from '@/components/content-card';
import { PageHeader } from '@/components/page-header';
import { contentLabels, getContentByType } from '@/lib/content';
import type { ContentType } from '@/types/content';

export function ContentArchive({ type }: { type: ContentType }) {
  const items = getContentByType(type);
  const label = contentLabels[type];
  return (
    <main className="min-h-screen bg-[#050608]">
      <PageHeader {...label} count={items.length} />
      <section className="site-shell py-10 md:py-16">
        {items.length > 0 ? items.map((item, index) => <ContentCard key={item.id} item={item} index={index} />) : <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-white/15 text-center text-stone-500">这里还没有已发布内容。</div>}
      </section>
    </main>
  );
}

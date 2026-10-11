'use client';

import { useWorkOpeningTransition } from '@/components/work-opening-transition';
import { contentHref } from '@/lib/content';
import type { ContentItem } from '@/types/content';

export { PROJECT_ORIGIN_KEY } from '@/components/work-opening-transition';

export function WorksGallery({ items }: { items: ContentItem[] }) {
  const { openWork } = useWorkOpeningTransition();

  return (
    <>
      <div className="grid grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((item, index) => (
          <article key={item.id}>
            <a
              href={contentHref(item)}
              onClick={(event) => openWork(event, {
                slug: item.slug,
                href: contentHref(item),
                className: `work-thumbnail work-thumbnail-${(index % 11) + 1}`,
                visual: item.cover && <img src={item.cover} alt="" className="absolute inset-0 h-full w-full object-cover" style={item.slug === 'schwarzschild-event-horizon' ? { objectPosition: '50% 45%' } : undefined} />,
              })}
              className="group block outline-none"
              aria-label={`打开作品：${item.title}`}
            >
              <div
                data-project-thumbnail
                className={`work-thumbnail work-thumbnail-${(index % 11) + 1} relative aspect-[4/3] overflow-hidden transition-[filter,transform] duration-300 ease-out group-hover:scale-[0.985] group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-[#ff9f43] group-focus-visible:ring-offset-4 group-focus-visible:ring-offset-[#050608]`}
              >
                {item.cover && <img src={item.cover} alt="" className="absolute inset-0 h-full w-full object-cover" style={item.slug === 'schwarzschild-event-horizon' ? { objectPosition: '50% 45%' } : undefined} />}
                {item.placeholder && (
                  <span className="absolute left-3 top-3 z-10 bg-black/55 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-stone-300 backdrop-blur-sm">
                    占位
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <span className="mr-2 font-mono text-[10px] text-stone-600">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="inline text-sm font-normal tracking-[-0.015em] text-stone-200 transition-colors group-hover:text-white">
                    {item.title}
                  </h3>
                </div>
                <span className="hidden shrink-0 font-mono text-[9px] tracking-wide text-stone-600 2xl:inline">
                  {item.project?.tech.slice(0, 2).join(' · ')}
                </span>
              </div>
            </a>
          </article>
        ))}
      </div>

    </>
  );
}

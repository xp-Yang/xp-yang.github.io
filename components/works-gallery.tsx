'use client';

import { type MouseEvent, useEffect, useRef, useState } from 'react';

import { contentHref } from '@/lib/content';
import type { ContentItem } from '@/types/content';

export const PROJECT_ORIGIN_KEY = 'event-horizon-project-origin';

type OpeningProject = {
  item: ContentItem;
  index: number;
  rect: { left: number; top: number; width: number; height: number };
  expanded: boolean;
};

function hasModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function WorksGallery({ items }: { items: ContentItem[] }) {
  const [opening, setOpening] = useState<OpeningProject | null>(null);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (navigationTimer.current) clearTimeout(navigationTimer.current);
    },
    [],
  );

  useEffect(() => {
    const restoreGallery = () => setOpening(null);
    window.addEventListener('pageshow', restoreGallery);
    return () => window.removeEventListener('pageshow', restoreGallery);
  }, []);

  const openProject = (
    event: MouseEvent<HTMLAnchorElement>,
    item: ContentItem,
    index: number,
  ) => {
    if (hasModifiedClick(event)) return;
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reducedMotion) return;

    const thumbnail = event.currentTarget.querySelector<HTMLElement>(
      '[data-project-thumbnail]',
    );
    if (!thumbnail) return;
    event.preventDefault();

    const bounds = thumbnail.getBoundingClientRect();
    const rect = {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    window.sessionStorage.setItem(
      PROJECT_ORIGIN_KEY,
      JSON.stringify({
        slug: item.slug,
        rect,
        scrollY: window.scrollY,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );

    setOpening({ item, index, rect, expanded: false });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setOpening((current) =>
          current ? { ...current, expanded: true } : null,
        );
      }),
    );

    navigationTimer.current = setTimeout(
      () => window.location.assign(contentHref(item)),
      620,
    );
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-x-5 gap-y-10 border-t border-white/15 pt-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((item, index) => (
          <article key={item.id}>
            <a
              href={contentHref(item)}
              onClick={(event) => openProject(event, item, index)}
              className="group block outline-none"
              aria-label={`打开作品：${item.title}`}
            >
              <div
                data-project-thumbnail
                className={`work-thumbnail work-thumbnail-${(index % 11) + 1} relative aspect-[4/3] overflow-hidden transition-[filter,transform] duration-300 ease-out group-hover:scale-[0.985] group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-[#ff9f43] group-focus-visible:ring-offset-4 group-focus-visible:ring-offset-[#050608]`}
              >
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
                  <h2 className="inline text-sm font-normal tracking-[-0.015em] text-stone-200 transition-colors group-hover:text-white">
                    {item.title}
                  </h2>
                </div>
                <span className="hidden shrink-0 font-mono text-[9px] tracking-wide text-stone-600 2xl:inline">
                  {item.project?.tech.slice(0, 2).join(' · ')}
                </span>
              </div>
            </a>
          </article>
        ))}
      </div>

      {opening && (
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-[60] overflow-hidden bg-[#050608] transition-[transform,border-radius] duration-[600ms] ease-[cubic-bezier(.22,.72,.15,1)] work-thumbnail work-thumbnail-${(opening.index % 11) + 1}`}
          style={{
            transformOrigin: '0 0',
            transform: opening.expanded
              ? 'translate3d(0,0,0) scale(1)'
              : `translate3d(${opening.rect.left}px,${opening.rect.top}px,0) scale(${opening.rect.width / window.innerWidth},${opening.rect.height / window.innerHeight})`,
            borderRadius: opening.expanded ? 0 : 12,
          }}
        >
          <div
            className={`absolute inset-0 bg-[#050608]/45 transition-opacity duration-300 ${opening.expanded ? 'opacity-100 delay-200' : 'opacity-0'}`}
          />
        </div>
      )}
    </>
  );
}

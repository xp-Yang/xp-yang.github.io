import { ArrowUpRight } from 'lucide-react';

import {
  contentHref,
  contentLabels,
  estimateReadingTime,
  formatContentDate,
  getWritingCategory,
} from '@/lib/content';
import type { ContentItem } from '@/types/content';

export function ContentCard({
  item,
  index,
}: {
  item: ContentItem;
  index: number;
}) {
  const category =
    item.type === 'Project'
      ? contentLabels.Project.title
      : getWritingCategory(item);

  return (
    <article className="group relative border-b border-white/10 py-8 first:border-t md:py-10">
      <a
        href={contentHref(item)}
        className="grid gap-5 md:grid-cols-[4.5rem_1fr_auto] md:items-start"
        aria-label={`阅读：${item.title}`}
      >
        <span className="font-mono text-xs text-[#ffad61]">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">{category}</span>
            {item.placeholder && (
              <span className="rounded-full border border-[#ff9f43]/30 px-2 py-0.5 font-mono text-[9px] uppercase text-[#ffb56f]">
                示例内容
              </span>
            )}
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.03em] transition-colors group-hover:text-[#ffb067] md:text-3xl">
            {item.title}
          </h2>
          <p className="mt-3 max-w-2xl leading-7 text-stone-400">
            {item.summary}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] text-stone-500"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-5 text-xs text-stone-600 md:justify-end">
          <span>{formatContentDate(item.publishedAt)}</span>
          {item.type !== 'Project' && (
            <span>{estimateReadingTime(item)} min</span>
          )}
          <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" />
        </div>
      </a>
    </article>
  );
}

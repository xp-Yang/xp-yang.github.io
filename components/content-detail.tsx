import { ArrowLeft, ExternalLink } from 'lucide-react';

import { ProjectDemo } from '@/components/project-demo';
import { RichContent } from '@/components/rich-content';
import {
  contentLabels,
  estimateReadingTime,
  formatContentDate,
  getWritingCategory,
} from '@/lib/content';
import type { ContentItem } from '@/types/content';

export function ContentDetail({ item }: { item: ContentItem }) {
  const label = contentLabels[item.type];
  const archiveHref = item.type === 'Project' ? '/works' : '/blog';
  const archiveLabel = item.type === 'Project' ? label.title : '博客';
  const category =
    item.type === 'Project' ? label.eyebrow : getWritingCategory(item);
  const headings = item.blocks.flatMap((block) => {
    if (block.type !== 'heading_1' && block.type !== 'heading_2') return [];
    const title = block.spans.map((span) => span.text).join('');
    return [
      {
        id: title
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^\w\u4e00-\u9fff-]/g, ''),
        title,
      },
    ];
  });

  return (
    <main className="min-h-screen bg-[#050608] pb-24 pt-16">
      <header className="border-b border-white/10 pb-14 pt-20 md:pb-20 md:pt-28">
        <div className="site-shell">
          <a
            href={archiveHref}
            className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-white"
          >
            <ArrowLeft className="size-4" />
            返回{archiveLabel}
          </a>
          <div className="mt-12 max-w-4xl">
            <div className="flex flex-wrap items-center gap-3">
              <p className="eyebrow">{category}</p>
              {item.placeholder && (
                <span className="rounded-full border border-[#ff9f43]/30 px-2 py-0.5 font-mono text-[9px] uppercase text-[#ffb56f]">
                  示例内容 · 待替换
                </span>
              )}
            </div>
            <h1
              className={`mt-5 text-balance text-4xl font-medium leading-[1.08] tracking-[-0.045em] md:text-7xl ${item.type === 'Literature' ? 'font-literary' : ''}`}
            >
              {item.title}
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-stone-400">
              {item.summary}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 font-mono text-[10px] uppercase tracking-wider text-stone-600">
              <span>{formatContentDate(item.publishedAt)}</span>
              {item.type !== 'Project' && (
                <span>{estimateReadingTime(item)} min read</span>
              )}
              {item.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>
          </div>
        </div>
      </header>

      {item.type === 'Project' && item.project && (
        <section className="site-shell pt-12 md:pt-16">
          <ProjectDemo project={item.project} title={item.title} />
          <div className="mt-5 flex flex-wrap gap-3">
            {item.project.tech.map((tech) => (
              <span
                key={tech}
                className="rounded-full border border-white/10 px-3 py-1.5 font-mono text-[10px] text-stone-500"
              >
                {tech}
              </span>
            ))}
            {item.project.sourceUrl && (
              <a
                href={item.project.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-2 text-sm text-stone-400 hover:text-white"
              >
                查看源码
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        </section>
      )}

      <div className="site-shell grid gap-14 pt-14 md:grid-cols-[minmax(0,46rem)_1fr] md:pt-20">
        <article className="min-w-0">
          <RichContent
            blocks={item.blocks}
            literary={item.type === 'Literature'}
          />
        </article>
        {item.type === 'Note' && headings.length > 0 && (
          <aside className="hidden md:block">
            <nav
              aria-label="文章目录"
              className="sticky top-28 border-l border-white/10 pl-6"
            >
              <p className="eyebrow mb-4">On this page</p>
              {headings.map((heading) => (
                <a
                  key={heading.id}
                  href={`#${heading.id}`}
                  className="block py-2 text-sm text-stone-500 hover:text-white"
                >
                  {heading.title}
                </a>
              ))}
            </nav>
          </aside>
        )}
      </div>
    </main>
  );
}

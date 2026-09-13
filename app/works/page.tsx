import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { WorksGallery } from '@/components/works-gallery';
import { ShaderGallery } from '@/components/shader-gallery';
import { SHADER_REPOSITORY, shaderExamples } from '@/lib/shader-examples';
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
      <section className="site-shell pb-16 pt-10 md:pt-14">
        {items.length > 0 ? (
          <WorksGallery items={items} />
        ) : (
          <div className="grid min-h-72 place-items-center border border-dashed border-white/15 text-center text-stone-500">
            这里还没有已发布作品。
          </div>
        )}
      </section>
      <section id="shader-examples" aria-labelledby="shader-examples-title" className="site-shell scroll-mt-24 border-t border-white/20 pb-24 pt-10 md:pt-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 font-mono text-xs tracking-[0.16em] text-stone-500">SHADER EXAMPLES / {String(shaderExamples.length).padStart(2, '0')}</p>
            <h2 id="shader-examples-title" className="text-2xl font-medium tracking-wide text-stone-100">Shader 实验</h2>
            <p className="mt-3 text-sm text-stone-400">距离场、噪声与程序化图形。点击画面，打开实时实例。</p>
          </div>
          <a href={SHADER_REPOSITORY} target="_blank" rel="noreferrer" className="py-2 text-sm text-stone-400 underline underline-offset-4 hover:text-white">GitHub 源码 ↗</a>
        </div>
        <ShaderGallery />
      </section>
    </main>
  );
}

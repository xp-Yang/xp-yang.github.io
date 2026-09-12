'use client';

import { Expand, ExternalLink } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import type { ProjectMeta } from '@/types/content';

export function ProjectDemo({ project, title }: { project: ProjectMeta; title: string }) {
  const frameRef = useRef<HTMLDivElement>(null);

  if (!project.demoUrl) {
    return (
      <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-white/15 bg-[#080a0e] px-6 text-center">
        <div className="max-w-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-full border border-white/10 font-mono text-xs text-[#ffad61]">404</span>
          <h2 className="mt-5 text-xl font-medium">Demo 坐标尚未配置</h2>
          <p className="mt-2 leading-7 text-stone-500">在 Notion 的 DemoURL 字段填入项目地址后，这里会自动显示试玩入口。</p>
        </div>
      </div>
    );
  }

  if (project.demoMode === 'Link') {
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border border-white/10 bg-[#080a0e] px-6 text-center">
        <div><p className="mb-5 text-stone-400">这个项目将在新窗口中运行。</p><Button render={<a href={project.demoUrl} target="_blank" rel="noreferrer" />} className="rounded-full px-5">启动项目<ExternalLink /></Button></div>
      </div>
    );
  }

  return (
    <div ref={frameRef} className="overflow-hidden rounded-xl border border-white/10 bg-black">
      <div className="flex items-center justify-between border-b border-white/10 bg-[#090b0f] px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-stone-500">Live demo · {title}</span>
        <div className="flex items-center gap-1">
          <Button aria-label="全屏体验" title="全屏体验" variant="ghost" size="icon-sm" onClick={() => frameRef.current?.requestFullscreen()}><Expand /></Button>
          <Button aria-label="在新窗口打开" title="在新窗口打开" variant="ghost" size="icon-sm" render={<a href={project.demoUrl} target="_blank" rel="noreferrer" />}><ExternalLink /></Button>
        </div>
      </div>
      <iframe title={`${title} 在线演示`} src={project.demoUrl} className="aspect-video min-h-[360px] w-full bg-black" sandbox="allow-scripts allow-pointer-lock allow-forms allow-popups" allow="fullscreen; gamepad" loading="lazy" />
    </div>
  );
}

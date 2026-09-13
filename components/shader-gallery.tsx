'use client';

import { useEffect, useRef, useState } from 'react';
import { shaderExamples, shaderSource } from '@/lib/shader-examples';
import { createShaderRenderer } from '@/lib/shader-renderer';

export function ShaderGallery() {
  const root = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let renderer: ReturnType<typeof createShaderRenderer> | undefined;
    const surface = document.createElement('canvas');
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      try { renderer = createShaderRenderer(surface); }
      catch { setFailed(shaderExamples.map(item => item.slug)); return; }
      let index = 0;
      const next = () => {
        if (cancelled) return;
        const example = shaderExamples[index++];
        if (!example) { renderer?.dispose(true); return; }
        try {
          renderer!.load(shaderSource(example.path), example.vertexPath ? shaderSource(example.vertexPath) : undefined);
          const width = example.slug === 'virus' ? 240 : 400;
          const height = width * 0.75;
          renderer!.draw(width, height, example.time);
          const canvas = root.current?.querySelector<HTMLCanvasElement>(`[data-shader="${example.slug}"]`);
          if (canvas) {
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('无法生成预览');
            context.drawImage(surface, 0, 0);
          }
        } catch (error) {
          console.error(`Shader preview ${example.slug}`, error);
          setFailed(current => [...current, example.slug]);
        }
        timer = setTimeout(next, 32);
      };
      next();
    }, { rootMargin: '150px' });
    if (root.current) observer.observe(root.current);
    return () => { cancelled = true; clearTimeout(timer); observer.disconnect(); renderer?.dispose(true); };
  }, []);

  return (
    <div ref={root} className="grid grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {shaderExamples.map((example, index) => (
        <article key={example.slug}>
          <a href={`/works/shaders/${example.slug}/`} className="group block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ff9f43]" aria-label={`打开 Shader：${example.title}`}>
            <div className="relative aspect-[4/3] overflow-hidden bg-[#0c0e13] transition-transform duration-300 group-hover:scale-[0.985]">
              <canvas data-shader={example.slug} width={400} height={300} className="h-full w-full object-cover" role="img" aria-label={`${example.title}的实际 Shader 静止预览`} />
              {failed.includes(example.slug) && <span className="absolute inset-0 grid place-content-center px-4 text-center text-sm text-stone-400">预览暂不可用<br /><span className="mt-2 text-xs">仍可打开实例与源码</span></span>}
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-normal text-stone-200 group-hover:text-white"><span className="mr-2 font-mono text-[10px] text-stone-500">S{String(index + 1).padStart(2, '0')}</span>{example.title}</h3>
              <span className="font-mono text-[10px] text-stone-500">{example.category}</span>
            </div>
          </a>
        </article>
      ))}
    </div>
  );
}

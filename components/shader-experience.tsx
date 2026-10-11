'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type ShaderExample, shaderSource, shaderSourceUrl } from '@/lib/shader-examples';
import { createShaderRenderer } from '@/lib/shader-renderer';
import { useWorkReady } from '@/components/work-opening-transition';
import { WorkExperienceHeader } from '@/components/work-experience-header';

export function ShaderExperience({ example }: { example: ShaderExample }) {
  const { ready, opening } = useWorkReady(example.slug);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    setPlaying(example.animated && !reduced.matches && !opening);
    const change = () => { if (reduced.matches) setPlaying(false); };
    reduced.addEventListener('change', change);
    return () => reduced.removeEventListener('change', change);
  }, [example, opening]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    let allocated: ReturnType<typeof createShaderRenderer> | undefined;
    try { allocated = createShaderRenderer(canvas); allocated.load(shaderSource(example.path), example.vertexPath ? shaderSource(example.vertexPath) : undefined); setError(''); }
    catch (cause) { allocated?.dispose(); console.error(cause); setError('此设备暂时无法运行这个 Shader，请尝试启用硬件加速或更换浏览器。'); ready(); return; }
    const renderer = allocated;
    let frame = 0;
    let last = 0;
    let time = example.time;
    let width = 1;
    let height = 1;
    let stopped = false;
    let mouse = [0, 0, 0, 0];
    const draw = () => renderer.draw(width, height, time, mouse);
    const resize = () => {
      const bounds = stage.getBoundingClientRect();
      const budget = example.slug === 'virus' ? 180_000 : 600_000;
      const scale = Math.min(devicePixelRatio || 1, 1, Math.sqrt(budget / Math.max(1, bounds.width * bounds.height)));
      width = Math.max(1, Math.round(bounds.width * scale));
      height = Math.max(1, Math.round(bounds.height * scale));
      draw();
    };
    const loop = (now: number) => {
      frame = 0;
      if (stopped || document.hidden || !playingRef.current) { last = 0; return; }
      if (now - last >= 1000 / 30) {
        if (last) time += Math.min((now - last) / 1000, 0.1);
        last = now;
        draw();
      }
      frame = requestAnimationFrame(loop);
    };
    const resume = () => {
      cancelAnimationFrame(frame); frame = 0; last = 0;
      if (!stopped && !document.hidden && playingRef.current) frame = requestAnimationFrame(loop);
    };
    const move = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width * width;
      const y = (1 - (event.clientY - bounds.top) / bounds.height) * height;
      mouse = [x, y, event.buttons ? x : 0, event.buttons ? y : 0];
      if (!playingRef.current) draw();
    };
    const lost = (event: Event) => { event.preventDefault(); stopped = true; cancelAnimationFrame(frame); setError('图形上下文暂时丢失，恢复后将重新加载。'); };
    const restored = () => setRevision(value => value + 1);
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    document.addEventListener('visibilitychange', resume);
    stage.addEventListener('shader-playback', resume);
    resize(); ready(); resume();
    return () => {
      stopped = true; cancelAnimationFrame(frame); observer.disconnect();
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      document.removeEventListener('visibilitychange', resume);
      stage.removeEventListener('shader-playback', resume);
      renderer.dispose();
    };
  }, [example, revision, ready]);

  useEffect(() => { stageRef.current?.dispatchEvent(new Event('shader-playback')); }, [playing]);

  return (
    <main className="fixed inset-0 z-50 overflow-hidden bg-[#050608] text-stone-200">
      <WorkExperienceHeader title={example.title} category={example.category} returnHref="/works/#shader-examples" sourceHref={shaderSourceUrl(example)} />
      <div ref={stageRef} className="absolute inset-0 bg-black">
        <canvas ref={canvasRef} className="block h-full w-full touch-pan-y" aria-label={`${example.title}实时 Shader`} aria-description={[example.summary, example.credit, example.license].filter(Boolean).join(' · ')} />
        {error && <div role="status" className="absolute inset-0 grid place-items-center bg-[#050608] p-8 text-center text-sm text-stone-400">{error}</div>}
        {notice && <p role="status" className="absolute bottom-20 left-4 right-4 rounded bg-black/80 px-4 py-2 text-sm text-stone-300 md:right-auto">{notice}</p>}
        <div className="absolute bottom-4 right-4 flex gap-2">
          {example.animated && <Button type="button" variant="outline" className="border-white/20 bg-black/70 text-stone-100" onClick={() => setPlaying(value => !value)} aria-label={playing ? '暂停动画' : '播放动画'}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}{playing ? '暂停' : '播放'}</Button>}
          <Button type="button" variant="outline" className="border-white/20 bg-black/70 text-stone-100" onClick={async () => {
            try { if (document.fullscreenElement) await document.exitFullscreen(); else await stageRef.current?.requestFullscreen(); }
            catch { setNotice('当前浏览器不支持全屏，请使用横屏或浏览器全屏模式。'); }
          }} aria-label="切换全屏"><Maximize className="size-4" />全屏</Button>
        </div>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { scrollbarGeometry, scrollbarKeyTarget } from '@/lib/scrollbar';

export function OverlayScrollbar() {
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ pointer: number; y: number; scroll: number } | null>(null);
  const [geometry, setGeometry] = useState(() => scrollbarGeometry(1, 1, 1, 0));
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout>;
    const measure = () => {
      frame = 0;
      const page = document.scrollingElement ?? document.documentElement;
      setGeometry(scrollbarGeometry(window.innerHeight, page.scrollHeight, rail.current?.getBoundingClientRect().height ?? 0, window.scrollY));
      setFullscreen(Boolean(document.fullscreenElement));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const onScroll = () => {
      schedule();
      setActive(true);
      clearTimeout(timer);
      timer = setTimeout(() => setActive(false), 1100);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    resize.observe(document.documentElement);
    if (rail.current) resize.observe(rail.current);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('pageshow', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    document.addEventListener('fullscreenchange', schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      resize.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pageshow', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      document.removeEventListener('fullscreenchange', schedule);
    };
  }, []);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !geometry.scrollable) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    let scroll = window.scrollY;
    if (event.target !== thumb.current) {
      const offset = Math.min(geometry.travel, Math.max(0, event.clientY - bounds.top - geometry.thumb / 2));
      scroll = offset / geometry.travel * geometry.maximum;
      window.scrollTo({ top: scroll, behavior: 'instant' });
    }
    drag.current = { pointer: event.pointerId, y: event.clientY, scroll };
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId || !geometry.travel) return;
    const position = current.scroll + (event.clientY - current.y) / geometry.travel * geometry.maximum;
    window.scrollTo({ top: Math.max(0, Math.min(geometry.maximum, position)), behavior: 'instant' });
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = scrollbarKeyTarget(event.key, window.scrollY, window.innerHeight, geometry.maximum, event.shiftKey);
    if (target === null) return;
    event.preventDefault();
    window.scrollTo({ top: target, behavior: 'instant' });
  };

  return (
    <div ref={rail} className="site-scrollbar" role="scrollbar" aria-label="页面滚动条"
      aria-controls="main-content" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={geometry.progress} aria-valuetext={`已滚动 ${geometry.progress}%`}
      aria-hidden={!geometry.scrollable || fullscreen} tabIndex={geometry.scrollable && !fullscreen ? 0 : -1}
      data-visible={geometry.scrollable && !fullscreen} data-active={active || dragging}
      data-dragging={dragging} onPointerDown={start} onPointerMove={move}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={keydown}>
      <span ref={thumb} className="site-scrollbar-thumb" style={{ height: geometry.thumb, transform: `translateY(${geometry.offset}px)` }} />
    </div>
  );
}

'use client';
import { ActionButton, ArrowLeft, ArrowUpRight } from '@/components/ui';

import { useEffect, useRef, useState } from 'react';

export function WorkExperienceHeader({
  title,
  category,
  returnHref = '/works/',
  onBack,
  sourceHref,
  className = '',
}: {
  title: string;
  category?: string;
  returnHref?: string;
  onBack?: () => void;
  sourceHref?: string;
  className?: string;
}) {
  const headerRef = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const update = (y: number) => {
      const bottom = headerRef.current?.getBoundingClientRect().bottom ?? 64;
      setNear(y >= 0 && y <= bottom + 32);
    };
    const move = (event: PointerEvent) => update(event.clientY);
    const hide = () => setNear(false);
    // Pointer events inside the local game frame do not bubble to this page.
    const iframe = headerRef.current?.closest('main')?.querySelector('iframe');
    let frameWindow: Window | null = null;
    const frameMove = (event: PointerEvent) => update(event.clientY + (iframe?.getBoundingClientRect().top ?? 0));
    const connectFrame = () => {
      frameWindow?.removeEventListener('pointermove', frameMove);
      frameWindow = iframe?.contentWindow ?? null;
      frameWindow?.addEventListener('pointermove', frameMove, { passive: true });
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('blur', hide);
    document.documentElement.addEventListener('pointerleave', hide);
    iframe?.addEventListener('load', connectFrame);
    connectFrame();
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('blur', hide);
      document.documentElement.removeEventListener('pointerleave', hide);
      iframe?.removeEventListener('load', connectFrame);
      frameWindow?.removeEventListener('pointermove', frameMove);
    };
  }, []);
  const backClassName = 'flex min-h-10 w-fit items-center gap-2 whitespace-nowrap text-left text-sm text-text-soft hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white';

  return (
    <header ref={headerRef} className={`absolute inset-x-0 top-0 z-[55] grid min-h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-white/10 bg-background px-4 py-3 font-sans transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100 md:px-8 ${near ? 'opacity-100' : 'opacity-25'} ${className}`}>
      {onBack ? (
        <ActionButton type="button" onClick={onBack} className={backClassName}>
          <ArrowLeft className="size-4 shrink-0" />作品合集
        </ActionButton>
      ) : (
        <a href={returnHref} className={backClassName}>
          <ArrowLeft className="size-4 shrink-0" />作品合集
        </a>
      )}
      <h1 className="max-w-[calc(100vw-12rem)] text-center text-sm font-medium text-text-body">
        {title}
        {category && <span className="ml-3 font-mono text-xs text-text-subtle">{category}</span>}
      </h1>
      {sourceHref ? (
        <a href={sourceHref} target="_blank" rel="noreferrer" className="flex min-h-10 w-fit items-center gap-2 justify-self-end whitespace-nowrap text-sm text-text-soft hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
          源码<ArrowUpRight className="size-4 shrink-0" />
        </a>
      ) : <span aria-hidden="true" />}
    </header>
  );
}

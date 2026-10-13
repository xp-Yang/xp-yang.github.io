'use client';
import { ActionButton } from '@/components/ui';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext, type MouseEvent, type ReactNode, useCallback, useContext,
  useEffect, useMemo, useRef, useState,
} from 'react';

export const PROJECT_ORIGIN_KEY = 'event-horizon-project-origin';

const EXPANSION_MS = 600;
const HANDOFF_MS = 180;
type Rect = { left: number; top: number; width: number; height: number };
type OpeningWork = {
  slug: string;
  href: string;
  visual: ReactNode;
  className?: string;
};
type OpeningState = OpeningWork & {
  rect: Rect;
  viewport: { width: number; height: number };
  expanded: boolean;
  ready: boolean;
  fading: boolean;
  slow: boolean;
};
type TransitionContext = {
  openWork: (event: MouseEvent<HTMLAnchorElement>, work: OpeningWork) => void;
  ready: (slug: string) => void;
  openingSlug: string | null;
};
const WorkTransitionContext = createContext<TransitionContext | null>(null);

// The root layout keeps this layer mounted while the destination renders.
export function WorkTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [opening, setOpening] = useState<OpeningState | null>(null);
  const transitioning = opening !== null;
  const active = useRef<OpeningState | null>(null);
  const started = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const frames = useRef<number[]>([]);
  const schedule = useCallback((callback: () => void, delay: number) => {
    timers.current.push(setTimeout(callback, delay));
  }, []);
  const afterPaint = useCallback((callback: () => void) => {
    frames.current.push(requestAnimationFrame(() => {
      frames.current.push(requestAnimationFrame(callback));
    }));
  }, []);
  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout);
    frames.current.forEach(cancelAnimationFrame);
    timers.current = [];
    frames.current = [];
    active.current = null;
    setOpening(null);
  }, []);

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => { if (event.persisted) clear(); };
    window.addEventListener('pageshow', restore);
    window.addEventListener('popstate', clear);
    return () => {
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('popstate', clear);
      timers.current.forEach(clearTimeout);
      frames.current.forEach(cancelAnimationFrame);
    };
  }, [clear]);

  useEffect(() => {
    if (!opening) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [transitioning]);

  const ready = useCallback((slug: string) => {
    const current = active.current;
    if (!current || current.slug !== slug || current.ready) return;
    const remaining = Math.max(0, started.current + EXPANSION_MS - performance.now());
    active.current = { ...current, ready: true };
    setOpening(value => value?.slug === slug ? { ...value, ready: true } : value);
    // Keep the original full-screen expansion and wait for the first frame.
    schedule(() => afterPaint(() => {
      if (active.current?.slug !== slug) return;
      setOpening(value => value ? { ...value, fading: true } : null);
      schedule(clear, HANDOFF_MS);
    }), remaining);
  }, [afterPaint, clear, schedule]);

  const openWork = useCallback((event: MouseEvent<HTMLAnchorElement>, work: OpeningWork) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      event.preventDefault();
      router.push(work.href);
      return;
    }
    const thumbnail = event.currentTarget.querySelector<HTMLElement>('[data-project-thumbnail]');
    if (!thumbnail) return;
    event.preventDefault();
    if (active.current) return;
    const bounds = thumbnail.getBoundingClientRect();
    const rect = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    try {
      window.sessionStorage.setItem(PROJECT_ORIGIN_KEY, JSON.stringify({
        slug: work.slug, rect, scrollY: window.scrollY, viewport,
      }));
    } catch { /* Opening also works without session storage. */ }
    const next = { ...work, rect, viewport, expanded: false, ready: false, fading: false, slow: false };
    active.current = next;
    setOpening(next);
    router.prefetch(work.href);
    afterPaint(() => {
      started.current = performance.now();
      setOpening(value => value ? { ...value, expanded: true } : null);
      // Cover the outgoing page before replacing it; loading overlaps expansion.
      schedule(() => router.push(work.href), HANDOFF_MS + 32);
    });
    schedule(() => setOpening(value => value ? { ...value, slow: true } : null), 8000);
  }, [afterPaint, router, schedule]);

  const context = useMemo(() => ({ openWork, ready, openingSlug: opening?.slug ?? null }), [openWork, ready, opening?.slug]);
  const transform = opening && (!opening.expanded
    ? `translate3d(${opening.rect.left}px,${opening.rect.top}px,0) scale(${opening.rect.width / opening.viewport.width},${opening.rect.height / opening.viewport.height})`
    : 'translate3d(0,0,0) scale(1)');

  return (
    <WorkTransitionContext.Provider value={context}>
      {children}
      {opening && (
        <div className="fixed inset-0 z-[60]" aria-busy={!opening.ready} style={{ pointerEvents: opening.fading ? 'none' : 'auto' }}>
          <div aria-hidden="true" className="absolute inset-0 bg-background transition-opacity duration-[180ms]" style={{ opacity: opening.expanded && !opening.fading ? 1 : 0 }} />
          <div
            aria-hidden="true"
            className={`absolute inset-0 overflow-hidden bg-background ${opening.className ?? ''}`}
            style={{
              transformOrigin: '0 0', transform: transform ?? undefined,
              borderRadius: opening.expanded ? 0 : 12,
              opacity: opening.fading ? 0 : 1,
              transition: `transform ${EXPANSION_MS}ms cubic-bezier(.22,.72,.15,1), border-radius ${EXPANSION_MS}ms, opacity ${HANDOFF_MS}ms ease-out`,
            }}
          >
            {opening.visual}
          </div>
          {opening.slow && !opening.fading && (
            <div role="status" className="absolute inset-x-0 bottom-8 flex items-center justify-center gap-5 text-sm text-text-body">
              <span>正在加载作品…</span>
              <ActionButton type="button" className="underline underline-offset-4" onClick={() => {
                clear();
                if (pathname !== '/works' && pathname !== '/works/') router.replace('/works/');
              }}>返回作品</ActionButton>
            </div>
          )}
        </div>
      )}
    </WorkTransitionContext.Provider>
  );
}

export function useWorkOpeningTransition() {
  const context = useContext(WorkTransitionContext);
  if (!context) throw new Error('Work galleries require WorkTransitionProvider');
  return { openWork: context.openWork };
}

export function useWorkReady(slug: string) {
  const context = useContext(WorkTransitionContext);
  const notify = context?.ready;
  const ready = useCallback(() => notify?.(slug), [notify, slug]);
  return { ready, opening: context?.openingSlug === slug };
}

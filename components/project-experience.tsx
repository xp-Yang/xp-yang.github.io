'use client';

import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';

import { BlackHoleBackground } from '@/components/black-hole-background';
import { BlackHoleControlPanel } from '@/components/black-hole-control-panel';
import { PROJECT_ORIGIN_KEY } from '@/components/works-gallery';
import {
  clampBlackHoleControls,
  DEFAULT_BLACK_HOLE_CONTROLS,
  type BlackHoleControls,
} from '@/lib/black-hole/controls';
import type { ContentItem } from '@/types/content';

type StoredOrigin = {
  slug: string;
  rect: { left: number; top: number; width: number; height: number };
  viewport: { width: number; height: number };
};

function readOrigin(slug: string): StoredOrigin | null {
  try {
    const raw = window.sessionStorage.getItem(PROJECT_ORIGIN_KEY);
    if (!raw) return null;
    const origin = JSON.parse(raw) as StoredOrigin;
    if (origin.slug !== slug) return null;
    return origin;
  } catch {
    return null;
  }
}

export function ProjectExperience({
  item,
  index,
  total,
}: {
  item: ContentItem;
  index: number;
  total: number;
}) {
  const [closingTransform, setClosingTransform] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [blackHoleControls, setBlackHoleControls] = useState<BlackHoleControls>(
    () => ({
      ...DEFAULT_BLACK_HOLE_CONTROLS,
    }),
  );
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const isBlackHole = item.slug === 'schwarzschild-event-horizon';
  const visualClass = `work-thumbnail-${(index % 11) + 1}`;
  const technologies = useMemo(
    () => item.project?.tech ?? item.tags,
    [item.project?.tech, item.tags],
  );

  useEffect(() => {
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, []);

  const close = () => {
    if (closing) return;
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const origin = readOrigin(item.slug);
    if (reducedMotion || !origin) {
      window.location.assign('/works/');
      return;
    }

    const scaleX = origin.rect.width / window.innerWidth;
    const scaleY = origin.rect.height / window.innerHeight;
    setClosingTransform(
      `translate3d(${origin.rect.left}px,${origin.rect.top}px,0) scale(${scaleX},${scaleY})`,
    );
    setClosing(true);
    window.setTimeout(() => window.history.back(), 600);
  };

  const startBlackHoleDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveBlackHoleView = (event: PointerEvent<HTMLDivElement>) => {
    const previous = dragRef.current;
    if (!previous || previous.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    setBlackHoleControls((current) =>
      clampBlackHoleControls({
        ...current,
        azimuth: current.azimuth + deltaX * 0.32,
        inclination: current.inclination - deltaY * 0.22,
      }),
    );
  };

  const endBlackHoleDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const zoomBlackHole = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setBlackHoleControls((current) =>
      clampBlackHoleControls({
        ...current,
        zoom: current.zoom * Math.exp(-event.deltaY * 0.0012),
      }),
    );
  };

  return (
    <main
      className="fixed inset-0 z-50 isolate origin-top-left overflow-hidden bg-[#050608] transition-[transform,border-radius,opacity] duration-[600ms] ease-[cubic-bezier(.22,.72,.15,1)]"
      style={{
        transform: closingTransform ?? 'translate3d(0,0,0) scale(1)',
        borderRadius: closing ? 12 : 0,
        opacity: closing ? 0.92 : 1,
      }}
    >
      {isBlackHole ? (
        <BlackHoleBackground
          controls={blackHoleControls}
          playbackClassName="bottom-4 left-4 right-auto md:bottom-5 md:left-5"
          debugClassName="left-4 right-auto md:left-auto md:right-[24rem]"
        />
      ) : (
        <div
          className={`work-thumbnail ${visualClass} absolute inset-0 z-0`}
          aria-hidden="true"
        />
      )}
      <div className="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(3,4,6,.74)_0%,rgba(3,4,6,.04)_28%,rgba(3,4,6,.16)_54%,rgba(3,4,6,.95)_100%)]" />

      {isBlackHole && (
        <div
          className="absolute inset-0 z-10 touch-none cursor-grab active:cursor-grabbing"
          title="拖动调整观察视角，滚轮缩放"
          onPointerDown={startBlackHoleDrag}
          onPointerMove={moveBlackHoleView}
          onPointerUp={endBlackHoleDrag}
          onPointerCancel={endBlackHoleDrag}
          onWheel={zoomBlackHole}
        />
      )}

      <header className="absolute inset-x-0 top-0 z-40 grid h-16 grid-cols-[1fr_auto_1fr] items-center border-b border-white/10 bg-black/25 px-4 backdrop-blur-md md:px-8">
        <button
          type="button"
          onClick={close}
          className="flex min-h-11 w-fit items-center gap-2 text-left font-mono text-[10px] uppercase tracking-wider text-stone-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          <ArrowLeft className="size-4" />
          所有作品
        </button>
        <span className="font-mono text-[10px] uppercase tracking-wider text-stone-500">
          Project {String(index + 1).padStart(2, '0')} /{' '}
          {String(total).padStart(2, '0')}
        </span>
        <span className="justify-self-end font-mono text-[10px] uppercase tracking-wider text-stone-400">
          {item.placeholder ? 'Concept placeholder' : 'Realtime model'}
        </span>
      </header>

      {isBlackHole && (
        <BlackHoleControlPanel
          controls={blackHoleControls}
          onChange={(next) =>
            setBlackHoleControls(clampBlackHoleControls(next))
          }
        />
      )}

      <section className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-16 md:px-8 md:pb-10">
        <div className="grid items-end gap-7 border-t border-white/15 pt-7 md:grid-cols-[minmax(0,1.1fr)_minmax(18rem,.65fr)] md:gap-14">
          <div>
            <p className="eyebrow mb-4 text-[#ffad61]">
              {technologies.join(' · ')}
            </p>
            <h1 className="max-w-4xl text-balance text-4xl font-medium leading-none tracking-[-0.05em] md:text-7xl">
              {item.title}
            </h1>
          </div>
          <div>
            <p className="max-w-xl text-sm leading-7 text-stone-300 md:text-base md:leading-8">
              {item.summary}
            </p>
            {item.placeholder && (
              <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-[#ffad61]">
                示例项目 · 等待真实内容替换
              </p>
            )}
            {item.project?.sourceUrl && (
              <a
                href={item.project.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="pointer-events-auto mt-5 inline-flex items-center gap-2 text-sm text-stone-300 hover:text-white"
              >
                查看源码
                <ArrowUpRight className="size-4" />
              </a>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

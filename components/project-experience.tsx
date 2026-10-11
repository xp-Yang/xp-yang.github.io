'use client';

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';

import { BlackHoleBackground } from '@/components/black-hole-background';
import { BlackHoleControlPanel } from '@/components/black-hole-control-panel';
import { PROJECT_ORIGIN_KEY } from '@/components/works-gallery';
import { useWorkReady } from '@/components/work-opening-transition';
import { WorkExperienceHeader } from '@/components/work-experience-header';
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
}: {
  item: ContentItem;
  index: number;
  total: number;
}) {
  const { ready } = useWorkReady(item.slug);
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
  useEffect(() => { if (!isBlackHole) ready(); }, [isBlackHole, ready]);
  const visualClass = `work-thumbnail-${(index % 11) + 1}`;

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
          onReady={ready}
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

      <WorkExperienceHeader title={item.title} onBack={close} />

      {isBlackHole && (
        <BlackHoleControlPanel
          controls={blackHoleControls}
          onChange={(next) =>
            setBlackHoleControls(clampBlackHoleControls(next))
          }
        />
      )}
    </main>
  );
}

'use client';

import { useCallback, type SyntheticEvent } from 'react';
import { useWorkReady } from '@/components/work-opening-transition';

export function useEmbeddedWorkReady(slug: string) {
  const { ready } = useWorkReady(slug);
  return useCallback(async (event: SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = event.currentTarget;
    const document = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;
    if (!document || !frameWindow) return;
    // These local games initialize their scene in the entry module. A load
    // event alone can precede the first scheduled render and image decoding.
    await Promise.allSettled([
      document.fonts.ready,
      ...Array.from(document.images, image => image.decode()),
    ]);
    if (!iframe.isConnected || iframe.contentDocument !== document) return;
    frameWindow.requestAnimationFrame(() => frameWindow.requestAnimationFrame(() => {
      if (iframe.isConnected && iframe.contentDocument === document) ready();
    }));
  }, [ready]);
}

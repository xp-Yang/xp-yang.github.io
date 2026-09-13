'use client';

import { useEffect } from 'react';

export function InteractionPolicy() {
  useEffect(() => {
    const preventSelection = (event: Event) => event.preventDefault();
    const preventContentDrag = (event: DragEvent) => {
      const target = event.target;
      // Stop native text/link/image ghost dragging, not application-owned DnD
      // or files dragged into a demo from outside the document.
      if (target instanceof Element && !target.closest('[draggable="true"]') && target.closest('a[href], img')) {
        event.preventDefault();
      }
    };
    document.addEventListener('selectstart', preventSelection, true);
    document.addEventListener('dragstart', preventContentDrag, true);
    return () => {
      document.removeEventListener('selectstart', preventSelection, true);
      document.removeEventListener('dragstart', preventContentDrag, true);
    };
  }, []);
  return null;
}

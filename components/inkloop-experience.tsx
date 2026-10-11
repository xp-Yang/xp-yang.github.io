'use client';

import { useEmbeddedWorkReady } from '@/components/embedded-work-ready';
import { WorkExperienceHeader } from '@/components/work-experience-header';

export function InkloopExperience() {
  const onLoad = useEmbeddedWorkReady('inkloop');
  return (
    <main className="fixed inset-0 z-50 overflow-hidden bg-[#edf0f2]">
      <WorkExperienceHeader title="圈个小世界" />
      <iframe
        onLoad={onLoad}
        src="/games/inkloop/"
        title="圈个小世界：在线试玩"
        className="absolute inset-0 h-full w-full border-0"
        allow="fullscreen; gamepad"
        allowFullScreen
      />
    </main>
  );
}

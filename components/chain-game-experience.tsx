'use client';

import { useEmbeddedWorkReady } from '@/components/embedded-work-ready';
import { WorkExperienceHeader } from '@/components/work-experience-header';

export function ChainGameExperience() {
  const onLoad = useEmbeddedWorkReady('chain-game');
  return (
    <main className="fixed inset-0 z-50 overflow-hidden bg-[#111922]">
      <WorkExperienceHeader title="连锁矿境" />
      <iframe
        onLoad={onLoad}
        src="/games/chain-game/?embed=1"
        title="连锁矿境：在线试玩"
        className="absolute inset-x-0 bottom-0 top-16 h-[calc(100%_-_4rem)] w-full border-0"
        allow="fullscreen"
        allowFullScreen
      />
    </main>
  );
}

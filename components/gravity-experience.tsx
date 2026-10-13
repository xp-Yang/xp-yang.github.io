'use client';

import { useEmbeddedWorkReady } from '@/components/embedded-work-ready';
import { WorkExperienceHeader } from '@/components/work-experience-header';

export function GravityExperience() {
  const onLoad = useEmbeddedWorkReady('gravity-lab');
  return (
    <main className="fixed inset-0 z-50 overflow-hidden bg-[#080b0d]">
      <WorkExperienceHeader title="万有引力多体模拟" />
      <iframe
        onLoad={onLoad}
        src="/experiments/gravity-lab/?embed=1"
        title="万有引力多体模拟：三维交互实验"
        className="absolute inset-x-0 bottom-0 top-16 h-[calc(100%_-_4rem)] w-full border-0"
        allow="fullscreen"
        allowFullScreen
      />
    </main>
  );
}

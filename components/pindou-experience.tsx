'use client';

import { useEmbeddedWorkReady } from '@/components/embedded-work-ready';
import { WorkExperienceHeader } from '@/components/work-experience-header';

export function PindouExperience() {
  const onLoad = useEmbeddedWorkReady('pindou');
  return (
    <main className="fixed inset-0 z-50 overflow-hidden bg-[#e5e5f3]">
      <WorkExperienceHeader title="拼豆狂欢" />
      <iframe
        onLoad={onLoad}
        src="/games/pindou/"
        title="拼豆狂欢：在线试玩"
        className="absolute inset-0 h-full w-full border-0"
        allow="fullscreen"
        allowFullScreen
      />
    </main>
  );
}

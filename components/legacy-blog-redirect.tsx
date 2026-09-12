'use client';

import { useEffect } from 'react';

export function LegacyBlogRedirect({ slug }: { slug?: string }) {
  const target = slug ? `/blog/${slug}` : '/blog';

  useEffect(() => {
    window.location.replace(target);
  }, [target]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#050608] px-6 text-stone-300">
      <a
        className="underline underline-offset-4 hover:text-white"
        href={target}
      >
        内容已合并至博客，点击继续
      </a>
    </main>
  );
}

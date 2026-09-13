import { ArrowUpRight } from 'lucide-react';

import { BlackHoleBackground } from '@/components/black-hole-background';
import { siteConfig } from '@/site.config';
import styles from './home-title.module.css';

const categories = [
  { href: '/works', index: '01', title: '作品' },
  { href: '/blog', index: '02', title: '博客' },
] as const;

export default function Home() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden">
      <BlackHoleBackground />

      <section className="site-shell relative z-10 flex min-h-[100svh] items-center pt-20">
        <div className="w-full max-w-[42rem] pb-[5vh]">
          <p className="eyebrow mb-7 flex items-center gap-3"><span className="h-px w-8 bg-[#ff9f43]" />{siteConfig.role}</p>
          <h1 className={`${styles.name} text-balance text-[clamp(4rem,10vw,8.2rem)] font-medium leading-[0.86] text-[#f4f1ea]`}>{siteConfig.name}</h1>
          <p className="mt-8 max-w-xl text-balance text-lg leading-8 text-stone-300 md:text-xl">{siteConfig.tagline}</p>
          <nav aria-label="主页内容入口" className="pointer-events-auto relative z-40 mt-10 grid max-w-2xl border-t border-white/20 sm:grid-cols-2">
            {categories.map((category) => (
              <a key={category.href} href={category.href} className="group grid min-h-28 grid-cols-[2.25rem_1fr_auto] items-end border-b border-white/20 py-4 text-stone-200 transition-colors hover:text-white focus-visible:text-white sm:px-5 sm:first:pl-0 sm:last:border-l sm:last:border-l-white/20">
                <span className="font-mono text-xs text-[#ffad61]">{category.index}</span>
                <span className="text-xl font-medium tracking-[-0.025em]">{category.title}</span>
                <ArrowUpRight className="size-4 text-stone-500 transition-all group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-[#ffad61]" />
              </a>
            ))}
          </nav>
        </div>
      </section>
    </main>
  );
}

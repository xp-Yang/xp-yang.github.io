import { ArrowUpRight, Menu } from '@/components/ui';

import { siteConfig } from '@/site.config';

const navigation = [
  { href: '/works', label: '作品', index: '01' },
  { href: '/blog', label: '博客', index: '02' },
];

const githubHref =
  siteConfig.links.find((link) => link.label === 'GitHub')?.href ??
  'https://github.com/';

export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/[0.08] bg-background/60 backdrop-blur-xl">
      <div className="site-shell flex h-16 items-center justify-between">
        <a
          href="/"
          className="group flex items-center gap-3"
          aria-label="返回首页"
        >
          <span className="relative grid size-7 place-items-center rounded-full border border-white/25 transition-colors group-hover:border-accent/80">
            <span className="size-1.5 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-soft">
            YANG.
          </span>
        </a>

        <nav
          aria-label="主导航"
          className="hidden items-center gap-7 text-sm text-text-muted md:flex"
        >
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}
          <span className="h-4 w-px bg-white/15" aria-hidden="true" />
          <a
            href={githubHref}
            target="_blank"
            rel="noreferrer"
            aria-label="访问 GitHub"
            className="flex items-center gap-1.5 font-mono text-xs text-text-muted transition-colors hover:text-white"
          >
            GitHub <ArrowUpRight className="size-3.5" />
          </a>
        </nav>

        <details className="group relative md:hidden">
          <summary
            aria-label="打开导航"
            className="grid size-9 cursor-pointer list-none place-items-center rounded-lg text-text-body transition-colors hover:bg-white/10 [&::-webkit-details-marker]:hidden"
          >
            <Menu className="size-5" />
          </summary>
          <nav
            aria-label="移动端导航"
            className="absolute right-0 top-12 w-64 overflow-hidden rounded-xl border border-white/10 bg-surface-overlay/98 p-2 shadow-2xl backdrop-blur-xl"
          >
            {navigation.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="flex items-center justify-between rounded-lg px-4 py-3 text-lg hover:bg-white/[0.06]"
              >
                <span>{item.label}</span>
                <span className="font-mono text-[10px] text-accent-soft">
                  {item.index}
                </span>
              </a>
            ))}
            <a
              href={githubHref}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex items-center justify-between border-t border-white/10 px-4 py-3 text-lg hover:bg-white/[0.06]"
            >
              <span>GitHub</span>
              <ArrowUpRight className="size-4 text-text-subtle" />
            </a>
          </nav>
        </details>
      </div>
    </header>
  );
}

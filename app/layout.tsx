import type { Metadata } from 'next';

import { SiteHeader } from '@/components/site-header';
import { OverlayScrollbar } from '@/components/overlay-scrollbar';
import { siteConfig } from '@/site.config';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: `${siteConfig.name}｜创作与技术档案`,
    template: `%s｜${siteConfig.name}`,
  },
  description: siteConfig.description,
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    title: `${siteConfig.name}｜创作与技术档案`,
    description: siteConfig.description,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: `${siteConfig.name}的个人创作站` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteConfig.name}｜创作与技术档案`,
    description: siteConfig.description,
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="dark" data-scrollbar="overlay">
      <head>
        <noscript><style>{`html[data-scrollbar="overlay"] { scrollbar-width: auto !important; } html[data-scrollbar="overlay"]::-webkit-scrollbar { display: block !important; width: auto !important; } .site-scrollbar { display: none !important; }`}</style></noscript>
      </head>
      <body>
        <a href="#main-content" className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-full bg-white px-4 py-2 text-sm text-black transition-transform focus:translate-y-0">跳到主要内容</a>
        <SiteHeader />
        <div id="main-content">{children}</div>
        <OverlayScrollbar />
      </body>
    </html>
  );
}

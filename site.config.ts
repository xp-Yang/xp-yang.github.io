export type SiteConfig = {
  name: string;
  role: string;
  tagline: string;
  description: string;
  siteUrl: string;
  links: Array<{ label: string; href: string }>;
};

export const siteConfig: SiteConfig = {
  name: 'YANG',
  role: 'Creative developer · Writer',
  tagline:
    '在代码与语言的事件视界旁，记录可交互的世界、实时图形实验与未完成的思考。',
  description:
    '一个关于 Web 游戏、实时 Shader、个人思考、文学写作与学习笔记的中文个人站。',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xp-yang.github.io',
  links: [
    { label: 'GitHub', href: 'https://github.com/xp-Yang' },
    { label: 'Email', href: 'mailto:hello@example.com' },
  ],
};

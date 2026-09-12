export const CONTENT_TYPES = ['Project', 'Blog', 'Literature', 'Note'] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];
export type DemoMode = 'Embed' | 'Link';

export type RichTextSpan = {
  text: string;
  href?: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
};

export type ContentBlock =
  | { id: string; type: 'paragraph' | 'quote' | 'callout'; spans: RichTextSpan[]; icon?: string }
  | { id: string; type: 'heading_1' | 'heading_2' | 'heading_3'; spans: RichTextSpan[] }
  | { id: string; type: 'bulleted_list_item' | 'numbered_list_item'; spans: RichTextSpan[] }
  | { id: string; type: 'code'; code: string; language?: string; caption?: string }
  | { id: string; type: 'image'; url: string; alt: string; caption?: string }
  | { id: string; type: 'table'; rows: string[][]; hasColumnHeader?: boolean }
  | { id: string; type: 'divider' }
  | { id: string; type: 'unsupported'; label: string; text?: string };

export type ProjectMeta = {
  demoUrl?: string;
  demoMode: DemoMode;
  sourceUrl?: string;
  tech: string[];
};

export type ContentItem = {
  id: string;
  slug: string;
  type: ContentType;
  title: string;
  summary: string;
  publishedAt: string;
  updatedAt?: string;
  tags: string[];
  cover?: string;
  featured: boolean;
  order: number;
  placeholder?: boolean;
  blocks: ContentBlock[];
  project?: ProjectMeta;
};

export type ContentSnapshot = {
  syncedAt: string | null;
  source: 'placeholder' | 'notion';
  items: ContentItem[];
};

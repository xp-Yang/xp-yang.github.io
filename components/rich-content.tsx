import type { ReactNode } from 'react';

import type { ContentBlock, RichTextSpan } from '@/types/content';

function headingId(spans: RichTextSpan[]) {
  return spans.map((span) => span.text).join('').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '');
}

function renderSpans(spans: RichTextSpan[]): ReactNode {
  return spans.map((span, index) => {
    let content: ReactNode = span.text;
    if (span.code) content = <code className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.88em] text-accent-content">{content}</code>;
    if (span.bold) content = <strong>{content}</strong>;
    if (span.italic) content = <em>{content}</em>;
    if (span.strikethrough) content = <s>{content}</s>;
    if (span.underline) content = <u>{content}</u>;
    if (span.href) content = <a href={span.href} target="_blank" rel="noreferrer" className="text-link-hover underline decoration-white/20 underline-offset-4 hover:decoration-link-hover">{content}</a>;
    return <span key={`${span.text}-${index}`}>{content}</span>;
  });
}

export function RichContent({ blocks, literary = false }: { blocks: ContentBlock[]; literary?: boolean }) {
  const rendered: ReactNode[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];

    if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
      const type = block.type;
      const items: Extract<ContentBlock, { type: typeof type }>[] = [];
      while (index < blocks.length && blocks[index].type === type) {
        items.push(blocks[index] as Extract<ContentBlock, { type: typeof type }>);
        index += 1;
      }
      const List = type === 'bulleted_list_item' ? 'ul' : 'ol';
      rendered.push(
        <List key={`list-${items[0].id}`} className={type === 'bulleted_list_item' ? 'my-7 list-disc space-y-2 pl-6 text-text-soft marker:text-accent' : 'my-7 list-decimal space-y-2 pl-6 text-text-soft marker:text-accent'}>
          {items.map((item) => <li key={item.id} className="pl-2 leading-8">{renderSpans(item.spans)}</li>)}
        </List>,
      );
      continue;
    }

    switch (block.type) {
      case 'paragraph':
        rendered.push(<p key={block.id} className={`my-6 whitespace-pre-wrap text-[1.05rem] leading-9 text-text-soft ${literary ? 'font-literary text-lg leading-[2.15]' : ''}`}>{renderSpans(block.spans)}</p>);
        break;
      case 'heading_1':
        rendered.push(<h2 key={block.id} id={headingId(block.spans)} className="mb-5 mt-16 scroll-mt-24 text-3xl font-medium tracking-tight">{renderSpans(block.spans)}</h2>);
        break;
      case 'heading_2':
        rendered.push(<h2 key={block.id} id={headingId(block.spans)} className="mb-5 mt-14 scroll-mt-24 text-2xl font-medium tracking-tight">{renderSpans(block.spans)}</h2>);
        break;
      case 'heading_3':
        rendered.push(<h3 key={block.id} id={headingId(block.spans)} className="mb-4 mt-10 scroll-mt-24 text-xl font-medium">{renderSpans(block.spans)}</h3>);
        break;
      case 'quote':
        rendered.push(<blockquote key={block.id} className={`my-9 border-l border-accent pl-6 text-xl leading-9 text-text-body ${literary ? 'font-literary' : ''}`}>{renderSpans(block.spans)}</blockquote>);
        break;
      case 'callout':
        rendered.push(<aside key={block.id} className="my-8 flex gap-4 rounded-xl border border-link/20 bg-link/[0.06] p-5 leading-7 text-text-soft"><span aria-hidden="true" className="text-link">{block.icon ?? '✦'}</span><p>{renderSpans(block.spans)}</p></aside>);
        break;
      case 'code':
        rendered.push(<figure key={block.id} className="my-9 overflow-hidden rounded-xl border border-white/10 bg-surface-code"><figcaption className="flex items-center justify-between border-b border-white/10 px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-text-subtle"><span>{block.caption ?? 'Code'}</span><span>{block.language ?? 'text'}</span></figcaption><pre className="overflow-x-auto p-5 text-sm leading-7 text-text-soft"><code>{block.code}</code></pre></figure>);
        break;
      case 'image':
        rendered.push(<figure key={block.id} className="my-10"><img src={block.url} alt={block.alt} className="w-full rounded-xl border border-white/10" />{block.caption && <figcaption className="mt-3 text-center text-xs text-text-subtle">{block.caption}</figcaption>}</figure>);
        break;
      case 'table':
        rendered.push(<div key={block.id} className="my-9 overflow-x-auto rounded-xl border border-white/10"><table className="w-full min-w-lg border-collapse text-left text-sm"><tbody>{block.rows.map((row, rowIndex) => <tr key={`${block.id}-${rowIndex}`} className="border-b border-white/10 last:border-0">{row.map((cell, cellIndex) => { const Cell = block.hasColumnHeader && rowIndex === 0 ? 'th' : 'td'; return <Cell key={`${cell}-${cellIndex}`} className={`px-4 py-3 ${Cell === 'th' ? 'bg-white/[0.04] font-medium text-text-body' : 'text-text-muted'}`}>{cell}</Cell>; })}</tr>)}</tbody></table></div>);
        break;
      case 'divider':
        rendered.push(<hr key={block.id} className="my-12 border-white/10" />);
        break;
      case 'unsupported':
        rendered.push(<div key={block.id} className="my-6 rounded-lg border border-dashed border-white/15 px-4 py-3 text-sm text-text-subtle">未支持的 Notion 内容块：{block.label}{block.text ? ` · ${block.text}` : ''}</div>);
        break;
    }
    index += 1;
  }

  return <div>{rendered}</div>;
}

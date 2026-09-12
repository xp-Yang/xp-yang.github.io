import assert from 'node:assert/strict';
import test from 'node:test';

import { isPublished, normalizePage, validateUniqueSlugs } from '../scripts/notion-core';
import type { ContentBlock, ContentItem } from '../types/content';

const richText = (text: string) => [{ plain_text: text, annotations: {} }];
const basePage = (overrides: Record<string, unknown> = {}) => ({
  id: 'page-1',
  last_edited_time: '2026-08-30T00:00:00.000Z',
  properties: {
    Title: { type: 'title', title: richText('测试项目') },
    Slug: { type: 'rich_text', rich_text: richText('test-project') },
    Type: { type: 'select', select: { name: 'Project' } },
    Status: { type: 'status', status: { name: 'Published' } },
    PublishedAt: { type: 'date', date: { start: '2026-08-20' } },
    Summary: { type: 'rich_text', rich_text: richText('摘要') },
    Tags: { type: 'multi_select', multi_select: [{ name: 'WebGL' }] },
    Featured: { type: 'checkbox', checkbox: true },
    Order: { type: 'number', number: 2 },
    DemoMode: { type: 'select', select: { name: 'Embed' } },
    DemoURL: { type: 'url', url: 'https://example.com/demo' },
    SourceURL: { type: 'url', url: 'https://github.com/example/demo' },
    Tech: { type: 'multi_select', multi_select: [{ name: 'GLSL' }] },
    ...overrides,
  },
});

const blocks: ContentBlock[] = [{ id: 'p-1', type: 'paragraph', spans: [{ text: '正文' }] }];

test('maps a published Notion page to a project item', () => {
  const item = normalizePage(basePage(), blocks);
  assert.equal(item?.type, 'Project');
  assert.equal(item?.project?.demoMode, 'Embed');
  assert.deepEqual(item?.project?.tech, ['GLSL']);
});

test('filters draft pages before content validation', () => {
  const page = basePage({ Status: { type: 'status', status: { name: 'Draft' } } });
  assert.equal(isPublished(page), false);
  assert.equal(normalizePage(page, blocks), null);
});

test('rejects unsafe project URLs', () => {
  const page = basePage({ DemoURL: { type: 'url', url: 'http://example.com/demo' } });
  assert.throws(() => normalizePage(page, blocks), /HTTPS/);
});

test('rejects duplicate slugs without mutating items', () => {
  const first = normalizePage(basePage(), blocks) as ContentItem;
  const second = { ...first, id: 'page-2', title: '第二个项目' };
  assert.throws(() => validateUniqueSlugs([first, second]), /重复/);
  assert.equal(first.slug, 'test-project');
});

test('requires the Status field', () => {
  const page = basePage({ Status: undefined });
  assert.throws(() => isPublished(page), /Status/);
});

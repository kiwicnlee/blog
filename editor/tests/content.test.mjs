import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMindmapSvg, serializePost, validateDraft, validateMindmap, validateSlug } from '../shared/content.mjs';

test('rejects unsafe slugs and unsupported categories', () => {
  assert.throws(() => validateSlug('../secret'), /文章路径/);
  assert.throws(() => validateSlug('draft/other'), /文章路径/);
  assert.throws(() => validateDraft({ title: '标题', slug: 'safe', category: '其他', tags: [], body: '' }, 'alice'), /已有分类/);
  assert.throws(() => validateDraft({ title: '标题', slug: 'safe', date: '2026-02-30T10:00', category: '机器人技术', tags: [], body: '' }, 'alice'), /日期数值/);
});

test('serializes front matter without allowing title to inject fields', () => {
  const draft = validateDraft({ title: '标题\nadmin: true', slug: 'safe-post', description: '摘要', category: '机器人技术', tags: ['Hexo'], body: '正文' }, 'alice');
  const markdown = serializePost(draft);
  assert.match(markdown, /^---\ntitle: "标题\\nadmin: true"\n/);
  assert.match(markdown, /author: "alice"/);
  assert.doesNotMatch(markdown, /^admin: true$/m);
});

test('validates map structure and escapes node text in generated SVG', () => {
  const map = validateMindmap({ nodeData: { id: 'root', topic: '<script>alert(1)</script>', children: [{ id: 'child', topic: '证据', children: [] }] } });
  const svg = renderMindmapSvg(map);
  assert.match(svg, /&lt;script&gt;/);
  assert.doesNotMatch(svg, /<script>/);
  const draft = validateDraft({ title: '标题', slug: 'safe-post', category: '机器人技术', tags: [], body: '前言\n\n<!-- mindmap -->', mindmap: map }, 'alice');
  assert.match(serializePost(draft), /!\[文章思维导图\]\(mindmap\.svg\)/);
});

test('rejects too many mindmap nodes and duplicate identifiers', () => {
  assert.throws(() => validateMindmap({ nodeData: { id: 'same', topic: '一', children: [{ id: 'same', topic: '二' }] } }), /重复/);
  const children = Array.from({ length: 121 }, (_, index) => ({ id: `n${index}`, topic: '节点' }));
  assert.throws(() => validateMindmap({ nodeData: { id: 'root', topic: '根', children } }), /120/);
});

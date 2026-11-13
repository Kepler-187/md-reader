// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildLinkIndex, clearLinkIndexCache } from '../../server/link-index.mjs';

const roots = [];
async function index(source, targets = ['x.md', 'y.md']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'link-index-'));
  roots.push(root);
  for (const [name, text] of [['source.md', source], ...targets.map(name => [name, '# Target'])]) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return buildLinkIndex(root);
}
afterEach(async () => {
  clearLinkIndexCache();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('link index P0', () => {
  it('resolves extensionless wiki links and generates backlinks', async () => {
    const result = await index('[[x#Heading|Alias]]');
    expect(result.edges).toEqual([{ source: 'source.md', target: 'x.md', kind: 'wiki' }]);
    expect(result.broken).toEqual([]);
    expect(result.backlinks['x.md']).toEqual([{ path: 'source.md', title: 'source', kind: 'wiki', snippet: 'Alias' }]);
  });
  it('falls back to a folder-note', async () => {
    const result = await index('[[故事原型&点子]]', ['故事原型&点子/故事原型&点子.md']);
    expect(result.edges[0].target).toBe('故事原型&点子/故事原型&点子.md');
    expect(result.broken).toEqual([]);
  });
  it('prefers target.md over target/target.md and deduplicates resolved targets', async () => {
    const result = await index('[[x]] [[x.md]]', ['x.md', 'x/x.md']);
    expect(result.edges).toEqual([{ source: 'source.md', target: 'x.md', kind: 'wiki' }]);
    expect(result.backlinks['x.md']).toHaveLength(1);
  });
  it('does not append md to attachments or fabricate missing targets', async () => {
    const result = await index('[[photo.png]] [[missing]]', ['photo.png.md']);
    expect(result.edges).toEqual([]);
    expect(result.broken.map(b => b.path)).toEqual(['photo.png', 'missing']);
  });
  it('keeps explicit md/mdx wiki targets intact', async () => {
    const result = await index('[[x.md]] [[y.mdx]]', ['x.md', 'y.mdx']);
    expect(result.edges.map(e => e.target)).toEqual(['x.md', 'y.mdx']);
  });
  it.each([
    ['inline', '`[[x]] [x](y.md)`'],
    ['multiple backticks', '``[[x]] ` [x](y.md)``'],
    ['multiline inline', '`[[x]]\n[x](y.md)`'],
    ['backtick fence', '```md\n[[x]] [x](y.md)\n```'],
    ['tilde fence', '~~~md\r\n[[x]] [x](y.md)\r\n~~~'],
    ['long fence', '````md\n```\n[[x]] [x](y.md)\n````'],
    ['unclosed fence', '```md\n[[x]] [x](y.md)'],
    ['quoted fence', '> ```md\n> [[x]] [x](y.md)\n> ```'],
  ])('ignores %s code even when targets exist', async (_label, source) => {
    const result = await index(source);
    expect(result.edges).toEqual([]);
    expect(result.broken).toEqual([]);
    expect(Object.keys(result.backlinks)).toEqual([]);
  });
  it('retains normal Markdown links before and after code', async () => {
    const result = await index('[x](x.md#heading)\n~~~\n[[absent]]\n~~~\n[y](y.md)');
    expect(result.edges).toEqual([
      { source: 'source.md', target: 'x.md', kind: 'markdown' },
      { source: 'source.md', target: 'y.md', kind: 'markdown' },
    ]);
    expect(result.broken).toEqual([]);
  });
  it('does not hide prose after unmatched or escaped backticks', async () => {
    const result = await index('` unmatched [[x]]\n\n\\` [y](y.md)');
    expect(result.edges.map(e => e.target)).toEqual(['x.md', 'y.md']);
  });
  it('resolves relative and root-qualified wiki paths without escaping scanned roots', async () => {
    const result = await index('[[sub/note]] [[/x]] [[../outside]]', ['sub/note.md', 'x.md']);
    expect(result.edges.map(e => e.target)).toEqual(['sub/note.md', 'x.md']);
    expect(result.broken.map(e => e.path)).toEqual(['../outside']);
  });
});

import { describe, expect, it } from 'vitest'
import { buildGraphView, isNavigationNode } from '../../src/graph/linkGraphAdapter'
import type { LinkIndexPayload } from '../../src/workspace/local-bridge-access'

export const fixture: LinkIndexPayload = {
  nodes: ['INDEX.md', 'work/INDEX.md', 'writing/_MOC/topic.md', 'a.md', 'b.md', 'alone.md'].map(id => ({ id, path: id, title: id, dir: '', tags: [] })),
  edges: [{ source: 'INDEX.md', target: 'a.md', kind: 'markdown' }, { source: 'writing/_MOC/topic.md', target: 'b.md', kind: 'wiki' }, { source: 'a.md', target: 'b.md', kind: 'wiki' }],
  backlinks: { 'b.md': [{ path: 'a.md', title: '文章 A', kind: 'wiki', snippet: null }] },
  broken: [], titles: {}, scannedAt: '', documentCount: 6,
}

describe('navigation filtering', () => {
  it.each([['INDEX.md', true], ['work/INDEX.md', true], ['writing/_MOC/topic.md', true], ['_MOC/a.md', true], ['writing/MOC/topic.md', false], ['myINDEX.md', false], ['index.mdx', false], ['a.md', false]])('classifies %s', (path, expected) => {
    expect(isNavigationNode(path)).toBe(expected)
  })
  it('filters before connectivity and leaves source data unchanged', () => {
    const original = JSON.stringify(fixture)
    const view = buildGraphView(fixture, { scope: 'global' })
    expect(view.nodes.map(n => n.id).sort()).toEqual(['a.md', 'b.md'])
    expect(view.edges).toHaveLength(1)
    expect(JSON.stringify(fixture)).toBe(original)
    expect(buildGraphView(fixture, { scope: 'global', includeNavigation: true, includeIsolated: true }).nodes).toHaveLength(6)
  })
  it('does not use hidden navigation nodes to reach distant notes', () => {
    const index = { ...fixture, edges: fixture.edges.slice(0, 2) }
    expect(buildGraphView(index, { scope: 'local', focusPath: 'a.md', hops: 3, includeIsolated: true }).nodes.map(n => n.id)).toEqual(['a.md'])
  })
  it('accepts an empty index', () => {
    expect(buildGraphView({ ...fixture, nodes: [], edges: [] }, { scope: 'global' }).nodes).toEqual([])
  })
})

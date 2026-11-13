import { expect, it, vi } from 'vitest'
import { drawGraph, resetGraphRenderCache, type GraphRenderInput } from '../../src/graph/graphRenderer'

function renderLabels(ids: string[], overrides: Partial<GraphRenderInput> = {}) {
  const fillText = vi.fn()
  const context = new Proxy({
    fillText,
    measureText: (text: string) => ({ width: text.length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  }, {
    get: (target, key) => Reflect.get(target, key) ?? (() => {}),
  }) as unknown as CanvasRenderingContext2D
  resetGraphRenderCache()
  drawGraph(context, {
    nodes: ids.map(id => ({ id, title: 'Front matter title', dir: '', tags: [], x: 0, y: 0, radius: 10, degree: 0, tier: 'normal' })),
    edges: [], positions: Object.fromEntries(ids.map(id => [id, { x: 0, y: 0 }])),
    camera: { x: 0, y: 0, scale: 0.06 }, width: 800, height: 600, dpr: 1,
    selectedId: null, hoveredId: null, reduceMotion: true,
    ...overrides,
  })
  return fillText.mock.calls.map(call => call[0])
}

it('always labels navigation nodes even at low zoom and when labels overlap', () => {
  const labels = renderLabels(['INDEX.md', 'work/INDEX.md', 'writing/_MOC/这是超过原来二十二字截断上限的完整导航页面名称.md', 'writing/ordinary.md'])
  expect(labels).toEqual(['INDEX.md', 'INDEX.md', '这是超过原来二十二字截断上限的完整导航页面名称.md'])
})

it('keeps navigation labels when focusing a different article, and removes directory prefixes from article labels', () => {
  const ids = ['writing/_MOC/topic.md', 'writing/notes/article.md', 'writing/notes/neighbor.md']
  const labels = renderLabels(ids, { selectedId: ids[1], edges: [{ source: ids[1], target: ids[2] }] })
  expect(labels).toContain('topic.md')
  expect(labels).toContain('article.md')
  expect(labels.every(label => !label.includes('/'))).toBe(true)
})

it('shows the entire project path when requested, including long paths and duplicate filenames', () => {
  const ids = ['INDEX.md', 'work/INDEX.md', 'writing/_MOC/超过二十二字并且不能被截断的导航页面名称.md']
  expect(renderLabels(ids, { showFullPath: true })).toEqual(ids)
})

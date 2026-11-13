import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GraphView } from '../../src/graph/GraphView'
import { computeFocus, drawGraph } from '../../src/graph/graphRenderer'
import { clearGraphViewState, graphTopologyKey, readGraphViewState, writeGraphViewState } from '../../src/graph/graphViewStore'

vi.mock('../../src/graph/graphRenderer', async (original) => ({
  ...await original<typeof import('../../src/graph/graphRenderer')>(),
  drawGraph: vi.fn(),
}))

const nodes = ['a.md', 'b.md', 'c.md', 'd.md'].map(id => ({ id, path: id, title: id, tags: [], dir: '' }))
const edges = [{ source: 'a.md', target: 'b.md', kind: 'markdown' as const }, { source: 'c.md', target: 'd.md', kind: 'markdown' as const }]
const positions = { 'a.md': { x: 100, y: 100 }, 'b.md': { x: 280, y: 100 }, 'c.md': { x: 2000, y: 100 }, 'd.md': { x: 2180, y: 100 } }
const camera = { x: 0, y: 0, scale: 1 }
const index = { nodes, edges, backlinks: {}, titles: {}, broken: [], scannedAt: '', documentCount: 4 }
const props = { index, projectId: 'drag-regression', loading: false, error: null, currentDocumentPath: 'a.md', onCloseGraph: vi.fn(), onRefreshGraph: vi.fn(), onEnterDocument: vi.fn() }
const debug = () => (window as any).__graphDebug
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

it('shows navigation on first open and restores an explicit filter change from the store', () => {
  clearGraphViewState(props.projectId)
  const first = render(<GraphView {...props} />)
  const filter = screen.getByRole('checkbox', { name: '过滤导航节点' })
  expect(filter).not.toBeChecked()
  fireEvent.click(filter)
  expect(filter).toBeChecked()
  expect(readGraphViewState(props.projectId)?.includeNavigation).toBe(false)
  first.unmount()
  render(<GraphView {...props} />)
  expect(screen.getByRole('checkbox', { name: '过滤导航节点' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '过滤导航节点' }))
  expect(readGraphViewState(props.projectId)?.includeNavigation).toBe(true)
})

it('toggles full paths without changing layout, camera or selection and restores the choice', () => {
  const first = render(<GraphView {...props} />)
  advance(100)
  expect(screen.getByRole('checkbox', { name: '显示完整路径' })).not.toBeChecked()
  expect(vi.mocked(drawGraph).mock.lastCall?.[1].showFullPath).toBe(false)
  fireEvent.click(screen.getByRole('checkbox', { name: '显示完整路径' }))
  advance(100)
  expect(vi.mocked(drawGraph).mock.lastCall?.[1].showFullPath).toBe(true)
  expect(debug()).toMatchObject({ positions, camera, selectedId: 'b.md', hasEngine: false })
  expect(readGraphViewState(props.projectId)).toMatchObject({ showFullPath: true, includeNavigation: true })
  first.unmount()
  render(<GraphView {...props} />)
  advance(100)
  expect(screen.getByRole('checkbox', { name: '显示完整路径' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '显示完整路径' }))
  advance(100)
  expect(vi.mocked(drawGraph).mock.lastCall?.[1].showFullPath).toBe(false)
  expect(debug()).toMatchObject({ positions, camera, selectedId: 'b.md', hasEngine: false })
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as any)
  writeGraphViewState(props.projectId, { positions: structuredClone(positions), camera, topology: graphTopologyKey(nodes.map(n => n.id), edges), selectedId: 'b.md' })
})
afterEach(() => {
  clearGraphViewState(props.projectId)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('restored drag heats neighbors, preserves grab offset, cools after release and does not select on trailing click', () => {
  const { container } = render(<GraphView {...props} />)
  const canvas = container.querySelector('.graph-view__canvas')!
  advance(100)
  expect(debug().hasEngine).toBe(false)
  expect(debug().positions).toEqual(positions)
  // Grab five pixels off the center (183, 131), as with a real pointer.
  fireEvent.pointerDown(canvas, { button: 0, clientX: 188, clientY: 131 })
  fireEvent.pointerMove(canvas, { buttons: 1, clientX: 191, clientY: 131 })
  expect(debug().hasEngine).toBe(false)
  fireEvent.pointerMove(canvas, { buttons: 1, clientX: 288, clientY: 131 })
  expect(debug().positions['a.md']).toEqual({ x: 200, y: 100 })
  advance(320)
  const held = structuredClone(debug().positions)
  expect(held['b.md'].x).not.toBe(positions['b.md'].x)
  expect(held['c.md']).toEqual(positions['c.md'])
  fireEvent.pointerUp(canvas, { button: 0, clientX: 288, clientY: 131 })
  fireEvent.click(canvas, { clientX: 288, clientY: 131 })
  advance(320)
  expect(debug().positions['a.md'].x).not.toBe(held['a.md'].x)
  expect(debug().positions['b.md'].x).not.toBe(held['b.md'].x)
  expect(debug().selectedId).toBe('b.md')
})

it('click pins the panel without moving layout, and reading then reopening restores it exactly', () => {
  const first = render(<GraphView {...props} />)
  const canvas = first.container.querySelector('.graph-view__canvas')!
  fireEvent.pointerDown(canvas, { button: 0, clientX: 183, clientY: 131 })
  fireEvent.pointerUp(canvas, { button: 0, clientX: 183, clientY: 131 })
  fireEvent.click(canvas, { clientX: 183, clientY: 131 })
  fireEvent.pointerMove(canvas, { clientX: 363, clientY: 131 })
  advance(32)
  expect(debug().selectedId).toBe('a.md')
  expect(computeFocus(edges, debug().selectedId).relatedNodes).toContain('b.md')
  expect(computeFocus(edges, debug().selectedId).relatedNodes).not.toContain('c.md')
  fireEvent.click(screen.getByRole('button', { name: '进入文章' }))
  expect(props.onEnterDocument).toHaveBeenCalledWith('a.md')
  first.unmount()
  render(<GraphView {...props} />)
  advance(100)
  expect(debug()).toMatchObject({ selectedId: 'a.md', positions, camera, hasEngine: false })
  expect(screen.getByText('已固定')).toBeInTheDocument()
})

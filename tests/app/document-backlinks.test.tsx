import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DocumentBacklinksPanel, getDocumentRelations } from '../../src/app/DocumentBacklinksPanel'
import type { LinkIndexPayload } from '../../src/workspace/local-bridge-access'

const index: LinkIndexPayload = {
  nodes: ['a.md', 'b.md'].map(id => ({ id, path: id, title: id === 'a.md' ? '文章 A' : '文章 B', dir: '', tags: [] })),
  edges: [{ source: 'a.md', target: 'b.md', kind: 'wiki' }],
  backlinks: { 'b.md': [{ path: 'a.md', title: '文章 A', kind: 'wiki', snippet: null }] },
  titles: {}, broken: [], scannedAt: '', documentCount: 2,
}
it('extracts outgoing titles and incoming references', () => {
  expect(getDocumentRelations(index, 'a.md').outgoing).toEqual([{ path: 'b.md', title: '文章 B' }])
  expect(getDocumentRelations(index, 'b.md').incoming[0].title).toBe('文章 A')
  expect(getDocumentRelations(index, 'none.md')).toEqual({ outgoing: [], incoming: [] })
  expect(getDocumentRelations(null, null)).toEqual({ outgoing: [], incoming: [] })
})
it('navigates and requests a graph return without owning selection state', () => {
  const onNavigate = vi.fn(), onReturnToGraph = vi.fn()
  render(<DocumentBacklinksPanel index={index} path="a.md" loading={false} error={null} onNavigate={onNavigate} onReturnToGraph={onReturnToGraph} onRefresh={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '文章 B' }))
  expect(onNavigate).toHaveBeenCalledWith('b.md')
  fireEvent.click(screen.getByRole('button', { name: '回到图谱' }))
  expect(onReturnToGraph).toHaveBeenCalledOnce()
})
it('shows a human-readable empty state', () => {
  render(<DocumentBacklinksPanel index={index} path="none.md" loading={false} error={null} onNavigate={vi.fn()} onReturnToGraph={vi.fn()} onRefresh={vi.fn()} />)
  expect(screen.getByText('本文暂时没有和其它文章的链接关系。')).toBeInTheDocument()
})

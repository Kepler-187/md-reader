import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ReadonlyMarkdownRendererImpl } from '../../src/document-renderer/readonly-markdown-renderer-impl'
import { resolveImageSource } from '../../src/markdown/image-link'
vi.mock('../../src/document-renderer/mermaid-diagram', () => ({ MermaidDiagram: () => null }))

it('maps relative and encoded image paths with shared document normalization and content-root checks', () => {
  expect(resolveImageSource('../../../assets/人物%20%231.jpg', 'writing/文字/故事/a.md', ['assets', 'writing'])).toEqual({ kind: 'internal', path: 'assets/人物 #1.jpg' })
  for (const src of ['../../secret.jpg', '/etc/passwd', 'C:/Windows/x.jpg', 'javascript:alert(1)', '%2fetc/x.jpg', 'x%00.jpg']) {
    expect(resolveImageSource(src, 'docs/a.md', ['docs']).kind).toBe('invalid')
  }
  expect(resolveImageSource('../assets/x.jpg', 'docs/a.md', ['docs']).kind).toBe('invalid')
  for (const src of ['https://example.com/x.jpg?q=1', 'http://example.com/x.jpg', 'data:image/png;base64,AAAA']) {
    expect(resolveImageSource(src, 'docs/a.md', ['docs'])).toEqual({ kind: 'external', href: src })
  }
})

it('hides leading YAML only in rendered output, keeps body rules/wiki links and preserves external/data images', () => {
  const value = '---\ntitle: Private title\nnotion_id: abc\n---\n\n# Body\n\n![photo](../assets/人物.jpg)\n\n![remote](https://example.com/image.jpg)\n\n![data](data:image/png;base64,AAAA)\n\n![blocked](../../secret.jpg)\n\n[[next]]\n\n---\n\n```yaml\ntitle: code example\n```'
  const href = vi.fn((asset: string) => '/api/asset?path=' + encodeURIComponent(asset))
  const { container } = render(<ReadonlyMarkdownRendererImpl value={value} currentDocumentPath="docs/a.md" contentRoots={['docs', 'assets']} documentPaths={['docs/next.md']} getAssetHref={href} getDocumentLinkHref={p => '/doc/' + p} />)
  expect(href).toHaveBeenCalledWith('assets/人物.jpg')
  expect(screen.getByAltText('photo')).toHaveAttribute('src', '/api/asset?path=assets%2F%E4%BA%BA%E7%89%A9.jpg')
  expect(screen.getByAltText('remote')).toHaveAttribute('src', 'https://example.com/image.jpg')
  expect(screen.getByAltText('data')).toHaveAttribute('src', 'data:image/png;base64,AAAA')
  expect(container.querySelector('.markdown-image-unavailable')).toHaveTextContent('blocked')
  expect(container).not.toHaveTextContent('notion_id:')
  expect(container).not.toHaveTextContent('Private title')
  expect(container).toHaveTextContent('title: code example')
  expect(container.querySelectorAll('hr')).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'next' })).toHaveAttribute('href', '/doc/docs/next.md')
  expect(value).toContain('notion_id: abc')
})

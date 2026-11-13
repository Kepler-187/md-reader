import { isValidElement, useCallback, useEffect, useMemo, useRef, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import { resolveImageSource } from '../markdown/image-link'

import { createKnownDocumentPathSet, resolveDocumentLink, type DocumentLinkInvalidReason } from '../markdown/document-link'
import { remarkHeadingIds } from '../markdown/heading-outline'
import { remarkWikiLinks } from '../markdown/remark-wiki-links'
import { applyMarkdownTransforms } from '../markdown/markdown-transform'
import { syncStrongOnlyParagraphClasses } from '../markdown/strong-only-paragraph'
import { MermaidDiagram } from './mermaid-diagram'

const REMARK_PLUGINS = [remarkFrontmatter, remarkGfm, remarkWikiLinks, remarkHeadingIds]

interface ReadonlyMarkdownRendererImplProps {
  value: string
  currentDocumentPath?: string | null
  documentPaths?: Iterable<string>
  contentRoots?: Iterable<string>
  getDocumentLinkHref?: (documentPath: string, headingId: string | null) => string
  getAssetHref?: (assetPath: string) => string
  onDocumentLinkNavigate?: (documentPath: string, headingId: string | null) => void | Promise<void>
  onCurrentDocumentAnchorNavigate?: (headingId: string) => void
  onInvalidDocumentLink?: (href: string, reason: DocumentLinkInvalidReason) => void
}

function renderCodeBlock({ children }: { children?: ReactNode }) {
  if (isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    const language = children.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]

    if (language?.toLowerCase() === 'mermaid') {
      const chart = String(children.props.children ?? '').replace(/\n$/, '')
      return <MermaidDiagram chart={chart} />
    }
  }

  return <pre>{children}</pre>
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

export function ReadonlyMarkdownRendererImpl({
  value,
  currentDocumentPath = null,
  documentPaths = [],
  contentRoots = ['.'],
  getDocumentLinkHref,
  getAssetHref,
  onDocumentLinkNavigate,
  onCurrentDocumentAnchorNavigate,
  onInvalidDocumentLink,
}: ReadonlyMarkdownRendererImplProps) {
  const transformedValue = useMemo(() => applyMarkdownTransforms(value), [value])
  const knownDocumentPaths = useMemo(() => createKnownDocumentPathSet(documentPaths), [documentPaths])
  const rootRef = useRef<HTMLDivElement | null>(null)

  const renderLink = useCallback(({ href, children, ...anchorProps }: ComponentPropsWithoutRef<'a'>) => {
    const rawHref = href ?? ''
    const resolution = currentDocumentPath
      ? resolveDocumentLink({ currentDocumentPath, href: rawHref, documentPaths, knownDocumentPaths, contentRoots })
      : { kind: 'external' as const, href: rawHref }

    if (resolution.kind === 'external') {
      return (
        <a href={resolution.href} {...anchorProps}>
          {children}
        </a>
      )
    }

    if (resolution.kind === 'invalid') {
      const reportInvalid = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        onInvalidDocumentLink?.(resolution.href, resolution.reason)
      }

      return (
        <a href="#" {...anchorProps} target={undefined} onClick={reportInvalid} onAuxClick={reportInvalid}>
          {children}
        </a>
      )
    }

    if (resolution.kind === 'anchor') {
      const navigateAnchor = (event: MouseEvent<HTMLAnchorElement>) => {
        if (isModifiedClick(event)) return
        event.preventDefault()
        onCurrentDocumentAnchorNavigate?.(resolution.headingId)
      }
      const canonicalHref = currentDocumentPath
        ? (getDocumentLinkHref?.(currentDocumentPath, resolution.headingId) ?? '#')
        : '#'

      return (
        <a href={canonicalHref} {...anchorProps} onClick={navigateAnchor}>
          {children}
        </a>
      )
    }

    const canonicalHref = getDocumentLinkHref?.(resolution.documentPath, resolution.headingId) ?? '#'
    const navigateDocument = (event: MouseEvent<HTMLAnchorElement>) => {
      if (isModifiedClick(event)) return
      event.preventDefault()
      void onDocumentLinkNavigate?.(resolution.documentPath, resolution.headingId)
    }

    return (
      <a href={canonicalHref} {...anchorProps} onClick={navigateDocument}>
        {children}
      </a>
    )
  }, [
    contentRoots,
    currentDocumentPath,
    documentPaths,
    getDocumentLinkHref,
    knownDocumentPaths,
    onCurrentDocumentAnchorNavigate,
    onDocumentLinkNavigate,
    onInvalidDocumentLink,
  ])
  const renderImage = useCallback(({ src, alt, title }: ComponentPropsWithoutRef<'img'>) => {
    const resolution = resolveImageSource(typeof src === 'string' ? src : '', currentDocumentPath, contentRoots)
    const href = resolution.kind === 'external' ? resolution.href
      : resolution.kind === 'internal' ? getAssetHref?.(resolution.path) : undefined
    if (!href) {
      return <span className="markdown-image-unavailable" data-image-error={resolution.kind === 'invalid' ? resolution.reason : 'missing-asset-provider'}>{alt || '图片不可用'}</span>
    }
    return <img src={href} alt={alt ?? ''} title={title} loading="lazy" decoding="async" style={{ maxWidth: '100%', height: 'auto' }} />
  }, [currentDocumentPath, contentRoots, getAssetHref])
  const components = useMemo(() => ({ pre: renderCodeBlock, a: renderLink, img: renderImage }), [renderLink, renderImage])

  useEffect(() => {
    syncStrongOnlyParagraphClasses(rootRef.current)
  }, [transformedValue])

  return (
    <div
      ref={rootRef}
      className="readonly-markdown-renderer markdown-document"
      role="group"
      aria-label="只读 Markdown 渲染器"
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={components}
        urlTransform={(url, key, node) => node.tagName === 'img' && key === 'src' ? url : defaultUrlTransform(url)}
      >
        {transformedValue}
      </ReactMarkdown>
    </div>
  )
}

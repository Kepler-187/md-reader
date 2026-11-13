import { createHeadingSlug } from './heading-outline'

export type DocumentLinkInvalidReason =
  | 'empty-link'
  | 'empty-fragment'
  | 'invalid-percent-encoding'
  | 'unsupported-scheme'
  | 'query-not-supported'
  | 'backslash-path'
  | 'invalid-path'
  | 'path-outside-content-roots'
  | 'target-not-in-file-tree'

export type DocumentLinkResolution =
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; headingId: string }
  | { kind: 'internal'; documentPath: string; headingId: string | null }
  | { kind: 'invalid'; href: string; reason: DocumentLinkInvalidReason }

export interface ResolveDocumentLinkOptions {
  currentDocumentPath: string
  href: string
  documentPaths: Iterable<string>
  knownDocumentPaths?: ReadonlySet<string>
  contentRoots: Iterable<string>
}

const MARKDOWN_EXTENSION_PATTERN = /\.(?:md|mdx)$/i
const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function resolveDocumentLink({
  currentDocumentPath,
  href,
  documentPaths,
  knownDocumentPaths,
  contentRoots,
}: ResolveDocumentLinkOptions): DocumentLinkResolution {
  const rawHref = String(href ?? '').trim()

  if (!rawHref) {
    return invalid(rawHref, 'empty-link')
  }

  if (rawHref.startsWith('#')) {
    const fragment = decodeFragment(rawHref.slice(1))
    return fragment.ok
      ? { kind: 'anchor', headingId: createHeadingSlug(fragment.value) }
      : invalid(rawHref, fragment.reason)
  }

  if (rawHref.startsWith('//')) {
    return { kind: 'external', href: rawHref }
  }

  const scheme = rawHref.match(/^([a-zA-Z][a-zA-Z\d+.-]*:)/)?.[1]?.toLowerCase()
  if (scheme) {
    return ALLOWED_EXTERNAL_SCHEMES.has(scheme)
      ? { kind: 'external', href: rawHref }
      : invalid(rawHref, 'unsupported-scheme')
  }

  const hashIndex = rawHref.indexOf('#')
  const pathPart = hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref
  const rawFragment = hashIndex >= 0 ? rawHref.slice(hashIndex + 1) : null

  if (pathPart.includes('?')) {
    return invalid(rawHref, 'query-not-supported')
  }

  const decodedPath = decodePart(pathPart)
  if (!decodedPath.ok) {
    return invalid(rawHref, decodedPath.reason)
  }

  if (!MARKDOWN_EXTENSION_PATTERN.test(decodedPath.value)) {
    return { kind: 'external', href: rawHref }
  }

  const fragment = rawFragment == null ? null : decodeFragment(rawFragment)
  if (fragment != null && !fragment.ok) {
    return invalid(rawHref, fragment.reason)
  }

  const targetPath = resolveProjectRelativePath(currentDocumentPath, decodedPath.value)
  if (!targetPath.ok) {
    return invalid(rawHref, targetPath.reason)
  }

  const normalizedRoots = Array.from(contentRoots, normalizeContentRoot).filter(
    (root): root is string => root != null,
  )
  if (!isWithinContentRoots(targetPath.value, normalizedRoots)) {
    return invalid(rawHref, 'path-outside-content-roots')
  }

  const resolvedDocumentPaths = knownDocumentPaths ?? createKnownDocumentPathSet(documentPaths)
  if (!resolvedDocumentPaths.has(targetPath.value)) {
    return invalid(rawHref, 'target-not-in-file-tree')
  }

  return {
    kind: 'internal',
    documentPath: targetPath.value,
    headingId: fragment == null ? null : createHeadingSlug(fragment.value),
  }
}

export function createKnownDocumentPathSet(documentPaths: Iterable<string>): ReadonlySet<string> {
  return new Set(
    Array.from(documentPaths, normalizeKnownDocumentPath).filter(
      (documentPath): documentPath is string => documentPath != null,
    ),
  )
}

function invalid(href: string, reason: DocumentLinkInvalidReason): DocumentLinkResolution {
  return { kind: 'invalid', href, reason }
}

function decodeFragment(rawFragment: string): { ok: true; value: string } | { ok: false; reason: DocumentLinkInvalidReason } {
  const decoded = decodePart(rawFragment)
  if (!decoded.ok) return decoded
  return decoded.value ? decoded : { ok: false, reason: 'empty-fragment' }
}

function decodePart(value: string): { ok: true; value: string } | { ok: false; reason: DocumentLinkInvalidReason } {
  try {
    return { ok: true, value: decodeURIComponent(value) }
  } catch {
    return { ok: false, reason: 'invalid-percent-encoding' }
  }
}

export function resolveProjectRelativePath(
  currentDocumentPath: string,
  rawTargetPath: string,
): { ok: true; value: string } | { ok: false; reason: DocumentLinkInvalidReason } {
  if (!rawTargetPath || rawTargetPath.includes('\\') || /^[a-zA-Z]:\//.test(rawTargetPath)) {
    return { ok: false, reason: rawTargetPath.includes('\\') ? 'backslash-path' : 'invalid-path' }
  }

  const isProjectRootPath = rawTargetPath.startsWith('/')
  const baseSegments = isProjectRootPath ? [] : currentDocumentPath.split('/').slice(0, -1)
  const targetSegments = rawTargetPath.split('/')
  const resolvedSegments = [...baseSegments]

  for (const segment of targetSegments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (resolvedSegments.length === 0) {
        return { ok: false, reason: 'path-outside-content-roots' }
      }
      resolvedSegments.pop()
      continue
    }
    resolvedSegments.push(segment)
  }

  if (resolvedSegments.length === 0 || resolvedSegments.some((segment) => segment.includes('\\'))) {
    return { ok: false, reason: 'invalid-path' }
  }

  return { ok: true, value: resolvedSegments.join('/') }
}

export function normalizeContentRoot(root: string): string | null {
  const value = String(root ?? '').trim().replaceAll('\\', '/')
  if (!value || value === '.') return '.'
  if (value.startsWith('/') || value.split('/').some((segment) => segment === '..')) return null
  return value.replace(/^\.\//, '').replace(/\/+$/, '') || '.'
}

function normalizeKnownDocumentPath(documentPath: string): string | null {
  const value = String(documentPath ?? '').trim()
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((segment) => segment === '..')) {
    return null
  }
  return value
}

export function isWithinContentRoots(documentPath: string, contentRoots: string[]): boolean {
  return contentRoots.some((root) => root === '.' || documentPath.startsWith(`${root}/`))
}

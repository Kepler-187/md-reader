import { isWithinContentRoots, normalizeContentRoot, resolveProjectRelativePath } from './document-link'

export function resolveImageSource(src: string, currentDocumentPath: string | null, contentRoots: Iterable<string>):
  { kind: 'external'; href: string } | { kind: 'internal'; path: string } | { kind: 'invalid'; reason: string } {
  if (/^(https?:\/\/|data:)/i.test(src)) return { kind: 'external', href: src }
  if (!src || !currentDocumentPath) return { kind: 'invalid', reason: 'missing-image-context' }
  // Local image paths are relative to the document, not the host filesystem.
  if (/^(\/|[a-z][a-z\d+.-]*:)/i.test(src)) return { kind: 'invalid', reason: 'absolute-image-path' }
  let decoded: string
  try { decoded = decodeURIComponent(src.split(/[?#]/, 1)[0]) }
  catch { return { kind: 'invalid', reason: 'invalid-percent-encoding' } }
  if (/^[\/]|[\x00-\x1f:]/.test(decoded)) return { kind: 'invalid', reason: 'invalid-path' }
  const target = resolveProjectRelativePath(currentDocumentPath, decoded)
  if (!target.ok) return { kind: 'invalid', reason: target.reason }
  const roots = Array.from(contentRoots, normalizeContentRoot).filter((root): root is string => root !== null)
  if (!isWithinContentRoots(target.value, roots)) return { kind: 'invalid', reason: 'path-outside-content-roots' }
  return { kind: 'internal', path: target.value }
}

import { useMemo } from 'react'
import type { LinkIndexPayload } from '../workspace/local-bridge-access'

export function getDocumentRelations(index: LinkIndexPayload | null, path: string | null) {
  if (!index || !path) return { outgoing: [], incoming: [] }
  const titles = new Map(index.nodes.map(node => [node.id, node.title]))
  const outgoing = [...new Set(index.edges.filter(edge => edge.source === path).map(edge => edge.target))]
    .map(target => ({ path: target, title: titles.get(target) ?? target }))
  const incoming = [...new Map((index.backlinks[path] ?? []).map(link => [link.path, link])).values()]
  return { outgoing, incoming }
}

interface Props {
  index: LinkIndexPayload | null
  path: string | null
  graphOpen?: boolean
  loading: boolean
  error: string | null
  onNavigate: (path: string) => void
  onReturnToGraph: () => void
  onRefresh: () => void
}

export function DocumentBacklinksPanel({ index, path, loading, error, graphOpen, onNavigate, onReturnToGraph, onRefresh }: Props) {
  const { outgoing, incoming } = useMemo(() => getDocumentRelations(index, path), [index, path])
  return <section className="document-relations" aria-label="文章关联">
    <header className="document-relations__header">
      <strong>关联</strong>
      <button type="button" className="graph-view__chip" onClick={onRefresh} disabled={loading}>刷新关联</button>
      <button type="button" className="graph-view__chip" onClick={onReturnToGraph} disabled={!path || !index || graphOpen}>回到图谱</button>
    </header>
    <div className="document-relations__content">
      {!path ? <p className="panel__empty">打开文章后查看链接关系。</p>
        : loading && !index ? <p className="panel__empty">正在读取关联…</p>
        : error ? <p className="panel__empty" role="status">{error}</p>
        : !outgoing.length && !incoming.length ? <p className="panel__empty">本文暂时没有和其它文章的链接关系。</p>
        : <>{([['出链', outgoing], ['反链', incoming]] as const).map(([label, links]) => <div key={label}>
          <h3>{label}（{links.length}）</h3>
          {links.length ? links.map(link =>
            <button type="button" className="document-relations__link" key={link.path} title={link.path} onClick={() => onNavigate(link.path)}>{link.title}</button>,
          ) : <p className="panel__empty">暂无{label}</p>}
        </div>)}</>}
    </div>
  </section>
}

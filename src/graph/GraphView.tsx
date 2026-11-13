import { useEffect, useMemo, useRef, useState } from 'react'

import type { LinkIndexPayload } from '../workspace/local-bridge-access'
import { buildGraphView, type LaidOutNode } from './linkGraphAdapter'

interface GraphViewProps {
  index: LinkIndexPayload | null
  loading: boolean
  error: string | null
  currentDocumentPath: string | null
  onDocumentSelect: (path: string) => void
  onClose: () => void
  onRefresh: () => void
}

const TIER_COLOR: Record<string, string> = {
  core: 'var(--graph-node-core, #b4552f)',
  secondary: 'var(--graph-node-secondary, #c98c4a)',
  normal: 'var(--graph-node-normal, #7d8a90)',
}

/**
 * 图谱视图：力导向布局 + 平移缩放 + 点节点跳转。
 *
 * 布局在 useMemo 里算，随作用域/数据变化重算一次。节点几百个以内同步算完
 * （见 forceAdapter），不需要 worker 或进度条。
 */
export function GraphView({
  index,
  loading,
  error,
  currentDocumentPath,
  onDocumentSelect,
  onClose,
  onRefresh,
}: GraphViewProps) {
  const [scope, setScope] = useState<'global' | 'local'>('global')
  const [hops, setHops] = useState(1)
  const [includeIsolated, setIncludeIsolated] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })

  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const layout = useMemo(() => {
    if (!index) return null
    try {
      return buildGraphView(index, {
        scope,
        focusPath: currentDocumentPath,
        hops,
        includeIsolated,
      })
    } catch (err) {
      console.warn('图谱布局失败', err)
      return null
    }
  }, [index, scope, currentDocumentPath, hops, includeIsolated])

  useEffect(() => {
    if (!layout) return
    const { bounds } = layout
    const width = containerRef.current?.clientWidth ?? 900
    const height = containerRef.current?.clientHeight ?? 600
    const graphW = Math.max(1, bounds.maxX - bounds.minX)
    const graphH = Math.max(1, bounds.maxY - bounds.minY)
    const k = Math.min(width / (graphW + 160), height / (graphH + 160), 1.2)
    setTransform({
      x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * k,
      y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * k,
      k,
    })
  }, [layout])

  const nodeById = useMemo(() => {
    const map = new Map<string, LaidOutNode>()
    for (const node of layout?.nodes ?? []) map.set(node.id, node)
    return map
  }, [layout])

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
    setTransform((prev) => {
      const nextK = Math.min(4, Math.max(0.15, prev.k * factor))
      const scale = nextK / prev.k
      return {
        k: nextK,
        x: pointerX - (pointerX - prev.x) * scale,
        y: pointerY - (pointerY - prev.y) * scale,
      }
    })
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    setTransform((prev) => ({
      ...prev,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    }))
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* 已释放 */
    }
  }

  const hoveredNode = hovered ? nodeById.get(hovered) : null

  return (
    <div className="graph-view">
      <div className="graph-view__toolbar">
        <div className="graph-view__group">
          <button
            type="button"
            className="graph-view__chip"
            data-active={scope === 'global' || undefined}
            onClick={() => setScope('global')}
          >
            全局
          </button>
          <button
            type="button"
            className="graph-view__chip"
            data-active={scope === 'local' || undefined}
            onClick={() => setScope('local')}
            disabled={!currentDocumentPath}
            title={currentDocumentPath ? undefined : '先打开一篇文档'}
          >
            当前文档邻近
          </button>
          {scope === 'local' ? (
            <select
              className="graph-view__select"
              value={hops}
              onChange={(event) => setHops(Number(event.target.value))}
              aria-label="邻近跳数"
            >
              <option value={1}>1 跳</option>
              <option value={2}>2 跳</option>
              <option value={3}>3 跳</option>
            </select>
          ) : null}
        </div>

        <label className="graph-view__check">
          <input
            type="checkbox"
            checked={includeIsolated}
            onChange={(event) => setIncludeIsolated(event.target.checked)}
          />
          孤立节点
        </label>

        <div className="graph-view__group graph-view__group--right">
          <span className="graph-view__meta">
            {layout ? layout.nodes.length + ' 节点 · ' + layout.edges.length + ' 连线' : '—'}
          </span>
          <button type="button" className="graph-view__chip" onClick={onRefresh}>
            刷新
          </button>
          <button type="button" className="graph-view__chip" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="graph-view__canvas"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {loading ? <p className="graph-view__empty">正在扫描链接…</p> : null}

        {!loading && error ? (
          <p className="graph-view__empty graph-view__empty--error">{error}</p>
        ) : null}

        {!loading && !error && layout && layout.nodes.length === 0 ? (
          <p className="graph-view__empty">
            没有可画的连线。用双链把几篇文档关联起来，它们就会出现在这里。
          </p>
        ) : null}

        {!loading && !error && layout && layout.nodes.length > 0 ? (
          <svg className="graph-view__svg" aria-label="文档关系图谱">
            <g transform={'translate(' + transform.x + ' ' + transform.y + ') scale(' + transform.k + ')'}>
              {layout.edges.map((edge, edgeIndex) => {
                const a = nodeById.get(edge.source)
                const b = nodeById.get(edge.target)
                if (!a || !b) return null
                return (
                  <line
                    key={edge.source + '-' + edge.target + '-' + edgeIndex}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className="graph-view__edge"
                  />
                )
              })}

              {layout.nodes.map((node) => {
                const isCurrent = node.id === currentDocumentPath
                const isHovered = node.id === hovered
                return (
                  <g
                    key={node.id}
                    className="graph-view__node"
                    transform={'translate(' + node.x + ' ' + node.y + ')'}
                    onPointerEnter={() => setHovered(node.id)}
                    onPointerLeave={() => setHovered((prev) => (prev === node.id ? null : prev))}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDocumentSelect(node.id)
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={node.title}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onDocumentSelect(node.id)
                      }
                    }}
                  >
                    <circle
                      r={node.radius}
                      fill={TIER_COLOR[node.tier] ?? TIER_COLOR.normal}
                      opacity={isHovered ? 1 : 0.82}
                      stroke={isCurrent ? 'var(--text-primary, #1a1a1a)' : 'transparent'}
                      strokeWidth={isCurrent ? 2.5 : 0}
                    />
                    {(node.radius >= 13 || isHovered) && (
                      <text className="graph-view__label" y={node.radius + 14} textAnchor="middle">
                        {node.title.length > 16 ? node.title.slice(0, 15) + '…' : node.title}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        ) : null}

        {hoveredNode ? (
          <div className="graph-view__tooltip">
            <strong>{hoveredNode.title}</strong>
            <span>{hoveredNode.id}</span>
            <span>连接数 {hoveredNode.degree}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

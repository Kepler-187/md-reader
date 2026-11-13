import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { LinkIndexPayload } from '../workspace/local-bridge-access'
import { createLiveForceLayout, measurePositions, type LiveForceLayout } from './forceAdapter'
import { drawGraph, hitTest, resetGraphRenderCache, setGraphLabels, type GraphCamera } from './graphRenderer'
import { graphTopologyKey, reconcileGraphViewState, writeGraphViewState } from './graphViewStore'
import { buildGraphView, type LaidOutNode } from './linkGraphAdapter'

interface GraphViewProps {
  index: LinkIndexPayload | null
  loading: boolean
  error: string | null
  currentDocumentPath: string | null
  /** 图谱状态按项目分桶；切库时不复用别的库的坐标与选中 */
  projectId: string | null
  onCloseGraph: () => void
  onRefreshGraph: () => void
  /** 进入某篇文档的阅读页（不是编辑页） */
  onEnterDocument: (path: string) => void
}

const MIN_SCALE = 0.06
const MAX_SCALE = 4
/** 判定"点击"而非"拖动"的位移阈值（屏幕像素） */
const CLICK_SLOP = 4

/** 相机适配：把整张图放到视口里 */
function fitCamera(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
): GraphCamera {
  const graphW = Math.max(1, bounds.maxX - bounds.minX)
  const graphH = Math.max(1, bounds.maxY - bounds.minY)
  const scale = Math.min(width / (graphW + 160), height / (graphH + 160), 1.2)
  return {
    scale,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  }
}

export function GraphView({
  index,
  loading,
  error,
  currentDocumentPath,
  projectId,
  onCloseGraph,
  onRefreshGraph,
  onEnterDocument,
}: GraphViewProps) {
  const [scope, setScope] = useState<'global' | 'local'>('global')
  const [hops, setHops] = useState(1)
  const [includeIsolated, setIncludeIsolated] = useState(false)

  /** 固定选中的节点：点击后保留，鼠标移开不消失 */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cameraRef = useRef<GraphCamera>({ x: 0, y: 0, scale: 1 })
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({})
  const layoutRef = useRef<LiveForceLayout | null>(null)
  /** 拖动时按需建引擎（复用坐标的场景不预先建） */
  const ensureEngineRef = useRef<(() => LiveForceLayout) | null>(null)
  /** 本次按下是否已经真正进入拖动（建过引擎） */
  const dragStartedRef = useRef(false)
  const selectedRef = useRef<string | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const frameRef = useRef<number | null>(null)
  const reduceMotionRef = useRef(false)
  /** 本次按下是否已经变成拖动：决定 pointerup 走"点击"还是"结束拖动" */
  const dragStateRef = useRef<{
    ids: string[]
    startX: number
    startY: number
    originCamera: GraphCamera
    moved: boolean
    draggingNode: boolean
  } | null>(null)

  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])
  useEffect(() => {
    hoveredRef.current = hoveredId
  }, [hoveredId])

  /* -------------------------------------------------- 作用域过滤后的图 */

  const view = useMemo(() => {
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

  const nodes: LaidOutNode[] = view?.nodes ?? []
  const edges = view?.edges ?? []
  const nodeById = useMemo(() => {
    const map = new Map<string, LaidOutNode>()
    for (const node of nodes) map.set(node.id, node)
    return map
  }, [nodes])

  const topology = useMemo(
    () => graphTopologyKey(nodes.map((node) => node.id), edges),
    [nodes, edges],
  )

  /* -------------------------------------------------- 绘制一帧 */

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const context = canvas.getContext('2d')
    if (!context) return

    const rect = container.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    // 调试钩子：自动化验证用（不影响正常渲染）
    ;(window as any).__graphDebug = {
      positions: positionsRef.current,
      camera: cameraRef.current,
      selectedId: selectedRef.current,
      hasEngine: layoutRef.current !== null,
    }

    drawGraph(context, {
      nodes,
      edges,
      positions: positionsRef.current,
      camera: cameraRef.current,
      width,
      height,
      dpr,
      selectedId: selectedRef.current,
      hoveredId: hoveredRef.current,
      highlightDepth: 1,
      reduceMotion: reduceMotionRef.current,
    })
  }, [nodes, edges])

  /**
   * 排一帧重绘。
   *
   * 用 setTimeout 而不是 requestAnimationFrame：浏览器在后台标签页会暂停 rAF，
   * 那时拖动、冷却、悬停都不会重绘，画面停在旧帧。16ms 定时在前台几乎等价，
   * 后台也能继续出帧。
   */
  const schedulePaint = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.setTimeout(() => {
      frameRef.current = null
      paint()
    }, 16)
  }, [paint])

  /* -------------------------------------------------- 布局与状态恢复 */

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    reduceMotionRef.current = Boolean(media?.matches)
    const onChange = () => {
      reduceMotionRef.current = Boolean(media?.matches)
      schedulePaint()
    }
    media?.addEventListener?.('change', onChange)
    return () => media?.removeEventListener?.('change', onChange)
  }, [schedulePaint])

  useEffect(() => {
    layoutRef.current?.stop()
    layoutRef.current = null
    if (!nodes.length) {
      positionsRef.current = {}
      schedulePaint()
      return
    }

    const stored = projectId ? reconcileGraphViewState(projectId, nodes.map((node) => node.id), topology) : null
    const reusable =
      stored && stored.topology === topology && Object.keys(stored.positions).length > 0
        ? stored.positions
        : null

    setGraphLabels(nodes)
    resetGraphRenderCache()

    /** 建引擎并接到 ref；seed 为空则重新播种，pinAll 用于拖动时固定全图 */
    const buildEngine = (seed: Record<string, { x: number; y: number }> | null, pinAll: boolean) => {
      const engine = createLiveForceLayout(nodes, edges, {
        positions: seed,
        fixedNodeIds: pinAll ? nodes.map((node) => node.id) : [],
        onTick: (next) => {
          positionsRef.current = { ...next }
          schedulePaint()
        },
        onSettle: (next) => {
          positionsRef.current = { ...next }
          schedulePaint()
          if (projectId) writeGraphViewState(projectId, { positions: next, topology })
        },
        onError: (err) => console.warn('力导向布局出错', err),
      })
      layoutRef.current = engine
      return engine
    }
    ensureEngineRef.current = () => layoutRef.current ?? buildEngine(positionsRef.current, true)

    if (reusable) {
      // 有上次的坐标：直接用，不建引擎。免得冷却几百毫秒把恢复的布局推歪，
      // 保留「重开图谱看到同一张图」的承诺。引擎推迟到真正拖动时再建。
      layoutRef.current = null
      positionsRef.current = { ...reusable }
    } else {
      const engine = buildEngine(null, false)
      positionsRef.current = { ...engine.positions }
    }

    // 没有可复用的坐标时适配一次相机；复用坐标时沿用上次的相机
    const container = containerRef.current
    const rect = container?.getBoundingClientRect()
    if (stored?.camera) {
      cameraRef.current = stored.camera
    } else if (rect) {
      cameraRef.current = fitCamera(
        measurePositions(nodes, edges, positionsRef.current),
        rect.width,
        rect.height,
      )
    }
    // 恢复选中：数据变化后已经不存在的节点直接丢弃
    const restoredSelection =
      stored?.selectedId && nodes.some((node) => node.id === stored.selectedId) ? stored.selectedId : null
    setSelectedId(restoredSelection)
    selectedRef.current = restoredSelection

    // 立即同步画一次：后台标签页会暂停 rAF，只靠 schedulePaint 会画布空着
    paint()
    schedulePaint()

    return () => {
      layoutRef.current?.stop()
      layoutRef.current = null
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology, projectId])

  /* -------------------------------------------------- 尺寸变化 */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => schedulePaint())
    observer.observe(container)
    return () => observer.disconnect()
  }, [schedulePaint])

  /* -------------------------------------------------- 交互：拖动 vs 点击 */

  const screenPoint = (event: React.PointerEvent | React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const point = screenPoint(event)
    const hit = hitTest(nodes, edges, positionsRef.current, cameraRef.current, point.x, point.y)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 合成事件（自动化测试）没有真实 pointerId，捕获会抛错；不影响后续逻辑
    }

    dragStartedRef.current = false
    dragStateRef.current = {
      ids: hit ? [hit] : [],
      startX: event.clientX,
      startY: event.clientY,
      originCamera: { ...cameraRef.current },
      moved: false,
      draggingNode: Boolean(hit),
    }

    // 这里刻意不建引擎、不调用 dragStart：
    // 单纯点击也会走 pointerdown，若此时启动仿真，冷却会把恢复的布局推歪。
    // 真正的拖动在 pointermove 越过 CLICK_SLOP 之后才接管。
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current
    const point = screenPoint(event)

    if (!drag) {
      // 没有按下时只更新悬停；已固定的选中不受影响
      const hit = hitTest(nodes, edges, positionsRef.current, cameraRef.current, point.x, point.y)
      if (hit !== hoveredRef.current) {
        hoveredRef.current = hit
        setHoveredId(hit)
        schedulePaint()
      }
      return
    }

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) > CLICK_SLOP) drag.moved = true

    if (drag.draggingNode && drag.moved) {
      // 第一次真正开始拖动：此刻才建引擎并把连通分量升温（邻居弹性跟随）
      if (!dragStateRef.current || !dragStateRef.current.draggingNode) return
      if (!dragStartedRef.current) {
        dragStartedRef.current = true
        const engine = ensureEngineRef.current ? ensureEngineRef.current() : layoutRef.current
        engine?.dragStart(drag.ids)
      }
      // 把节点挪到指针处（世界坐标 = 屏幕坐标反变换再减去锚定框中心）
      const camera = cameraRef.current
      const worldX = (point.x - camera.x) / camera.scale - 83
      const worldY = (point.y - camera.y) / camera.scale - 31
      const activeEngine = layoutRef.current ?? (ensureEngineRef.current ? ensureEngineRef.current() : null)
      activeEngine?.drag(drag.ids, { [drag.ids[0]]: { x: worldX, y: worldY } })
      positionsRef.current = { ...(layoutRef.current?.positions ?? positionsRef.current) }
      paint()
      return
    }

    if (!drag.draggingNode && drag.moved) {
      // 空白处拖动 = 平移视口
      cameraRef.current = {
        ...cameraRef.current,
        x: drag.originCamera.x + dx,
        y: drag.originCamera.y + dy,
      }
      schedulePaint()
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current
    dragStateRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* 已释放 */
    }
    if (!drag) return

    if (drag.draggingNode) {
      if (dragStartedRef.current) {
        layoutRef.current?.dragEnd()
        dragStartedRef.current = false
      }
      if (!drag.moved) {
        // 位移在阈值内：判定为点击 → 固定选中
        const id = drag.ids[0]
        setSelectedId((prev) => (prev === id ? prev : id))
        selectedRef.current = id
        schedulePaint()
      } else if (projectId) {
        writeGraphViewState(projectId, {
          positions: positionsRef.current,
          camera: cameraRef.current,
          topology,
        })
      }
      return
    }

    if (drag.moved && projectId) {
      writeGraphViewState(projectId, { camera: cameraRef.current, topology })
    } else if (!drag.moved) {
      // 点空白取消选中
      setSelectedId(null)
      selectedRef.current = null
      schedulePaint()
    }
  }

  /**
   * 点击兜底。
   *
   * pointer 链路在合成事件、远程桌面、某些触控环境下不一定完整，
   * 而 click 几乎总会到达。这里只在"没有拖动"时生效，避免拖完误选。
   */
  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (dragStateRef.current) return
    const point = screenPoint(event)
    const hit = hitTest(nodes, edges, positionsRef.current, cameraRef.current, point.x, point.y)
    // 诊断锚点：自动化验证会读这个字段确认命中链路
    ;(window as any).__graphHitDebug = {
      point,
      camera: cameraRef.current,
      sample: Object.entries(positionsRef.current).slice(0, 3),
      nodeCount: nodes.length,
      hit,
    }
    const next = hit ?? null
    if (next === selectedRef.current) return
    selectedRef.current = next
    setSelectedId(next)
    if (projectId) {
      writeGraphViewState(projectId, { selectedId: next, positions: positionsRef.current, camera: cameraRef.current, topology })
    }
    schedulePaint()
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
    const prev = cameraRef.current
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor))
    const ratio = scale / prev.scale
    cameraRef.current = {
      scale,
      x: pointerX - (pointerX - prev.x) * ratio,
      y: pointerY - (pointerY - prev.y) * ratio,
    }
    schedulePaint()
    if (projectId) writeGraphViewState(projectId, { camera: cameraRef.current, topology })
  }

  function handlePointerLeave() {
    if (dragStateRef.current) return
    if (hoveredRef.current !== null) {
      hoveredRef.current = null
      setHoveredId(null)
      schedulePaint()
    }
    // 已固定的选中不因移开而清除
  }

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) window.clearTimeout(frameRef.current)
    }
  }, [])

  /* -------------------------------------------------- 信息面板 */

  // 面板显示哪个节点：固定的选中优先，否则显示悬停（未固定时才跟鼠标走）
  const panelId = selectedId ?? hoveredId
  const panelNode = panelId ? nodeById.get(panelId) : null
  const panelPinned = Boolean(selectedId && panelId === selectedId)
  const panelDegree = useMemo(() => {
    if (!panelId) return 0
    return edges.filter((edge) => edge.source === panelId || edge.target === panelId).length
  }, [panelId, edges])

  const handleEnterDocument = useCallback(() => {
    if (!selectedId) return
    // 先把当前视口与选中写回，重开图谱时才能回到这里
    if (projectId) {
      writeGraphViewState(projectId, {
        positions: positionsRef.current,
        camera: cameraRef.current,
        selectedId,
        topology,
      })
    }
    onEnterDocument(selectedId)
  }, [onEnterDocument, projectId, selectedId, topology])

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
            {nodes.length ? `${nodes.length} 节点 · ${edges.length} 连线` : '—'}
          </span>
          <button type="button" className="graph-view__chip" onClick={onRefreshGraph}>
            刷新
          </button>
          <button type="button" className="graph-view__chip" onClick={onCloseGraph}>
            关闭
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="graph-view__canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        onWheel={handleWheel}
      >
        <canvas ref={canvasRef} className="graph-view__canvas-layer" />

        {loading ? <p className="graph-view__empty">正在扫描链接…</p> : null}

        {!loading && error ? (
          <p className="graph-view__empty graph-view__empty--error">{error}</p>
        ) : null}

        {!loading && !error && !nodes.length ? (
          <p className="graph-view__empty">
            没有可画的连线。用双链把几篇文档关联起来，它们就会出现在这里。
          </p>
        ) : null}

        {panelNode ? (
          <aside
            className="graph-view__panel"
            data-pinned={panelPinned || undefined}
            // 面板浮在画布上方，但仍是画布的子节点。不拦住指针事件的话，
            // 点按钮会先被画布当成「点空白」而清空选中，按钮随即 disabled，
            // 这次 click 就永远不会触发。三个事件都要拦。
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="graph-view__panel-head">
              <strong>{panelNode.title}</strong>
              <span className="graph-view__panel-badge">{panelPinned ? '已固定' : '悬停'}</span>
            </div>
            <dl className="graph-view__panel-meta">
              <div>
                <dt>路径</dt>
                <dd title={panelNode.id}>{panelNode.id}</dd>
              </div>
              <div>
                <dt>链接数</dt>
                <dd>{panelDegree}</dd>
              </div>
              {panelNode.tags.length ? (
                <div>
                  <dt>标签</dt>
                  <dd>{panelNode.tags.join('、')}</dd>
                </div>
              ) : null}
            </dl>
            <div className="graph-view__panel-actions">
              <button
                type="button"
                className="graph-view__enter"
                onClick={handleEnterDocument}
                disabled={!selectedId}
                title={selectedId ? undefined : '先点击节点固定选中'}
              >
                进入文章
              </button>
              {selectedId ? (
                <button
                  type="button"
                  className="graph-view__chip"
                  onClick={() => {
                    setSelectedId(null)
                    selectedRef.current = null
                    schedulePaint()
                  }}
                >
                  取消选中
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

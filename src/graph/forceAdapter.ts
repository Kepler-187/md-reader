/**
 * 把 md-reader 的链接索引适配成 @veewo/mechanics 的「读取图」形状，并跑力导向布局。
 *
 * 图结构只需 `{nodes:[{id}], edges:[{id, source, target}]}`，和链接索引天然对应：
 *   - 每个 Markdown 文件是一个节点，id 用项目内相对路径
 *   - 每条引用是一条有向边（自环会被剔除，否则斥力计算会退化）
 *
 * 布局来源：@veewo/mechanics（VeewoGames/mechanics）的 force-simulation 与
 * force-geometry。这套实现的参数（alpha 衰减、斥力、连线长度、节点分档）是在真实
 * 画布上调过的，直接复用比重新调参可靠。
 */
// 这两个是 @veewo/mechanics 的纯 JS 模块（allowJs 已开、checkJs 关），
// TS 对它们导出的推断不完整，这里按 any 使用，形状由本文件的调用处保证。
import * as forceSimulationModule from './forceSimulation.js'
import * as forceGeometryModule from './forceGeometry.js'

const { createForceSimulation, initialForcePositions } = forceSimulationModule as any
const {
  forceNodeProfiles,
  forceNodeRadii,
  forceEdgeGeometry,
  forceEdgeRibbon,
  forceRoutePoint,
  forceRouteSamples,
  forceGraphRoutes,
  FORCE_NODE_SIZE,
  FORCE_PARALLEL_SPACING,
  FORCE_DEFAULT_RADIUS,
} = forceGeometryModule as any

export interface GraphNodeInput {
  id: string
  title: string
  dir: string
  tags: string[]
}

export interface GraphEdgeInput {
  source: string
  target: string
}

export interface LaidOutNode extends GraphNodeInput {
  x: number
  y: number
  radius: number
  degree: number
  tier: string
}

export interface GraphLayoutResult {
  nodes: LaidOutNode[]
  edges: GraphEdgeInput[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

interface Point {
  x: number
  y: number
}

/** 转成 mechanics 需要的读取图（剔除自环与指向不存在节点的边） */
function toReadGraph(nodes: GraphNodeInput[], edges: GraphEdgeInput[]) {
  const ids = new Set(nodes.map((n) => n.id))
  const cleanEdges = edges
    .filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
    .map((e, i) => ({ id: `${e.source}->${e.target}#${i}`, source: e.source, target: e.target }))
  return {
    nodes: nodes.map((n) => ({ id: n.id })),
    edges: cleanEdges,
  }
}

/**
 * 同步跑完布局。
 *
 * mechanics 的仿真基于 requestAnimationFrame 逐帧推进。这里不给它真的 RAF，
 * 而是把它排的帧回调攒下来自己驱动，一次跑完再取位置——这样调用方拿到的是
 * 最终布局，不用处理「布局过程中」的中间态。
 */
export function layoutGraph(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): GraphLayoutResult {
  const graph = toReadGraph(nodes, edges)

  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  }

  let settledPositions: Record<string, Point> | null = null
  const queuedFrames: (() => void)[] = []

  const sim = createForceSimulation({
    // 自己接管帧调度
    requestFrame: (callback: () => void) => {
      queuedFrames.push(callback)
      return queuedFrames.length
    },
    cancelFrame: () => {},
    now: () => performance.now(),
    // 每次推进给足预算，减少帧数
    frameBudgetMs: 200,
    maxDurationMs: 20000,
    onTick: () => {},
    onSettle: (payload: any) => {
      settledPositions = payload?.positions ?? null
    },
    onError: () => {
      settledPositions = settledPositions ?? {}
    },
  })

  const initial = initialForcePositions(graph)
  sim.start({ graph, positions: initial })

  // 驱动帧循环，最多 2000 帧兜底，避免任何情况下卡死
  let guard = 0
  while (settledPositions === null && guard < 2000) {
    const next = queuedFrames.shift()
    if (!next) break
    next()
    guard += 1
  }
  sim.stop()

  const positions: Record<string, Point> = settledPositions ?? initial
  const profiles = forceNodeProfiles(graph)

  const laidOut: LaidOutNode[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    const point = positions[node.id]
    if (!point) continue
    const profile = profiles.get(node.id)
    const radius = profile?.radius ?? 10
    laidOut.push({
      ...node,
      x: point.x,
      y: point.y,
      radius,
      degree: profile?.degree ?? 0,
      tier: profile?.tier ?? 'normal',
    })
    minX = Math.min(minX, point.x - radius)
    minY = Math.min(minY, point.y - radius)
    maxX = Math.max(maxX, point.x + radius)
    maxY = Math.max(maxY, point.y + radius)
  }

  if (laidOut.length === 0) {
    return { nodes: [], edges: graph.edges, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  }

  return {
    nodes: laidOut,
    edges: graph.edges.map((e) => ({ source: e.source, target: e.target })),
    bounds: { minX, minY, maxX, maxY },
  }
}


/** 活体布局句柄：保留仿真引擎，供拖动与实时重绘使用 */
export interface LiveForceLayout {
  /** 当前坐标（锚定框左上角），每帧由 onTick 更新 */
  positions: Record<string, Point>
  /** 拖动一个节点（或一组）开始 */
  dragStart: (ids: string[]) => void
  /** 拖动中：把节点钉在指定坐标 */
  drag: (ids: string[], next: Record<string, Point>) => void
  /** 松手：撤掉固定点，周围的邻居顺势回弹 */
  dragEnd: () => void
  /** 停止仿真并释放 */
  stop: () => void
  /** 仿真是否已收敛 */
  isSettled: () => boolean
}

/**
 * 建一个活体力导向布局。
 *
 * 与 layoutGraph 的区别：layoutGraph 同步跑到收敛后丢弃引擎，适合"进来就画完"；
 * 这个保留引擎并跑 rAF，拖动时节点能实时跟随、邻居弹性回弹——mechanics 原实现的
 * 手感就来自这里（dragStart 里把连通分量升温、dragEnd 让 alpha 自然冷却）。
 */
export function createLiveForceLayout(
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  options: {
    /** 复用上一次的坐标，避免重新随机播种 */
    positions?: Record<string, Point> | null
    fixedNodeIds?: string[]
    onTick: (positions: Record<string, Point>) => void
    onSettle: (positions: Record<string, Point>) => void
    onError?: (error: Error) => void
  },
): LiveForceLayout {
  const graph = toReadGraph(nodes, edges)
  const seed = options.positions && Object.keys(options.positions).length ? options.positions : initialForcePositions(graph)

  let settled = false
  let disposed = false

  // mechanics 默认用 requestAnimationFrame 排帧，而浏览器在后台标签页会暂停 rAF：
  // 那时拖动和冷却都推不动，画面停在旧帧。这里换成 setTimeout 兜底——
  // 前台依旧是每帧一次的节奏，后台也能继续推进。
  const scheduleFrame = (callback: () => void): number =>
    (globalThis.setTimeout(callback, 16) as unknown) as number
  const cancelScheduledFrame = (id: number): void => globalThis.clearTimeout(id)

  const sim = createForceSimulation({
    requestFrame: scheduleFrame,
    cancelFrame: cancelScheduledFrame,
    onTick: (payload: any) => {
      if (disposed) return
      options.onTick(payload?.positions ?? {})
    },
    onSettle: (payload: any) => {
      if (disposed) return
      settled = true
      options.onSettle(payload?.positions ?? {})
    },
    onError: (error: Error) => {
      if (disposed) return
      options.onError?.(error)
    },
  })

  sim.start({
    graph,
    positions: seed,
    fixedNodeIds: (options.fixedNodeIds ?? []).filter((id) => graph.nodes.some((node) => node.id === id)),
  })

  return {
    get positions() {
      return sim.getPositions()
    },
    dragStart: (ids) => {
      if (disposed) return
      settled = false
      sim.dragStart(ids)
    },
    drag: (ids, next) => {
      if (disposed) return
      sim.drag(ids, next)
    },
    dragEnd: () => {
      if (disposed) return
      sim.dragEnd()
    },
    stop: () => {
      disposed = true
      sim.stop()
    },
    isSettled: () => settled,
  }
}

/** 从给定坐标算包围盒，供相机适配使用 */
export function measurePositions(
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  positions: Record<string, Point>,
): GraphLayoutResult['bounds'] {
  const graph = toReadGraph(nodes, edges)
  const profiles = forceNodeProfiles(graph) as Map<string, { radius: number }>
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const point = positions[node.id]
    if (!point) continue
    const radius = profiles.get(node.id)?.radius ?? 10
    minX = Math.min(minX, point.x - radius)
    minY = Math.min(minY, point.y - radius)
    maxX = Math.max(maxX, point.x + radius)
    maxY = Math.max(maxY, point.y + radius)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/* ---------------------------------------------------------------- 几何工具
 * 渲染层需要的几何与配色：直接复用 mechanics 的实现，不另写一套。
 * 这些不是"近似替代"，是同一个函数。
 */
export {
  forceEdgeGeometry,
  forceEdgeRibbon,
  forceRoutePoint,
  forceRouteSamples,
  forceGraphRoutes,
  forceNodeProfiles,
  forceNodeRadii,
  FORCE_NODE_SIZE,
  FORCE_PARALLEL_SPACING,
  FORCE_DEFAULT_RADIUS,
}

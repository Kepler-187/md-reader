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
const { forceNodeProfiles } = forceGeometryModule as any

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

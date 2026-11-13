/**
 * 力导向图的 Canvas 渲染。
 *
 * 移植自 @veewo/mechanics 的 GraphCanvas.drawForceRaster（src/web/canvas.mjs）。
 * 保留的观感要素：
 *   - 节点按档位分色：普通淡、次级更饱和、核心最饱和并带同色外晕（像地图上的城市）
 *   - 聚焦节点及其邻居换成饱和色，其余整体退后（alpha 0.28）
 *   - 相关连线画成锥形缎带：源端粗深、目标端细浅
 *   - 悬停/选中时沿缎带跑光点（尊重 prefers-reduced-motion）
 *   - 名字画在圆下方、屏幕固定字号，缩小时按连接度挑选；核心与聚焦必显
 *
 * 单独成文件：渲染是纯「状态 → 像素」，与交互状态机分开才好调。
 */
import {
  FORCE_NODE_SIZE,
  FORCE_PARALLEL_SPACING,
  forceEdgeGeometry,
  forceEdgeRibbon,
  forceNodeProfiles,
  forceNodeRadii,
  forceRoutePoint,
} from './forceAdapter'
import { FORCE_EDGE_REST, FORCE_RELATION_COLORS, forceNodePalette, hexAlpha } from './graphPalette'
import { isNavigationNode, type LaidOutNode } from './linkGraphAdapter'

const NODE_SIZE = FORCE_NODE_SIZE as { width: number; height: number }
const WIDTH = NODE_SIZE.width
const HEIGHT = NODE_SIZE.height

export interface GraphCamera {
  x: number
  y: number
  scale: number
}

export interface GraphNodePoint {
  x: number
  y: number
}

export interface GraphFocusState {
  centers: Set<string>
  relatedNodes: Set<string>
  relatedEdges: Set<string>
  attention: boolean
}

interface VisibleNode {
  id: string
  label: string
  navigation: boolean
  cx: number
  cy: number
  radius: number
  tier: string
  focus: boolean
  related: boolean
  hovered: boolean
}

interface RouteLike {
  start: GraphNodePoint
  end: GraphNodePoint
  controls: GraphNodePoint[]
}

/** 图结构（供 mechanics 的几何函数使用） */
function readGraph(nodes: LaidOutNode[], edges: { source: string; target: string }[]) {
  return {
    nodes: nodes.map((node) => ({ id: node.id })),
    edges: edges.map((edge, index) => ({ id: `e${index}`, source: edge.source, target: edge.target })),
  }
}

const emptyFocus = (): GraphFocusState => ({
  centers: new Set(),
  relatedNodes: new Set(),
  relatedEdges: new Set(),
  attention: false,
})

/** 计算聚焦集合：选中节点 + N 跳邻居 + 它们之间的边 */
export function computeFocus(
  edges: { source: string; target: string }[],
  focusId: string | null,
  depth = 1,
): GraphFocusState {
  if (!focusId) return emptyFocus()

  const adjacency = new Map<string, { edgeIndex: number; other: string }[]>()
  edges.forEach((edge, edgeIndex) => {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, [])
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, [])
    adjacency.get(edge.source)!.push({ edgeIndex, other: edge.target })
    adjacency.get(edge.target)!.push({ edgeIndex, other: edge.source })
  })
  if (!adjacency.has(focusId)) return emptyFocus()

  const centers = new Set([focusId])
  const relatedNodes = new Set([focusId])
  let frontier = [focusId]
  for (let step = 0; step < Math.max(1, depth); step += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const { other } of adjacency.get(id) ?? []) {
        if (relatedNodes.has(other)) continue
        relatedNodes.add(other)
        next.push(other)
      }
    }
    frontier = next
    if (!frontier.length) break
  }

  const relatedEdges = new Set<string>()
  edges.forEach((edge, edgeIndex) => {
    if (relatedNodes.has(edge.source) && relatedNodes.has(edge.target)) relatedEdges.add(String(edgeIndex))
  })

  return { centers, relatedNodes, relatedEdges, attention: relatedNodes.size > 0 }
}

interface EdgeRouteCache {
  ax: number
  ay: number
  bx: number
  by: number
  route: RouteLike
  ribbonKey?: string
  ribbon?: any
}

let routeCache = new Map<string, EdgeRouteCache>()

/** 数据变了要清缓存，否则会拿旧坐标的连线 */
export function resetGraphRenderCache(): void {
  routeCache = new Map()
}

/* ------------------------------------------------------------------ 渲染 */

export interface GraphRenderInput {
  nodes: LaidOutNode[]
  edges: { source: string; target: string }[]
  positions: Record<string, GraphNodePoint>
  camera: GraphCamera
  width: number
  height: number
  dpr: number
  /** 固定选中的节点（点击后保留） */
  selectedId: string | null
  /** 悬停节点 */
  hoveredId: string | null
  /** 高亮层数：显示选中节点 N 跳以内的关系 */
  highlightDepth?: number
  reduceMotion?: boolean
  /** 默认只显示文件名；勾选后显示项目内完整路径。 */
  showFullPath?: boolean
  now?: number
}

export function drawGraph(context: CanvasRenderingContext2D, input: GraphRenderInput): void {
  const { nodes, edges, positions, camera, width, height, dpr, selectedId, hoveredId } = input
  const { x: cameraX, y: cameraY, scale } = camera

  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  if (!nodes.length) return

  context.translate(cameraX, cameraY)
  context.scale(scale, scale)
  context.lineJoin = 'round'
  context.lineCap = 'round'

  const pixel = 1 / scale
  const now = input.now ?? performance.now()
  const reduceMotion = Boolean(input.reduceMotion)
  const focus = computeFocus(edges, selectedId, input.highlightDepth ?? 1)
  const hoverFocus =
    hoveredId && hoveredId !== selectedId ? computeFocus(edges, hoveredId, 1) : null

  const graph = readGraph(nodes, edges)
  const profiles = forceNodeProfiles(graph) as Map<string, { radius: number; tier: string }>
  const radiiMap = forceNodeRadii(graph) as Map<string, number>

  // 同一条边在两个方向的多重关系要错开，否则重叠
  const pairGroups = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    const key = [edge.source, edge.target].sort().join('\u0000')
    if (!pairGroups.has(key)) pairGroups.set(key, [])
    pairGroups.get(key)!.push(index)
  })

  const restAlpha = Math.max(0.16, Math.min(0.5, 0.2 + 0.14 * Math.log2(1 + Math.max(1, scale))))
  const dim = focus.attention ? 0.22 : 1

  const restRoutes: RouteLike[] = []
  const focusEdges: { color: string; alpha: number; ribbon: any; strong: boolean }[] = []
  const flowEdges: { color: string; alpha: number; ribbon: any }[] = []

  edges.forEach((edge, index) => {
    const a = positions[edge.source]
    const b = positions[edge.target]
    if (!a || !b) return
    const group = pairGroups.get([edge.source, edge.target].sort().join('\u0000')) ?? [index]
    const slot = group.indexOf(index)
    const offset = (slot - (group.length - 1) / 2) * (FORCE_PARALLEL_SPACING as number)
    const radii = { source: radiiMap.get(edge.source), target: radiiMap.get(edge.target) }

    const cacheKey = String(index)
    let cached = routeCache.get(cacheKey)
    let route: RouteLike | null =
      cached && cached.ax === a.x && cached.ay === a.y && cached.bx === b.x && cached.by === b.y
        ? cached.route
        : null
    if (!route) {
      route = forceEdgeGeometry(a, b, edge.source, edge.target, offset, slot, radii) as RouteLike
      cached = { ax: a.x, ay: a.y, bx: b.x, by: b.y, route }
      routeCache.set(cacheKey, cached)
    }

    const related = focus.relatedEdges.has(String(index))
    const hoverRelated = hoverFocus?.relatedEdges.has(String(index)) ?? false
    const strong = related || hoverRelated

    if (strong) {
      const color = FORCE_RELATION_COLORS.reference
      const alpha = focus.centers.has(edge.target) && !focus.centers.has(edge.source) ? 0.6 : 1
      const ribbonKey = `${scale}|${strong}`
      if (cached!.ribbonKey !== ribbonKey) {
        cached!.ribbonKey = ribbonKey
        cached!.ribbon = forceEdgeRibbon(route, {
          startWidth: 6,
          endWidth: 1.25,
          scale,
          dash: [],
          circles: [
            { x: a.x + WIDTH / 2, y: a.y + HEIGHT / 2, radius: radii.source },
            { x: b.x + WIDTH / 2, y: b.y + HEIGHT / 2, radius: radii.target },
          ],
        })
      }
      focusEdges.push({ color, alpha, ribbon: cached!.ribbon, strong })
      if (hoverRelated || related) flowEdges.push({ color, alpha, ribbon: cached!.ribbon })
      return
    }
    restRoutes.push(route)
  })

  // 静止连线：统一中性灰，细虚线，随缩放略微加深
  if (restRoutes.length) {
    context.globalAlpha = restAlpha * 0.85 * dim
    context.strokeStyle = FORCE_EDGE_REST
    context.lineWidth = pixel * 1.4
    context.setLineDash([5 * pixel, 4 * pixel])
    context.beginPath()
    for (const route of restRoutes) {
      context.moveTo(route.start.x, route.start.y)
      const controls = route.controls
      if (controls.length === 2) {
        context.bezierCurveTo(
          controls[0].x,
          controls[0].y,
          controls[1].x,
          controls[1].y,
          route.end.x,
          route.end.y,
        )
      } else if (controls.length) {
        context.quadraticCurveTo(controls[0].x, controls[0].y, route.end.x, route.end.y)
      } else {
        context.lineTo(route.end.x, route.end.y)
      }
    }
    context.stroke()
    context.setLineDash([])
  }

  // 高亮连线：锥形缎带，源端深、目标端浅
  for (const item of focusEdges) {
    context.globalAlpha = item.alpha
    for (const polygon of item.ribbon.polygons) {
      const gradient = context.createLinearGradient(
        polygon.start.x,
        polygon.start.y,
        polygon.end.x,
        polygon.end.y,
      )
      gradient.addColorStop(
        0,
        item.color + Math.round((1 - 0.65 * polygon.from) * 255).toString(16).padStart(2, '0'),
      )
      gradient.addColorStop(
        1,
        item.color + Math.round((1 - 0.65 * polygon.to) * 255).toString(16).padStart(2, '0'),
      )
      context.fillStyle = gradient
      context.beginPath()
      context.moveTo(polygon.points[0].x, polygon.points[0].y)
      for (let step = 1; step < polygon.points.length; step += 1) {
        context.lineTo(polygon.points[step].x, polygon.points[step].y)
      }
      context.closePath()
      context.fill()
    }
  }

  // 流动光点：沿弧长从源向目标匀速跑；减少动效时只留一个静止点
  for (const item of flowEdges) {
    context.globalAlpha = item.alpha
    context.fillStyle = hexAlpha('#ffffff', 0.4, item.color)
    const sampled = item.ribbon.samples
    context.beginPath()
    const count = reduceMotion ? 1 : 3
    for (let index = 0; index < count; index += 1) {
      const progress = reduceMotion ? 0.7 : (now / 1600 + index / 3) % 1
      const point = forceRoutePoint(sampled, progress) as GraphNodePoint
      const radius = 2.5 * pixel
      context.moveTo(point.x + radius, point.y)
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
    }
    context.fill()
  }
  context.globalAlpha = 1
  context.setLineDash([])

  // 节点
  const TIER_ORDER: Record<string, number> = { normal: 0, secondary: 1, core: 2 }
  const floorPx: Record<string, number> = { normal: 0, secondary: 5, core: 10 }
  const halos: { cx: number; cy: number; radius: number; color: string; alpha: number }[] = []
  const visibleNodes: VisibleNode[] = []
  const batches = new Map<
    string,
    {
      alpha: number
      fill: string
      stroke: string
      lineWidth: number
      nodes: { cx: number; cy: number; radius: number }[]
      order: number
    }
  >()
  const palette = forceNodePalette()

  for (const node of nodes) {
    const point = positions[node.id]
    if (!point) continue
    const tier = profiles.get(node.id)?.tier ?? 'normal'
    const radius = Math.max(radiiMap.get(node.id) ?? 10, floorPx[tier] * pixel)
    const cx = point.x + WIDTH / 2
    const cy = point.y + HEIGHT / 2

    const isCenter = focus.centers.has(node.id)
    const isRelated = focus.relatedNodes.has(node.id)
    const isHovered = hoveredId === node.id

    const alpha = focus.attention && !isRelated ? 0.28 : 1
    const restFill =
      tier === 'core' ? palette.core : tier === 'secondary' ? palette.secondary : palette.soft
    const restStroke =
      tier === 'core'
        ? palette.coreStroke
        : tier === 'secondary'
          ? palette.secondaryStroke
          : palette.softStroke
    const focusNow = isCenter || (focus.attention && isRelated) || isHovered
    const fill = focusNow ? (tier === 'normal' ? palette.vivid : restFill) : restFill
    const stroke = isCenter ? '#1f4d3e' : restStroke
    const lineWidth = (isCenter ? 2 : tier === 'core' ? 1.75 : tier === 'secondary' ? 1.25 : 1) * pixel
    const order = (isCenter ? 20 : isRelated ? 10 : 0) + (TIER_ORDER[tier] ?? 0)
    const key = `${alpha}|${fill}|${stroke}|${lineWidth}|${order}`
    if (!batches.has(key)) batches.set(key, { alpha, fill, stroke, lineWidth, nodes: [], order })
    batches.get(key)!.nodes.push({ cx, cy, radius })

    if (tier === 'core') halos.push({ cx, cy, radius, color: palette.halo, alpha: alpha * 0.3 })
    visibleNodes.push({
      id: node.id,
      label: input.showFullPath ? node.id : node.id.replaceAll('\\', '/').split('/').at(-1) || node.id,
      navigation: isNavigationNode(node.id),
      cx,
      cy,
      radius,
      tier,
      focus: isCenter,
      related: isRelated,
      hovered: isHovered,
    })
  }

  // 核心枢纽的同色外晕，先画，不遮圆本身
  for (const halo of halos) {
    context.globalAlpha = halo.alpha
    context.fillStyle = halo.color
    context.beginPath()
    context.arc(halo.cx, halo.cy, halo.radius + 9 * pixel, 0, Math.PI * 2)
    context.fill()
  }
  context.globalAlpha = 1

  // 同款样式合并成一条路径：小的先画，大的后画，枢纽不被压住
  for (const batch of [...batches.values()].sort((left, right) => left.order - right.order)) {
    context.globalAlpha = batch.alpha
    context.fillStyle = batch.fill
    context.strokeStyle = batch.stroke
    context.lineWidth = batch.lineWidth
    context.setLineDash([])
    context.beginPath()
    for (const item of batch.nodes) {
      context.moveTo(item.cx + item.radius, item.cy)
      context.arc(item.cx, item.cy, item.radius, 0, Math.PI * 2)
    }
    context.fill()
    context.stroke()
  }
  context.globalAlpha = 1

  // 光环：悬停淡、选中实
  const ring = (items: VisibleNode[], color: string, widthPx: number, gapPx: number, alpha = 0.9) => {
    if (!items.length) return
    context.globalAlpha = alpha
    context.strokeStyle = color
    context.lineWidth = widthPx * pixel
    context.setLineDash([])
    context.beginPath()
    for (const item of items) {
      const r = item.radius + gapPx * pixel
      context.moveTo(item.cx + r, item.cy)
      context.arc(item.cx, item.cy, r, 0, Math.PI * 2)
    }
    context.stroke()
  }
  ring(
    visibleNodes.filter((item) => item.hovered && !item.focus),
    '#2f6b57',
    1.5,
    4,
    0.45,
  )
  ring(
    visibleNodes.filter((item) => item.focus),
    '#2f6b57',
    2,
    4,
    0.9,
  )
  context.globalAlpha = 1

  drawLabels(context, visibleNodes, {
    scale,
    cameraX,
    cameraY,
    dpr,
    attention: focus.attention,
    related: focus.relatedNodes,
  })

  context.setTransform(dpr, 0, 0, dpr, 0, 0)
}

/* ------------------------------------------------------------------ 标签绘制 */

const labelWidthCache = new Map<string, number>()

function drawLabels(
  context: CanvasRenderingContext2D,
  visibleNodes: VisibleNode[],
  options: {
    scale: number
    cameraX: number
    cameraY: number
    dpr: number
    attention: boolean
    related: Set<string>
  },
): void {
  const { scale, cameraX, cameraY, dpr, attention, related } = options
  if (!visibleNodes.length) return
  if (typeof context.fillText !== 'function') return

  const CELL = 48
  const grid = new Map<number, number[][]>()
  const cellsOf = (box: number[]) => {
    const keys: number[] = []
    for (let gx = Math.floor(box[0] / CELL); gx <= Math.floor(box[2] / CELL); gx += 1) {
      for (let gy = Math.floor(box[1] / CELL); gy <= Math.floor(box[3] / CELL); gy += 1) {
        keys.push((gx * 73856093) ^ (gy * 19349663))
      }
    }
    return keys
  }
  const occupy = (box: number[]) => {
    for (const key of cellsOf(box)) {
      let list = grid.get(key)
      if (!list) grid.set(key, (list = []))
      list.push(box)
    }
  }
  const collides = (box: number[]) => {
    for (const key of cellsOf(box)) {
      for (const other of grid.get(key) ?? []) {
        if (box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]) return true
      }
    }
    return false
  }

  // 先把可见圆占位，名字不压到别的圆上
  if (scale >= 0.12) {
    for (const item of visibleNodes) {
      const sx = item.cx * scale + cameraX
      const sy = item.cy * scale + cameraY
      const r = item.radius * scale
      occupy([sx - r, sy - r, sx + r, sy + r])
    }
  }

  const tierVisible: Record<string, boolean> = {
    core: scale >= 0.02,
    secondary: scale >= 0.07,
    normal: false,
  }
  const priority = (item: VisibleNode) =>
    (item.focus || item.hovered ? 1e6 : 0) +
    (item.navigation ? 5e5 : 0) +
    (attention && related.has(item.id) ? 1e5 : 0) +
    ({ core: 2e4, secondary: 1e4, normal: 0 }[item.tier] ?? 0)

  const shown = visibleNodes
    .filter(
      (item) =>
        item.navigation ||
        item.focus ||
        item.hovered ||
        (attention && related.has(item.id)) ||
        (!attention && tierVisible[item.tier]),
    )
    .sort((left, right) => priority(right) - priority(left))

  const font = 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.textBaseline = 'top'
  context.textAlign = 'center'
  const small = scale < 0.3

  let drawn = 0
  for (const item of shown) {
    // 导航名称始终可读，不受缩放、聚焦、避让或普通标签数量上限隐藏。
    const forced = item.navigation || item.focus || item.hovered
    if (drawn >= 400 && !forced) continue
    const style =
      item.tier === 'core'
        ? { weight: 700, size: small ? 13 : 15, color: '#18221d' }
        : item.tier === 'secondary'
          ? { weight: 600, size: small ? 11.5 : 12.5, color: '#2b3631' }
          : { weight: item.focus ? 600 : 500, size: small ? 10.5 : 11.5, color: '#56625c' }
    context.font = `${style.weight} ${style.size}px ${font}`
    const label = item.label
    if (!label) continue
    const widthKey = `${context.font}|${label}`
    let width = labelWidthCache.get(widthKey)
    if (width === undefined) {
      width = context.measureText(label).width
      if (labelWidthCache.size > 4000) labelWidthCache.clear()
      labelWidthCache.set(widthKey, width)
    }
    const sx = item.cx * scale + cameraX
    const top = (item.cy + item.radius) * scale + cameraY + 3
    const box = [sx - width / 2 - 2, top - 1, sx + width / 2 + 2, top + style.size + 2]
    if (!forced && collides(box)) continue
    occupy(box)
    context.globalAlpha = 1
    context.lineWidth = item.tier === 'core' ? 4 : 3
    context.strokeStyle = 'rgba(245,246,244,.92)'
    context.strokeText(label, sx, top)
    context.fillStyle = item.focus ? '#1c2621' : attention && related.has(item.id) ? '#2b3631' : style.color
    context.fillText(label, sx, top)
    drawn += 1
  }

  context.globalAlpha = 1
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
}

/* ------------------------------------------------------------------ 命中 */

/** 屏幕坐标 → 节点 id */
export function hitTest(
  nodes: LaidOutNode[],
  edges: { source: string; target: string }[],
  positions: Record<string, GraphNodePoint>,
  camera: GraphCamera,
  screenX: number,
  screenY: number,
): string | null {
  // 必须传真实边：半径按连接数算，传空边会让所有节点缩成最小档，
  // 命中圆比画出来的圆小一圈，点击会落空。
  const radii = forceNodeRadii(readGraph(nodes, edges)) as Map<string, number>
  let best: { id: string; distance: number } | null = null
  for (const node of nodes) {
    const point = positions[node.id]
    if (!point) continue
    const cx = (point.x + WIDTH / 2) * camera.scale + camera.x
    const cy = (point.y + HEIGHT / 2) * camera.scale + camera.y
    const radius = Math.max((radii.get(node.id) ?? 10) * camera.scale, 10)
    const distance = Math.hypot(screenX - cx, screenY - cy)
    if (distance <= radius + 4 && (!best || distance < best.distance)) best = { id: node.id, distance }
  }
  return best?.id ?? null
}

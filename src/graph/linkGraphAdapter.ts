/**
 * 链接索引 → 力导向布局。
 *
 * 单独一层是因为：链接索引是「谁引用谁」的事实，布局是「画在哪」的表现。
 * 图谱视图要做作用域过滤（全局 / 当前文档 N 跳），过滤后的子图要重新布局，
 * 所以这一层必须能被重复调用。
 */
import { layoutGraph } from './forceAdapter'
import type { LaidOutNode, GraphLayoutResult } from './forceAdapter'
import type { LinkIndexPayload } from '../workspace/local-bridge-access'

export type { LaidOutNode, GraphLayoutResult }

export interface GraphViewOptions {
  /** 作用域：global 全库；local 只含当前文档 N 跳以内 */
  scope: 'global' | 'local'
  /** scope=local 时的中心文档 */
  focusPath?: string | null
  /** scope=local 时的跳数，默认 1 */
  hops?: number
  /** 是否显示没有任何连线的孤立节点 */
  includeIsolated?: boolean
}

/** 邻接表（无向，用于计算 N 跳邻居） */
function buildAdjacency(nodes: string[], edges: { source: string; target: string }[]) {
  const adj = new Map<string, Set<string>>()
  for (const id of nodes) adj.set(id, new Set())
  for (const e of edges) {
    adj.get(e.source)?.add(e.target)
    adj.get(e.target)?.add(e.source)
  }
  return adj
}

/** 取 focus 出发 hops 跳以内的节点集 */
function collectNeighborhood(
  adjacency: Map<string, Set<string>>,
  focus: string,
  hops: number,
): Set<string> {
  const seen = new Set<string>([focus])
  let frontier = [focus]
  for (let depth = 0; depth < hops; depth += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (seen.has(neighbor)) continue
        seen.add(neighbor)
        next.push(neighbor)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return seen
}

/**
 * 根据索引与视图选项算出要画的图。
 * 返回 laid-out 节点（含坐标、半径、分档），供 SVG 直接渲染。
 */
export function buildGraphView(
  index: LinkIndexPayload,
  options: GraphViewOptions,
): GraphLayoutResult {
  const allIds = index.nodes.map((n) => n.id)
  const adjacency = buildAdjacency(allIds, index.edges)

  let keep: Set<string> | null = null

  if (options.scope === 'local' && options.focusPath) {
    keep = collectNeighborhood(adjacency, options.focusPath, Math.max(1, options.hops ?? 1))
  }

  if (!options.includeIsolated) {
    // 没有连线的节点不画：全库索引里大量模板、孤立笔记会把画面撑散
    const connected = new Set<string>()
    for (const e of index.edges) {
      connected.add(e.source)
      connected.add(e.target)
    }
    if (keep) {
      for (const id of [...keep]) if (!connected.has(id)) keep.delete(id)
    } else {
      keep = connected
    }
  }

  const nodes = index.nodes.filter((n) => (keep ? keep.has(n.id) : true))
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = index.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

  return layoutGraph(
    nodes.map((n) => ({ id: n.id, title: n.title, dir: n.dir, tags: n.tags })),
    edges.map((e) => ({ source: e.source, target: e.target })),
  )
}

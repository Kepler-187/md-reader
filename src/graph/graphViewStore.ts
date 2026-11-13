/**
 * 图谱视图的跨开关状态。
 *
 * 为什么要有这一层：离开图谱去读文章、再点回图谱时，用户希望看到的是刚才那张
 * 图——同样的布局、同样的缩放平移、同样的选中节点和固定面板。如果一个都不留，
 * 每次进来都重新洗牌，就没法用它当"地图"来理解结构。
 *
 * 状态按项目分子。切换库时不复用别的库的坐标和选中，避免把 A 库的节点 ID 当
 * B 库的用。
 */

export interface GraphCamera {
  x: number
  y: number
  scale: number
}

export interface GraphPoint {
  x: number
  y: number
}

export interface GraphViewState {
  /** 节点坐标（锚定框左上角，与 forceGeometry 的约定一致） */
  positions: Record<string, GraphPoint>
  camera: GraphCamera | null
  /** 固定选中的节点（点击后保留，鼠标移开不丢） */
  selectedId: string | null
  /** 拓扑指纹：节点集合或边集合发生变化时不复用旧布局 */
  topology: string
}

const store = new Map<string, GraphViewState>()

/** 拓扑指纹只看「有哪些点、哪些边」，不看坐标 */
export function graphTopologyKey(nodeIds: string[], edges: { source: string; target: string }[]): string {
  const nodes = [...nodeIds].sort().join('|')
  const links = [...edges.map((edge) => `${edge.source}>${edge.target}`)].sort().join('|')
  return `${nodes}##${links}`
}

export function readGraphViewState(projectId: string): GraphViewState | null {
  return store.get(projectId) ?? null
}

export function writeGraphViewState(projectId: string, patch: Partial<GraphViewState>): void {
  const prev = store.get(projectId)
  store.set(projectId, {
    positions: patch.positions ?? prev?.positions ?? {},
    camera: patch.camera !== undefined ? patch.camera : (prev?.camera ?? null),
    selectedId: patch.selectedId !== undefined ? patch.selectedId : (prev?.selectedId ?? null),
    topology: patch.topology ?? prev?.topology ?? '',
  })
}

/**
 * 数据变化后清理失效部分：节点已不存在就取消选中；拓扑变了就丢布局与相机
 * （坐标对不上新图，留着会画出错位的图）。
 */
export function reconcileGraphViewState(
  projectId: string,
  nodeIds: string[],
  topology: string,
): GraphViewState {
  const prev = store.get(projectId)
  if (!prev) {
    return { positions: {}, camera: null, selectedId: null, topology }
  }
  if (prev.topology !== topology) {
    return { positions: {}, camera: null, selectedId: prev.selectedId && nodeIds.includes(prev.selectedId) ? prev.selectedId : null, topology }
  }
  const alive = new Set(nodeIds)
  const selectedId = prev.selectedId && alive.has(prev.selectedId) ? prev.selectedId : null
  return { ...prev, selectedId, topology }
}

/** 内容库被换掉或索引重建后彻底清空（由 App 主动调用） */
export function clearGraphViewState(projectId: string): void {
  store.delete(projectId)
}

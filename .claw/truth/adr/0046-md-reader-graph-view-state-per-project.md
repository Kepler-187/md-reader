# 0046 · 图谱视图状态按项目分桶保存

## 背景

离开图谱去读文章、再点回图谱，如果每次都重新播种布局，用户看到的是**另一张图**：节点位置全变、缩放重置、刚固定的面板没了。

这个图谱的用途是"理解文档结构的地图"——地图每次都重画，就没法用来认路。

## 决策

在 `src/graph/graphViewStore.ts` 里维护一个 `Map<projectId, GraphViewState>`，保存视图状态及显示选项：

```ts
interface GraphViewState {
  includeNavigation?: boolean                        // 默认 true
  includeIsolated?: boolean                          // 默认 false
  showFullPath?: boolean                             // 默认 false
  positions: Record<string, { x: number; y: number }>  // 节点坐标
  camera: { x: number; y: number; scale: number } | null // 平移缩放
  selectedId: string | null                            // 固定选中的节点
  topology: string                                     // 拓扑指纹
}
```

## 备选方案与取舍

不同内容库的节点 ID 完全不同。共用一份状态会把 A 库的坐标当成 B 库的用——节点错位、选中指向不存在的文件。

不为「回到图谱」另设 focusSelectedId prop：先把当前路径写入 store 的 selectedId，再打开图谱，恢复与手动点选共用唯一状态来源。仅显示路径的切换不改变拓扑，不应触发重新布局。

## 拓扑指纹的作用

指纹 = 排序后的节点 ID 列表 + 排序后的边列表。它的唯一职责是判断"这张图还是不是原来那张"：

- **指纹相同**：复用坐标与相机，用户看到同一张图
- **指纹不同**：丢弃坐标（旧坐标对不上新图，画出来会错位），相机也重置
- **选中**：即使拓扑变了，只要那个节点还在就保留；节点被删则清空

## 配套的两条实现约束

**恢复布局时不建仿真引擎。** 一旦建引擎并让 alpha 冷却，几百毫秒内会把恢复的坐标挤歪，前面保存的就白费了。只有真正拖动时才按需建。

**`pointerdown` 不调用 `dragStart`。** 单纯点击也会走 `pointerdown`；那时启动仿真同样会推歪布局。必须等 `pointermove` 越过 4px 阈值、判定为拖动后才接管。

## 后果与代价

**内存不回收。** 每打开过一个库就留一份坐标，几十个库时会占内存（每个库约 几十KB）。当前不做 LRU，因为实际使用中同时打开的库不会有几十个。

**内存状态不跨页面刷新。** 当前没有持久化序列化或主动舍入；同一页面阅读后重开应精确复用坐标。旧文档把约 7px 漂移归因于舍入不符合实现，不能作为放任布局回归的理由。

**拓扑指纹对"只改内容不改结构"不敏感。** 改一篇文档的正文（引用关系不变）不会触发重布局——这是想要的；但如果节点标题变了，指纹不变、标签会更新，坐标保持。

## 相关

- `src/graph/graphViewStore.ts`：状态存储与失效处理
- `src/graph/GraphView.tsx`：恢复时机、按需建引擎
- `.claw/truth/features/md-reader-graph-interaction-and-state-boundary.md`：配套的长期规则

# 0045 · 图谱渲染改用 Canvas，逐项移植 drawForceRaster

## 背景

图谱最初用 SVG 渲染：每条边一个 `<line>`、每个节点一个 `<g>` + `<circle>` + `<text>`。48 个节点时勉强可用，但和 4320 那个工具（`@veewo/mechanics`）的手感差得明显。

## 决策

改用单个 Canvas，逐项移植 mechanics `GraphCanvas.drawForceRaster`（`src/web/canvas.mjs`）。

## 备选方案与取舍

手感差异不只在配色，而在**每帧做什么**：

| 要素 | SVG 做法 | mechanics 做法 |
| --- | --- | --- |
| 连线强弱 | 改 `stroke-width` | 锥形缎带：源端粗深、目标端细浅的渐变填充 |
| 关系流动 | 无 | 沿弧长跑光点（三颗，尊重减少动效） |
| 节点层次 | 统一描边 | 按档位分色 + 核心枢纽带同色外晕 |
| 聚焦退让 | 改透明度 | 邻居换饱和色、其余退到 alpha 0.28 |
| 标签 | 跟随节点缩放 | 屏幕固定字号 + 空间网格避让 + 按连接度挑选 |

缎带和光点需要按弧长采样（`forceRouteSamples` / `forceRoutePoint`），SVG 的 `<line>` 做不到；用 SVG `<path>` 做渐变带则要为每条边维护 8 段多边形，DOM 数量反而暴涨。

## 后果与代价

**失去 DOM 可访问性。** SVG 节点天然可聚焦、可 Tab、可读屏；Canvas 全都要手写。当前图谱的键盘可达性只有"点画布外"的工具栏按钮，节点本身不可键盘导航。这是明确的已知缺口，不是遗漏。

**节点数上限更早到来。** Canvas 没有 DOM 开销，但同步布局 + 单帧全量重绘在数千节点时会卡。届时要换虚拟化或分块重绘。

**标签宽度依赖 `measureText`**，首帧会有一次全文测量开销；已加缓存（上限 4000 条后清空）。

导航名称必显与完整路径开关是阅读产品的显示规则，不改变 Canvas/力学架构。普通标签保留避让；导航标签绕过隐藏规则，必要时会重叠。当前规则见 [交互 Truth](../features/md-reader-graph-interaction-and-state-boundary.md)。

## 相关

- `src/graph/graphRenderer.ts`：绘制、命中测试、标签避让
- `src/graph/graphPalette.ts`：`forceNodePalette` 移植
- `src/graph/forceAdapter.ts`：几何函数转发（`forceEdgeGeometry` 等）

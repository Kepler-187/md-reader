# md-reader 图谱交互与视图状态边界

## 结论

图谱的交互状态（固定选中、悬停、相机、布局坐标）与渲染行为（Canvas、分档配色、锥形缎带、光点、标签避让）都已按 `@veewo/mechanics` 的 `drawForceRaster` 逐项移植。视图状态按项目分桶保存，重开图谱恢复同一张图；恢复时**不建仿真引擎**，否则冷却会把恢复的布局推歪。

## 长期规则

1. 图谱渲染**必须**用 Canvas，不得回退到 SVG 逐节点 DOM。锥形缎带与沿弧长光点依赖弧长采样（`forceRouteSamples` / `forceRoutePoint`），SVG `<line>` 表达不了；逐边 `<path>` 会让 DOM 数量暴涨。
2. 节点配色**必须**走 `graphPalette.ts` 的 `forceNodePalette`，不得另调色板。它把节点色转成「静止柔和 / 聚焦饱和 / 三档明度」一组颜色，与 mechanics 的观感来源是同一份算法。
3. 点击与拖动**必须**靠位移阈值区分：`pointerup` 时位移小于 4px 判点击，超过判拖动。缺少这道判定会导致拖完误选、点完被当成拖动。
4. **`pointerdown` 不得调用 `dragStart`**。单纯点击也会走 `pointerdown`；那时启动仿真会把恢复的布局推歪。必须等 `pointermove` 越过阈值、判定为拖动后才接管。
5. 恢复布局时**不得**建仿真引擎。有可复用坐标就直接画，引擎推迟到第一次真正拖动才建。否则 alpha 冷却会在几百毫秒内把恢复的图挤歪。
6. `hitTest` **必须**传真实边列表。`forceNodeRadii` 按连接数分档；传空边会把所有节点算成最小档，命中圆比画出来的小一圈，点击全部落空。
7. 信息面板**必须**在容器上拦 `pointerdown` / `pointerup` / `pointermove` / `click` / `wheel`。面板是画布容器的子节点，不拦的话点按钮会先冒泡到画布被当成"点空白"，选中被清空、按钮随即 disabled，那次 click 永远不会触发。
8. 视图状态**必须**按项目分桶（`graphViewStore.ts`）。不同库的节点 ID 完全不同，共用一份状态会把坐标错位、把选中指向不存在的文件。
9. 拓扑指纹变化时**必须**丢弃节点坐标与相机；选中节点若仍存在可保留，被删则清空。
10. 排帧**必须**用 `setTimeout` 而不是只依赖 `requestAnimationFrame`。浏览器在后台标签页会暂停 rAF，那时拖动、冷却、悬停都不会重绘，画面停在旧帧。
11. 「进入文章」**必须**切到常规模式的阅读态（`regularViewState: 'locked'`）并退出图谱。用户语义是读书而不是改稿；当前若是分栏也要切回常规，否则右侧预览抢焦点。
12. 拖动按 mechanics `app.mjs:startForceDrag` 开启新仿真：结束旧引擎、复用当前坐标、不传全图 `fixedNodeIds`，随后 `dragStart(ids)`。连通分量激活由 mechanics 自己处理，不另写弹簧或邻居跟随算法；全图固定会使邻居跳过力计算。
13. 拖动坐标按 mechanics `GraphCanvas.move` 使用「按下时节点坐标 + 指针世界位移」，保留抓取偏移；不得强行让圆心对齐指针。拖动后浏览器产生的 click 必须被抑制，以免误选或取消已有选择。
14. `forceSimulation.js`、`forceGeometry.js`、`readGraphIntegrity.js` 为 mechanics 原版拷贝，仅允许适配 import 路径，不修改物理逻辑或常量。

## 真实状态与链路

### 渲染

1. `src/graph/graphRenderer.ts` 的 `drawGraph` 按「连线 → 缎带 → 光点 → 节点 → 光环 → 标签」顺序绘制。
2. 节点按 `alpha|fill|stroke|lineWidth|order` 合并成批次，每批一次 `fill` + 一次 `stroke`；小的先画、大的后画，枢纽不被压住。
3. 连线几何按端点坐标缓存；端点没动时不重算路线，平移缩放只重绘。
4. 标签在屏幕坐标下绘制（`setTransform(dpr,...)` 后不用世界变换），用 48px 网格做重叠检测。

### 状态

1. `graphViewStore.readGraphViewState` / `writeGraphViewState` / `reconcileGraphViewState` 三个入口，按 `projectId` 存取。
2. `GraphView` 的布局 effect 依赖 `[topology, projectId]`：拓扑变或换库才重建。
3. 拖动结束与进入文章前都会写回坐标、相机、选中。

### 信息面板

1. 面板显示 `selectedId ?? hoveredId`；有 `selectedId` 时徽标显示「已固定」。
2. 面板拦截指针事件（规则 7），否则按钮点不动。
3. 「进入文章」先写回状态，再调 `onEnterDocument`；后者在 `App.tsx` 里强制 `mode: 'regular'` + `regularViewState: 'locked'`。

## 已知缺口

- 节点**不可键盘导航**。SVG 时代天然可聚焦，换 Canvas 后失去了；当前只有工具栏按钮可键盘操作。这是明确缺口，不是遗漏。
- 图谱不支持节点拖动固定位置（`fixed` 标记）、不支持导出图片、不支持按目录或标签过滤。
- 数千节点时同步布局与单帧全量重绘会卡，届时需要虚拟化或分块重绘。
- 状态保存在当前页面内存，不跨页面刷新持久化；进入文章后重开应精确恢复保存的坐标，不把布局漂移解释为浮点舍入。
- 图谱内存不回收：每打开过一个库就留一份坐标，不做 LRU。

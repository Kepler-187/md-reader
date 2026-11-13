# 0044 · 力导向布局复用 @veewo/mechanics，不自研

## 背景

关系图谱需要力导向布局。两条路：

- **A**：自己写（d3-force 或从零实现）
- **B**：复用同组织已有的 `@veewo/mechanics`（`VeewoGames/mechanics`）里的实现

## 决策

采用 **B**。服务端索引及端到端图谱已可用，见 [Feature Truth](../features/md-reader-wiki-links-and-graph-boundary.md)。引入三个上游模块：

- `force-simulation.mjs`（391 行）
- `force-geometry.mjs`（201 行）
- `read-graph-integrity.mjs`（约 40 行）

放在 `src/graph/` 下，**只改 import 路径**，逻辑原样保留。

## 备选方案与取舍

### 参数是在真实画布上调过的

那套实现里的常量有明确调优痕迹：

- alpha 每步向目标靠拢 `0.0228`，约 240 步冷却（注释写明「参照 d3 / MemoryGraph」）
- 斥力 `2000`，按本画布连线长度同比放大
- 连线静止长度 `120`，碰撞留白 `30`
- 节点分三档半径：普通 8–13、次级枢纽 16–24、核心枢纽 30–44
- 核心档取前 2%（最多 24 个），次级档取前 10%（最多 150 个），且都要求连接数明显高于中位数

这些数字自己试一遍要花很多轮，而且很难判断「调好了没有」。复用它们可以立刻得到可用的布局质量。

### 依赖极干净

三个文件彼此之间只互相 import，不依赖任何第三方库、不碰 DOM、不碰 canvas。可以直接放进任何前端项目。

原本 `@veewo/mechanics` 的 `canvas.mjs`（3393 行）才是渲染层，我们没有引入它，只取了纯计算部分。

### 复杂度匹配

读取图的结构只需 `{nodes: [{id}], edges: [{id, source, target}]}`，和「文件节点 + 引用边」天然对应，只需 `forceAdapter.ts` 中的轻量适配与自环、悬空端点清理。

## 后果与代价

### 初始布局与实时拖动分工

适配层保留同步 layoutGraph 数据构建，GraphView 通过 createLiveForceLayout 支持首次布局和实际拖动；有可复用坐标时不创建引擎，真正拖动才按需启动。

同步路径接管 requestFrame 自驱队列，实时路径复用同一 mechanics 实现。拖动激活所在连通分量，按抓取偏移更新位置；具体生命周期由 [交互 Truth](../features/md-reader-graph-interaction-and-state-boundary.md) 维护。

当前支持拖动及邻居随动，但未提供节点永久固定位置功能。标签或显示文字的更新不得改变物理参数。

### TypeScript 侧是一层 any

两个 `.js` 文件没有类型声明。`tsconfig.app.json` 开了 `allowJs`、关了 `checkJs`，`forceAdapter.ts` 用 `as any` 引入，形状由自己的调用处保证。

不额外维护 `.d.ts` 是有意的：手写声明容易和上游实现漂移，反而制造「看着有类型实际是错的」的假安全。真正的契约是 `forceAdapter.ts` 那一处调用。

### 无法跟进上游改进

这三份是拷贝，不是依赖。上游后续改了参数或修了 bug，我们不会自动拿到，需要手动同步。考虑到这个 fork 只服务于大书库插件，这个代价可接受。

## 相关

- `src/graph/forceSimulation.js`
- `src/graph/forceGeometry.js`
- `src/graph/readGraphIntegrity.js`
- `src/graph/forceAdapter.ts`：适配层，也是唯一的调用点
- `tsconfig.app.json`：`allowJs: true` / `checkJs: false`

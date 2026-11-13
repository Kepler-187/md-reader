# 0041 · 力导向布局复用 @veewo/mechanics，不自研

## 背景

关系图谱需要力导向布局。两条路：

- **A**：自己写（d3-force 或从零实现）
- **B**：复用同组织已有的 `@veewo/mechanics`（`VeewoGames/mechanics`）里的实现

## 决策

采用 **B**，引入三个文件：

- `force-simulation.mjs`（391 行）
- `force-geometry.mjs`（201 行）
- `read-graph-integrity.mjs`（约 40 行）

放在 `src/graph/` 下，**只改 import 路径**，逻辑原样保留。

## 理由

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

读取图的结构只需 `{nodes: [{id}], edges: [{id, source, target}]}`，和「文件节点 + 引用边」天然对应，不需要中间转换层。

## 代价

### 同步跑完，不是实时仿真

上游实现基于 `requestAnimationFrame` 逐帧推进，配合拖动实时更新。本仓库的用法不同：进入图谱时一次性算完再画。

`forceAdapter.ts` 的做法是接管 `requestFrame`，把排进来的帧回调攒到队列里自己驱动，跑到 `onSettle` 拿到最终坐标为止（实测 6 节点 214 帧收敛，上限 2000 帧兜底）。这样调用方拿到的是纯数据，不用处理中间态。

代价是不支持「拖动节点让图实时重排」。当前图谱不支持节点固定位置，这个功能本来也没做。

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

# md-reader 双链与关系图谱边界

<!-- state: current -->
## 当前行为与结论

双链不依赖链接索引。图谱前端已接线，但仓库缺少 `server/link-index.mjs` 和 bridge 的 `link-index` 路由，图谱数据当前不可用。

双链（`[[目标]]`）由 `src/markdown/remark-wiki-links.ts` 在 AST 阶段改写成标准 `link` 节点，复用既有内部链接解析链路；关系图谱由 `src/graph/` 承担，力导向布局复用 `@veewo/mechanics`，图谱以顶栏模式切换的方式占用中间文档区，不进入标签页模型。

## 长期规则

1. 双链解析**必须**在 AST 层完成（remark 插件改写 `text` 节点），不得改为对源码做正则替换。正则会把 fenced code block 与 inline code 里的 `[[...]]` 一并转换，这是已实测确认的问题。
2. 双链改写后产出标准 `link` 节点，`url` 指向项目内相对路径；带 `#小节` 时保留 hash。不得为双链另建一套导航逻辑或跳过 `resolveDocumentLink` 的内容根与文件树校验。
3. 双链目标省略扩展名时补 `.md`；已有 `.md` / `.mdx` 时保持原样。
4. `REMARK_PLUGINS` 的顺序固定为 `[remarkGfm, remarkWikiLinks, remarkHeadingIds]`：双链需在 GFM 之后（共享文本节点处理），标题 id 需在双链之后（跳转目标依赖已生成的 heading id）。
5. 图谱索引设计要求由服务端提供，不得改为浏览器端逐篇拉取；双链渲染独立完成 AST 改写。`server/link-index.mjs` 尚未入库，不能把前端请求与类型声明当成服务端已实现。
6. 按 mtime 的索引缓存是待接入服务端的设计要求，当前仓库没有此实现。
7. 预期索引抽取双链与标准 Markdown 内部链接，排除外链，将缺失目标收入 `broken` 而非 `edges`；当前只有前端 `LinkIndexPayload` 契约，服务端行为待补齐验证。
8. 图谱**不得**做成标签页。标签页模型依赖「一个标签一个文件路径」，会话恢复、拖拽排序、活动标签判断都建立在这个前提上；图谱是跳转工具，选完节点即离开，用中间区模式切换表达。
9. 图谱里点击节点后**必须**关闭图谱再打开文档，不能停在图谱上。理由同上一条。
10. 布局**必须**同步跑完再交给渲染层。`forceAdapter.ts` 接管 `requestFrame` 把帧回调排队自驱，调用方拿到的是最终坐标；不得把「布局过程中」的中间态暴露给 `GraphView`。
11. `src/graph/forceSimulation.js`、`forceGeometry.js`、`readGraphIntegrity.js` 是 `@veewo/mechanics` 的拷贝，**只允许改 import 路径**，不得修改其内部逻辑与常量。上游参数（alpha 衰减 0.0228、斥力 2000、连线长度 120、节点三档半径）是在真实画布上调过的。
12. TypeScript 对上述两个 `.js` 走 `allowJs: true` / `checkJs: false` + 调用处 `as any`，**不维护** `.d.ts`。手写声明容易与上游实现漂移，产生假安全。
13. 图谱默认不画孤立节点（无连线的文档）。孤立节点由视图层复选框显式开启，不从索引层剔除。

## 真实状态与渲染链路

### 双链

1. `src/markdown/remark-wiki-links.ts` 的 `remarkWikiLinks()` 遍历 `text` 节点，把 `[[…]]` 拆成 `text` 与 `link` 节点并 `splice` 回父节点。
2. 已在 `text` 节点上按 `\[\[([^\[\]|#]+)(?:#([^\[\]|]+))?(?:\|([^\[\]]+))?\]\]` 匹配；代码块与行内代码不是 `text` 节点，天然不受影响。
3. `src/document-renderer/readonly-markdown-renderer-impl.tsx` 的 `REMARK_PLUGINS` 挂载它。
4. 改写出的 `link` 节点进入既有 `renderLink`，由 `resolveDocumentLink` 判定 external / anchor / internal / invalid 四路。

### 图谱

1. `src/App.tsx` 持有 `graphOpen` / `graphIndex` / `graphLoading` / `graphError`；`loadGraphIndex()` 调 `getLinkIndexFromBridge()`。
2. `src/app/TopBar.tsx` 的模式切换组右侧渲染图谱按钮，绑定 `onToggleGraph`。
3. `src/app/WorkspaceLayout.tsx` 在 `graphOpen` 为真时用 `<GraphView>` 替掉中间文档区，否则走原文档渲染分支。
4. `src/graph/GraphView.tsx` 在 `useMemo` 里经 `buildGraphView()` 拿布局，渲染 SVG；平移缩放由组件内 transform 状态承担。
5. `src/graph/linkGraphAdapter.ts` 做作用域过滤（全局 / 邻近 N 跳）与孤立节点过滤，再调 `layoutGraph()`。
6. `src/graph/forceAdapter.ts` 把链接索引转成读取图（剔除自环与悬空端点），同步驱动仿真到收敛，附上 `forceNodeProfiles` 给出的半径与档位。

### 服务端缺口与补齐边界

核对基线：`136db8c`。`src/workspace/local-bridge-access.ts` 的 `getLinkIndexFromBridge()` 发出索引请求；但 Git 文件树不含 `server/link-index.mjs`，`server/bridge-server.mjs` 没有对应分支，请求落入末尾 `Unknown route` 404。

后续待办（本次只纠正文档，不实现）：

1. 将索引实现纳入 `server/link-index.mjs`，审查其与当前扫描器、项目注册及缓存模型的兼容性；验证双链/Markdown 引用、标题、tags、mtime 缓存与 `backlinks`/`broken` 契约。
2. 在 `server/bridge-server.mjs` 顶部引入索引函数，在 `handleRequest()` 内项目路由分派区增加 `GET /api/projects/:id/link-index` 分支（可邻接 `treeMatch`，必须位于末尾未知路由 404 之前），沿用当前 Profile、项目查找和错误处理边界。
3. 插件 vendor 中存在旧基底实现，但尚未合入此仓库；需在后续服务端整包同步时重新适配路由，不得整份覆盖当前 bridge。数据可用性需以接口及图谱端到端验证为准，不能以 TypeScript/Vite 构建通过代替。

## 已知边界

- 双链不做输入补全，`[[` 不触发建议列表。
- 反向链接面板未接入界面：前端类型声明了 `backlinks`，服务端数据尚未入库，但右侧栏目前仍只有标题导航。
- 「未链接提及」未实现。
- 文件改名或移动不改写其它文档中的双链引用。
- 图谱不支持节点拖动固定、不支持导出图片、不支持按目录或标签过滤。
- 图谱坐标不持久化，每次进入重算。
- 图谱使用 SVG 渲染，节点数达到数千时性能会下降；届时需要换 canvas 或虚拟化，当前的同步布局策略也要相应调整。

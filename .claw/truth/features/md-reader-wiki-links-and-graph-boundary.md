# md-reader 双链、链接索引与文章关联边界

<!-- state: current -->
## 当前行为

服务端 `server/link-index.mjs` 与 bridge 的 `GET /api/projects/:id/link-index?profileId=...` 已实现。接口返回 nodes、edges、backlinks、broken、titles、scannedAt、documentCount；图谱与右侧文章关联区共用这一份事实数据。图谱交互、导航显示及标签规则由 [图谱交互 Truth](md-reader-graph-interaction-and-state-boundary.md) 维护。

### 双链渲染与索引解析

- 渲染端 `src/markdown/remark-wiki-links.ts` 只遍历 Markdown AST 的 text 节点，将 wiki 语法改写为标准 link；行内代码与代码块不改写。复用既有 resolveDocumentLink 及内容根/文件树检查，不新建导航机制。
- 只读渲染依次使用 frontmatter、gfm、wikiLinks、headingIds；已有 .md/.mdx 目标保留，其它 wiki 目标由渲染端补 .md，标题锚点保留。
- 服务端抽取 wiki 与标准 Markdown 内部链接；按当前文档目录解析，前导 / 表示项目根。只有目标存在于已扫描路径集合才生成边与反链；不存在的进入 broken。反链按目标及来源路径去重。
- wiki 目标不带已知附件或 Markdown 后缀时，依次尝试 `目标.md`、`目标/目录名.md`。不以任意 path.extname() 结果阻止回退：J.K.罗琳、新版更新视频脚本 2.0 是含点的文章名。已知附件扩展名不追加 .md。此回退仅作用于 wiki。
- 独立运行的 vendor/server 不携带 remark 依赖，索引使用零依赖状态机遮蔽反引号行内代码、反引号/波浪号 fenced code，再运行既有抽链正则。代码示例不得产生真实边或 broken。
- 服务端扫描受项目/Profile 内容根约束，读取内容按绝对路径与 mtime 缓存。每次请求仍执行扫描、检查和索引组装，不是整体索引永远不重算。

### 文章关联与共用缓存

- `src/App.tsx` 的 loadGraphIndex 按 projectId/Profile 缓存 Promise，合并同时发起的请求；打开文档时也加载，关联区不依赖先打开图谱。切换文章/图谱复用请求，当前文档已加载内容发生变化时失效，手动刷新可重取。
- `src/app/DocumentBacklinksPanel.tsx` 从 edges 提取当前文档的出链、从 backlinks 读取反链，两组按对方路径去重，显示对方标题并复用进入文章操作。
- 右侧 sidebar 上半为标题导航、下半为关联，各自滚动；两组均空时显示明确空态；有刷新入口与「回到图谱」按钮。
- 「回到图谱」先写同一 graphViewStore 的 selectedId，再打开图谱，信息面板显示「已固定」。若当前文档会被导航或孤立过滤隐藏，开启必要显示选项以确保目标可见。没有 focusSelectedId prop 或第二套选中优先级。

## 验证与实现锚点

- `server/link-index.mjs`、`server/bridge-server.mjs`：索引与接口。
- `tests/server/link-index.test.mjs`：wiki 扩展名/folder-note、附件不改写、代码遮蔽与标准 Markdown 引用。
- `src/App.tsx`、`src/app/DocumentBacklinksPanel.tsx`、WorkspaceLayout.tsx：缓存、关联与入口。
- `tests/app/document-backlinks.test.tsx`、`tests/graph/`：关联提取、导航过滤、store 恢复、标签与拖拽。
- 真实库数字是验收快照，不是固定契约；参见 [P0 验收](../../../docs/link-index-p0-验收.md)、[关联验收](../../../docs/graph-p1-导航过滤与关联验收.md)、[本轮归档索引](../../../docs/2026-11-14-图谱导航任务归档.md)。

## 兼容性边界

- 索引状态机不是完整 CommonMark AST；复杂列表嵌套、缩进代码、HTML/frontmatter 的全面语法语义尚未覆盖。
- folder-note 回退只在索引实现，渲染侧未同步；URL 解码、query 参数、短名/重名消歧与块引用未统一。不能宣称完整兼容 Obsidian。
- 外部编辑、其它文件变动或移动/删除后可手动刷新；未增加文件监听或轮询扫描。改名/移动不自动改写其它文章链接。
- 未实现未链接提及、双链输入补全、broken 管理界面。图谱展示显式引用，不自动生成内容关系。

<!-- state: history -->
## 演进记录

<!-- dated: 2026-11-13 -->
### 索引从缺失到可用，修复丢边与假边

旧基线 136db8c 缺服务端文件和路由；当前已补齐。省略扩展名的 wiki 原先被精确路径匹配判为 broken，反链也随之丢失；原始 Markdown 正则还误抽代码示例。P0 恢复真实链接并排除代码示例，后续修正含点文件名误判。旧“只有前端契约”“右栏没有反链”的描述不再适用。

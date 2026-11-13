# 导航节点过滤与文章关联区验收

2026-11-13，基于 92615bb。未修改 library 文章、服务端索引、Canvas 渲染器、力学参数或三个 mechanics 拷贝。

## 实现位置

- src/graph/linkGraphAdapter.ts：isNavigationNode 判定末级文件名为 INDEX.md（不区分大小写），或目录段包含 _MOC。先移除导航节点及其关联边，再计算邻近范围与孤立点；不修改传入索引。
- src/graph/GraphView.tsx：工具栏“导航节点”默认不勾选，即默认过滤。显示开关按项目保存在既有 graphViewStore，重开保留。原有布局引擎、Canvas 和拖拽流程未改。
- src/app/DocumentBacklinksPanel.tsx：关联提取、去重、出链/反链标题、跳转、空态、错误与刷新、回到图谱。
- src/app/WorkspaceLayout.tsx、src/index.css：右侧上半标题导航、下半关联，等比例分配，标题区和关联列表分别滚动。沿用 --line、--accent-soft 和继承文字色；不另建主题。
- src/App.tsx：索引请求按 project/profile 共用 Promise 缓存，切换文章/打开图谱不额外扫描；已知文档的已保存内容发生变化时失效，外部改动可点“刷新关联”或图谱“刷新”。切换项目的迟到响应不能覆盖当前索引。src/app/AppShell.tsx 传递事件。

## 回到图谱：唯一选择来源

按钮不持有选中状态。App 先 writeGraphViewState(projectId, {selectedId: currentDocumentPath, ...必要显示选项})，清除浏览器文本选择与焦点，设置 regular/locked，再 setGraphOpen(true)。GraphView 挂载时沿用 reconcileGraphViewState 恢复 selectedId；原有 selectedId 优先于 hoveredId 的信息面板自然显示“已固定”。没有 focusSelectedId prop 或另一套覆盖优先级。

导航页返回时开启导航节点，过滤后孤立的文章返回时开启孤立节点，避免已选目标被显示过滤删掉。关联跳转复用现有进入文章逻辑。图谱仍是中央模式，没有新增 graph 标签页；普通文档仍沿用原标签行为。

## 真实数据与预期差异

| 显示条件 | 节点 | 边 |
|---|---:|---:|
| 原始接口 | 124 | 191 |
| 显示导航，隐藏孤立 | 118 | 191 |
| 隐藏导航，隐藏孤立（默认） | 23 | 30 |
| 隐藏导航，显示孤立 | 115 | 30 |

9 个导航节点为两份 INDEX 和 writing/_MOC 中 7 篇。过滤前 191 条边，移除导航节点的关联边后仅余 30 条；“191−60−45=86”只减去了 INDEX 出边，仍包含 MOC 关系，不能作为过滤 INDEX+MOC 后的边数。默认隐藏孤立节点导致大量仅被导航连接的文章不再显示，所以不是约 90 个节点。勾选孤立节点即可看到其余内容文件。

黑墙主文实际有 11 条出链，包含技术研究；当前正文不再有旧“背景故事设定推演”引用，因此不是预期 12 条。原型人物有 1 条出链、4 条反链，含黑墙主文与人物设定。本文按真实 API 展示，未改文章凑数。原始接口 broken 0，显示过滤不改变接口。

## 浏览器验收

在 http://127.0.0.1:8798 的 library-c6c86f25/default 实测：

1. 未开图谱时黑墙主文关联区已显示，出链 11；点击原型人物后反链含黑墙主文。此时应用只请求一次 link-index。
2. 点击回到图谱，debug selectedId 为 writing/文字创作/黑墙之下/原型人物.md，面板显示“已固定”；标签数由 2 保持 2，请求数仍为 1。
3. 切换导航节点，屏显 23/30 与 118/191；截图如下。
4. templates/writing.md 显示“本文暂时没有和其它文章的链接关系”；从该页返回图谱仍能固定选中自身（自动打开孤立节点）。
5. 标题区与关联区桌面高度约 560/559 px；1024×650 视口分别 98/98 px，关联区保留、列表独立滚动。
6. 用 Chrome 调试协议发送真实鼠标事件拖动 INDEX。当前直接邻居是 60 个（不是旧数据的 42），60/60 随动；松手后位置继续变化，选中仍为原型人物。点击进入文章后图谱关闭、阅读锁定，原语义未变。

证据：[出链](graph-p1-outgoing.png)、[反链](graph-p1-backlinks.png)、[空态](graph-p1-empty.png)、[选中面板与过滤后图谱](graph-p1-selected-filtered.png)、[显示导航节点](graph-p1-navigation-visible.png)、[数值与拖拽证据](graph-p1-browser-evidence.json)。

## 测试与部署

- 新增 14 个测试：导航判定/过滤/源数据不变/局部邻近/空列表 11 个；关联提取、点击回调、空态 3 个。加既有 2 个拖拽测试，定向 16/16 通过。
- 关联索引现在提前加载，因此为 9 份既有 App 测试补了空索引 mock；没有修改旧断言或 tests/workspace/local-bridge-access.test.ts。
- 最终全量 npm test：390 个测试中 372 通过、18 失败。17 个是已知同源地址旧断言失败。另一个 tests/server/service-host.integration.test.ts 在停止 console trace 时重命名临时 service-state.json 返回 EPERM，单独复跑为 7/8，通过/失败模式相同；服务源码和该测试均未改。这一环境/服务问题未解决，不能声称全量通过。修正 mock 后没有未处理异步错误。
- npm ci 成功；tsc -b 和 vite build 成功。依赖仍报告既有 31 项 audit 漏洞，Vite 有大 chunk 提示，本轮未升级依赖。
- 作者目录 vendor/server 全量同步，vendor/dist 整目录替换：鉴于上轮递归删除被审批策略拒绝，本轮将旧 dist 移出插件目录至 clone/temp/vendor-dist-before-graph-p1，再复制全新 dist，避免旧哈希堆积并保留回退备份。
- ghost_forge_install：ok:true、action:updated、namespace:local、instanceId:_ns__local__da-library、enabled:true。运行 health 为 ok:true，端口 8798。
- 安装目录 C:/Users/kepler/AppData/Roaming/Cindy/owners/6c8850ca4de70e1adf50/cindy-brain/_ns/local/da-library 的 18 个 vendor/server/*.mjs 与 vendor/dist/index.html，共 19 项 SHA256 均与作者目录相同，未手动写安装目录。[哈希比对](graph-p1-install-hashes.json)

## 保留边界

外部编辑、删除/移动或别的文章更新后，需要“刷新关联”或图谱“刷新”更新当前缓存；未引入文件监听或轮询扫描。默认只看仍有内容关系的点，孤立内容通过现有开关查看。未新增反链全文上下文、未解析链接管理、URL/query/短名兼容功能。未改服务文件锁问题及旧端口断言。沿用现有主题变量，未新增独立深色模式；已验证桌面和较矮视口，未覆盖所有设备尺寸。

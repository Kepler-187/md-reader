# 0043 · 关系图谱做成中间区模式，不做成标签页

## 背景

引入文档关系图谱时有两个可选形态：

- **A**：顶栏加一个图谱按钮，中间文档区整体切换成图谱视图
- **B**：图谱做成标签页，和文档标签并列

## 决策

采用 **A**。

服务端索引与文章关联均已接入，当前事实由 [Feature Truth](../features/md-reader-wiki-links-and-graph-boundary.md) 维护。本决策只负责图谱不占文档标签页的边界。

## 备选方案与取舍

标签页模型的前提是「一个标签对应一个文件路径」。这个前提被四处代码依赖：

1. `WorkspaceSession.tabs` 的每个 tab 带 `documentPath`
2. 会话恢复时按 tab 的路径重新加载文档
3. 活动标签判断比较 `currentDocumentPath` 与 tab 的路径
4. 拖拽排序把 tab 顺序写回 `openDocumentPaths`

要让标签能表示 `graph://` 这类非文件对象，上述四处都要改，且会话恢复一旦出错用户只能手动重开标签。

图谱用于理解关系并跳转：点击节点固定信息面板，点击面板「进入文章」才退出图谱并进入阅读态。文档与图谱仍通过中央模式切换衔接，不需要新增图谱标签页。

模式切换的改动量是一处状态变量加一个渲染分支，比改标签页模型便宜一个量级。

## 后果与代价

- 无法「一边看文档一边看图谱」并排对照。如果将来确实需要，可以再加一个「图谱放进右侧栏」的只读迷你视图，不必动标签页模型。
- 图谱和其它文档不能同时出现在标签栏；坐标、缩放平移与固定选中由 [ADR 0046](0046-md-reader-graph-view-state-per-project.md) 按项目保留，切回可恢复。

## 相关

- `src/app/TopBar.tsx`：图谱按钮
- `src/app/WorkspaceLayout.tsx`：`graphOpen` 为真时用 `GraphView` 替掉中间区
- `src/App.tsx`：`graphOpen` / `graphIndex` / `graphLoading` / `graphError` 状态与取数

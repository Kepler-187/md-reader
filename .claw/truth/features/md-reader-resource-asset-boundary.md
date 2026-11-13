# 图片资源与预览元数据边界

## 决策

Markdown 图片保留在项目目录，不复制到前端 dist、不转 base64。预览通过项目资源 API 读取，解决相对引用被浏览器错误地相对于页面根解析的问题。YAML front-matter 只在只读预览隐藏，源码与保存链路保持原文。

## 合同

- `server/project-asset.mjs` 是图片读取边界，`bridge-server.mjs` 注册 GET/HEAD `/api/projects/:projectId/asset`，由 profile 注册表定位项目。`path` 必须是规范化后的项目相对路径，URL 查询只解码一次。
- 路径校验不能只靠字符串前缀：拒绝 `..`、绝对路径、反斜线、冒号和控制字符；检查 lexical 与 realpath 两层项目/contentRoots 包含关系，防止符号链接或 junction 越界。不得扩展成任意文件下载接口。
- 仅允许 PNG/JPEG/GIF/WebP/SVG/BMP/AVIF/ICO 后缀；MIME、长度和缓存元数据由服务端给出。SVG 使用 CSP sandbox/default-src none、所有图片使用 nosniff；HEAD 不读取文件正文。缓存为 private、五分钟，不保证同路径替换立即刷新。
- `src/markdown/image-link.ts` 复用 `document-link.ts` 的规范化与内容根判断；允许 Markdown 中的相对父路径，但越出项目或允许内容根时拒绝。服务端仍独立验证，不能信任前端。
- App → AppShell → WorkspaceLayout → ReadonlyMarkdownRenderer → Impl 注入 `getAssetHref`；回调按 project/profile 稳定，避免普通状态刷新重新挂载图片。不能写死服务端口。
- `http://`、`https://`、`data:` 保留；自定义 ReactMarkdown urlTransform 只将 img src 交给图片解析器，普通链接继续使用默认 URL 安全过滤。非法本地图片显示 alt 和 `data-image-error`。
- `remark-frontmatter` 仅挂在只读渲染器；不得在加载/保存时剥离 YAML 或改编辑器源码。原有 gfm → wikiLinks → headingIds 的相对顺序保留。
- 图片懒加载、异步解码、最大宽度 100%，不改变源 Markdown。外链失败沿用浏览器表现，不提供代理或自动重试。

## 验证

资源接口测试覆盖 GET/HEAD 字节和头、Windows/Unix 越界路径、真实路径逃逸、受限 contentRoots、404/415、SVG MIME。渲染测试覆盖中文/编码相对图片、外链/data 保留、非法图片降级、隐藏 YAML/保留代码块及正文分隔线、双链不退化。真实服务上的三篇文章和分栏源码/预览对照另行验收，不把只通过 DOM 单测称为图片可见。

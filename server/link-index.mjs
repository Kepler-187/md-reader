/**
 * 链接索引：扫描项目里所有 Markdown，抽出双链与内部链接，建成反链表和节点图。
 *
 * 为什么放服务端：
 *   - 浏览器逐篇请求文件，1000 篇就是 1000 个 HTTP 请求，撑不住；
 *   - 扫描逻辑（scanMarkdownTree）本来就在服务端，这里直接复用；
 *   - 加一层按 mtime 的缓存后，只有真正改过的文件会被重读。
 *
 * 抽两类引用：
 *   1. 双链  [[目标]] / [[目标|显示文字]] / [[目标#小节]]
 *   2. 标准 Markdown 内部链接  [文字](相对路径.md)
 * 外链（http/https/mailto 等）不参与索引。
 */

import path from "node:path";
import { readFile, stat } from "node:fs/promises";

import { scanMarkdownTree } from "./project-scanner.mjs";
import { resolveMarkdownDocumentPath } from "./project-reader.mjs";

// [[...]]：允许 # 小节与 | 显示文字，目标里不允许出现这些分隔符
const WIKI_LINK_RE = /\[\[([^\[\]|#]+)(?:#([^\[\]|]+))?(?:\|([^\[\]]+))?\]\]/g;
// [文字](目标)：目标是 .md/.mdx，允许带 #小节 与 ?query（后续被忽略）
const MD_LINK_RE = /\[([^\]]*)\]\(([^)\s]+?\.mdx?(?:#[^)\s]*)?)\)/g;

const EXTERNAL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** 把链接目标规范化成项目内相对路径；判断不了就返回 null */
function toProjectPath(rawTarget, fromPath) {
  let target = String(rawTarget ?? "").trim();
  if (!target) return null;
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);

  // 去掉 #小节 与 ?query
  const hashIndex = target.indexOf("#");
  if (hashIndex >= 0) target = target.slice(0, hashIndex);
  const queryIndex = target.indexOf("?");
  if (queryIndex >= 0) target = target.slice(0, queryIndex);
  target = target.trim();
  if (!target) return null;

  if (EXTERNAL_SCHEME_RE.test(target)) return null;
  if (target.startsWith("//")) return null;

  // 以 / 开头视为项目根
  if (target.startsWith("/")) {
    return target.slice(1).replaceAll("\\", "/");
  }

  const fromDir = path.posix.dirname(fromPath);
  const joined = fromDir === "." ? target : `${fromDir}/${target}`;
  return path.posix.normalize(joined).replaceAll("\\", "/");
}

/** 从一段 Markdown 里抽引用 */
function extractLinks(content, fromPath) {
  const links = [];
  const seen = new Set();

  const push = (target, kind, raw, label) => {
    if (!target) return;
    const key = `${kind}:${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ target, kind, raw, label: label || null });
  };

  for (const match of content.matchAll(WIKI_LINK_RE)) {
    const target = match[1].trim();
    const normalized = toProjectPath(target, fromPath);
    push(normalized, "wiki", match[0], (match[3] || match[2] || target).trim());
  }

  for (const match of content.matchAll(MD_LINK_RE)) {
    const target = match[2].trim();
    const normalized = toProjectPath(target, fromPath);
    push(normalized, "markdown", match[0], (match[1] || '').trim());
  }

  return links;
}

/** 解析标题：优先 front-matter 的 title，否则取第一个一级标题，再否则用文件名 */
function resolveTitle(content, filePath) {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const titleLine = fm[1].match(/^title:\s*(.+)$/m);
    if (titleLine) {
      let value = titleLine[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }

  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();

  return path.posix.basename(filePath).replace(/\.mdx?$/i, "");
}

/** 解析 front-matter 的 tags */
function resolveTags(content) {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const line = fm[1].match(/^tags:\s*(.+)$/m);
  if (!line) return [];
  const raw = line[1].trim();
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return raw
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/**
 * 按 mtime 缓存的文档读取。
 * 缓存以「绝对路径 → { mtimeMs, content }」形式存在进程内，插件重启即失效。
 */
const contentCache = new Map();

async function readWithCache(absolutePath) {
  const metadata = await stat(absolutePath);
  const cached = contentCache.get(absolutePath);
  if (cached && cached.mtimeMs === metadata.mtimeMs) {
    return { content: cached.content, mtimeMs: metadata.mtimeMs };
  }
  const content = await readFile(absolutePath, "utf8");
  contentCache.set(absolutePath, { content, mtimeMs: metadata.mtimeMs });
  return { content, mtimeMs: metadata.mtimeMs };
}

/**
 * 构建链接索引。
 *
 * @returns {{
 *   nodes: Array<{id,path,title,tags,dir}>,
 *   edges: Array<{source,target,kind}>,
 *   backlinks: Record<string, Array<{path,title,kind,snippet}>>,
 *   broken: Array<{from,path,raw,kind}>,
 *   scannedAt: string,
 *   documentCount: number,
 * }}
 */
export async function buildLinkIndex(projectRoot, contentRoots = ["."]) {
  // 上游的 scanMarkdownTree 现在返回 [{path, createdAtMs, modifiedAtMs, recentAtMs}]，
  // 早期版本返回纯路径字符串。两种都兼容，索引只关心路径。
  const scanned = await scanMarkdownTree(projectRoot, contentRoots);
  const paths = scanned
    .map((entry) => (typeof entry === "string" ? entry : entry?.path))
    .filter((entry) => typeof entry === "string" && entry.length > 0);
  const pathSet = new Set(paths);

  const nodes = [];
  const edges = [];
  const backlinks = Object.create(null);
  const broken = [];
  /** 标题 → 路径，用于「未链接提及」检测 */
  const titleOwners = new Map();

  for (const relPath of paths) {
    let resolved;
    try {
      resolved = resolveMarkdownDocumentPath(projectRoot, contentRoots, relPath);
    } catch {
      continue;
    }

    let content = "";
    try {
      content = (await readWithCache(resolved.resolvedDocumentPath)).content;
    } catch {
      continue;
    }

    const title = resolveTitle(content, relPath);
    const tags = resolveTags(content);
    const dir = path.posix.dirname(relPath);

    nodes.push({ id: relPath, path: relPath, title, tags, dir: dir === "." ? "" : dir });

    if (!titleOwners.has(title)) titleOwners.set(title, []);
    titleOwners.get(title).push(relPath);

    for (const link of extractLinks(content, relPath)) {
      if (!link.target) continue;
      if (!pathSet.has(link.target)) {
        // 目标不存在：记下来，界面上可以提示「悬空链接」
        broken.push({ from: relPath, path: link.target, raw: link.raw, kind: link.kind });
        continue;
      }
      edges.push({ source: relPath, target: link.target, kind: link.kind });

      if (!backlinks[link.target]) backlinks[link.target] = [];
      if (backlinks[link.target].some((b) => b.path === relPath)) continue;
      backlinks[link.target].push({
        path: relPath,
        title,
        kind: link.kind,
        snippet: link.label || null,
      });
    }
  }

  const titleMap = Object.fromEntries([...titleOwners].map(([t, ps]) => [t, ps]));

  return {
    nodes,
    edges,
    backlinks,
    broken,
    titles: titleMap,
    scannedAt: new Date().toISOString(),
    documentCount: nodes.length,
  };
}

/** 供探测用：清空缓存（测试或手动刷新） */
export function clearLinkIndexCache() {
  contentCache.clear();
}

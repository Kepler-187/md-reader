import { visit } from 'unist-util-visit'
import type { Root, Text, Parent, Link } from 'mdast'

/**
 * 把 Obsidian 风格双链 `[[目标]]` / `[[目标|显示文字]]` / `[[目标#小节]]`
 * 在解析阶段改写成标准 Markdown 链接节点。
 *
 * 为什么做成 remark 插件而不是正则替换源码：
 *   - 正则会误伤代码块、行内代码里的 `[[...]]`；
 *   - 走 AST 能精确只处理普通文本节点，代码块天然不受影响；
 *   - 改写成 Link 节点后，现有的 renderLink 组件（含内部跳转、无效链接提示）
 *     可以原样复用，不用另写一套导航逻辑。
 */
export function remarkWikiLinks() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === null || index === undefined) return
      if (!node.value.includes('[[')) return

      const value = node.value
      const pattern = /\[\[([^\[\]|#]+)(?:#([^\[\]|]+))?(?:\|([^\[\]]+))?\]\]/g

      const children: (Text | Link)[] = []
      let cursor = 0
      let match: RegExpExecArray | null

      while ((match = pattern.exec(value)) !== null) {
        const [whole, rawTarget, rawHeading, rawLabel] = match
        const start = match.index

        if (start > cursor) {
          children.push({ type: 'text', value: value.slice(cursor, start) })
        }

        const target = rawTarget.trim()
        const heading = rawHeading?.trim()
        const label = (rawLabel ?? rawHeading ?? rawTarget).trim()

        // 目标是 .md/.mdx 就直接用；否则补上 .md（Obsidian 里常省略扩展名）
        const withExt = /\.mdx?$/i.test(target) ? target : `${target}.md`
        const href = heading ? `${withExt}#${encodeURIComponent(heading)}` : withExt

        children.push({
          type: 'link',
          url: href,
          title: null,
          children: [{ type: 'text', value: label }],
        })

        cursor = start + whole.length
      }

      if (children.length === 0) return

      if (cursor < value.length) {
        children.push({ type: 'text', value: value.slice(cursor) })
      }

      ;(parent as Parent).children.splice(index, 1, ...children)
      return index + children.length
    })
  }
}

import type { LinkIndexNode } from '../workspace/local-bridge-access'

/** 仅匹配标题和文件名；目录不参与，多词之间为 AND，按字面量搜索。 */
export function searchGraphNodes(nodes: LinkIndexNode[], query: string): LinkIndexNode[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return nodes.filter(node => {
    const fields = [node.title, node.path.replaceAll('\\', '/').split('/').at(-1) ?? '']
      .map(field => field.toLocaleLowerCase())
    return words.every(word => fields.some(field => field.includes(word)))
  })
}

import { expect, it } from 'vitest'
import { searchGraphNodes } from '../../src/graph/graphSearch'

const nodes = [
  { id: 'writing/原型.md', path: 'writing/原型.md', title: '黑墙人物', tags: [], dir: 'writing' },
  { id: 'work/AI [draft].md', path: 'work/AI [draft].md', title: '课程笔记', tags: [], dir: 'work' },
]

it('matches Chinese titles or filenames and combines words across both fields', () => {
  expect(searchGraphNodes(nodes, '黑墙 原型')).toEqual([nodes[0]])
  expect(searchGraphNodes(nodes, '原型')).toEqual([nodes[0]])
})
it('ignores case and surrounding whitespace, and treats punctuation literally', () => {
  expect(searchGraphNodes(nodes, '  ai [draft] ')).toEqual([nodes[1]])
  expect(searchGraphNodes(nodes, '.*')).toEqual([])
})
it('does not search directories, and returns no results for empty or missing matches', () => {
  for (const query of ['writing', ' ', '不存在', '黑墙 课程']) expect(searchGraphNodes(nodes, query)).toEqual([])
  expect(searchGraphNodes([], '原型')).toEqual([])
})

vi.mock('../../src/editor/visual-markdown-editor-loader', () => ({ preloadVisualMarkdownEditor: vi.fn() }))
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RegistryRequestError, type ProjectsSnapshot } from '../../src/workspace/project-registry-contract'

const api = vi.hoisted(() => ({
  list: vi.fn(), register: vi.fn(), active: vi.fn(), remove: vi.fn(), reorder: vi.fn(), reconcile: vi.fn(), tree: vi.fn(), save: vi.fn(), document: vi.fn(),
}))
vi.mock('../../src/shared/key-value-store', () => ({ createBrowserKeyValueStore: () => ({ getItem: async () => null, setItem: async () => {} }) }))
vi.mock('../../src/workspace/local-state', () => ({ createLocalStateStore: () => ({
  getState: async () => ({ openDocumentPaths: ['docs/guide.md'], activeDocumentPath: 'docs/guide.md', activeMode: 'regular', regularViewState: 'editable' }), saveState: async () => {}, updateState: async () => {},
}) }))
vi.mock('../../src/workspace/local-bridge-access', () => ({
  getLinkIndexFromBridge: vi.fn().mockResolvedValue({ nodes: [], edges: [], backlinks: {}, broken: [], titles: {}, scannedAt: '', documentCount: 0 }),
  BridgeDocumentConflictError: class extends Error {}, BridgeDocumentSavedCacheInvalidationError: class extends Error {},
  getLocalBridgeHealth: async () => ({ ok: true, mode: 'local-service', port: 8797 }),
  listProjectsFromBridge: api.list, registerProjectWithBridge: api.register, setActiveProjectWithBridge: api.active,
  unregisterProjectWithBridge: api.remove, reorderProjectsWithBridge: api.reorder, reconcileProjectsWithBridge: api.reconcile,
  listProjectProfilesFromBridge: async () => ({ profileIds: ['default', 'Lans'] }),
  getProfileFromBridge: async (_id: string, profile: string) => ({ id: profile, layout: { sidebarWidth: 280, outlineWidth: 320 }, appearance: { theme: 'system', fontSize: 16, pageWidth: 'narrow' }, navigation: {} }),
  saveProfileToBridge: async (_id: string, profile: object) => profile,
  getFileTreePathsFromBridge: async () => ['docs/guide.md'], refreshFileTreeFromBridge: async () => ['docs/guide.md'],
  getProjectTreeSnapshotFromBridge: api.tree, refreshProjectTreeSnapshotFromBridge: api.tree,
  getDocumentContentFromBridge: api.document,
  saveDocumentContentToBridge: api.save, restartLocalBridgeService: vi.fn(), stopLocalBridgeService: vi.fn(),
}))
vi.mock('../../src/editor/visual-markdown-editor', () => ({ preloadVisualMarkdownEditor: vi.fn(), VisualMarkdownEditor: ({ value, readonly, onChange }: { value: string; readonly: boolean; onChange: (value: string) => void }) => <textarea aria-label="可视 Markdown 编辑器" readOnly={readonly} value={value} onChange={event => onChange(event.target.value)} /> }))
import App from '../../src/App'

const project = (id: string) => ({ id, name: id.toUpperCase(), rootPath: `/${id}`, contentRoots: ['.'], permissionState: 'granted' as const })
let snapshots: Record<string, ProjectsSnapshot>
const clone = <T,>(value: T): T => structuredClone(value)
async function manager(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: '项目切换' }))
  await user.click(screen.getByRole('button', { name: '管理项目…' }))
  return screen.getByRole('dialog', { name: '管理项目' })
}
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
  snapshots = { default: { initialized: true, revision: 1, activeProjectId: 'a', projects: [project('a'), project('b')] }, Lans: { initialized: true, revision: 2, activeProjectId: null, projects: [] } }
  api.list.mockImplementation(async profile => clone(snapshots[profile]))
  api.tree.mockResolvedValue({ entries: [{ path: 'docs/guide.md', createdAtMs: 1, modifiedAtMs: 1, recentAtMs: 1 }] })
  api.document.mockImplementation(async (projectId: string) => ({ path: 'docs/guide.md', content: `# ${projectId}`, mtimeMs: 1, size: 3 }))
  api.active.mockImplementation(async (profile, id, revision) => {
    if (revision !== snapshots[profile].revision) throw new RegistryRequestError('conflict', 'REGISTRY_CONFLICT')
    snapshots[profile].activeProjectId = id; snapshots[profile].revision++
    return clone(snapshots[profile])
  })
  api.remove.mockImplementation(async (profile, id, replacement, revision) => {
    expect(revision).toBe(snapshots[profile].revision)
    const next = snapshots[profile]
    next.projects = next.projects.filter(p => p.id !== id)
    if (next.activeProjectId === id) next.activeProjectId = replacement
    next.revision++
    return clone(next)
  })
  api.reorder.mockImplementation(async (profile, ids) => {
    const next = snapshots[profile]; next.projects = ids.map((id: string) => next.projects.find(p => p.id === id)!)
    next.revision++; return clone(next)
  })
  api.register.mockImplementation(async (profile, _root, revision) => {
    const item = project('c'), next = snapshots[profile]
    expect(revision).toBe(next.revision)
    next.projects.push(item); next.revision++
    return { project: item, snapshot: clone(next) }
  })
  api.reconcile.mockImplementation(async (profile, revision) => {
    if (snapshots[profile].revision === revision) snapshots[profile].revision++
    return clone(snapshots[profile])
  })
  api.save.mockImplementation(async (_id, _profile, docPath, content) => ({ path: docPath, content, mtimeMs: 2, size: content.length }))
})
describe('project management through App', () => {
  it('persists keyboard ordering without switching or reloading the workspace', async () => {
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    const calls = api.tree.mock.calls.length
    const panel = await manager(user)
    await user.click(within(panel).getByRole('button', { name: 'B 上移' }))
    await waitFor(() => expect(api.reorder).toHaveBeenCalledWith('default', ['b', 'a'], 1))
    expect(api.tree).toHaveBeenCalledTimes(calls)
    expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('A')
  })
  it('removes current with its neighbor, clears last, and keeps empty Profile empty', async () => {
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    let panel = await manager(user)
    await user.click(within(panel).getByRole('button', { name: '移除 A' }))
    await user.click(within(panel).getByRole('button', { name: '确认移除' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('B'))
    panel = screen.getByRole('dialog', { name: '管理项目' })
    await user.click(within(panel).getByRole('button', { name: '移除 B' }))
    await user.click(within(panel).getByRole('button', { name: '确认移除' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('选择项目'))
    expect(window.location.search).toBe('')
    await user.click(within(panel).getByRole('button', { name: '关闭' }))
    for (const profile of ['Lans', 'default']) {
      await user.click(screen.getByRole('combobox', { name: 'Profile 切换' }))
      await user.click(screen.getByRole('option', { name: profile }))
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Profile 切换' })).toHaveTextContent(profile))
    }
    expect(api.register).not.toHaveBeenCalled()
    expect(screen.queryByText('正在恢复工作区')).not.toBeInTheDocument()
  })
  it('keeps dirty drafts and registration when adding then cancelling the leave action', async () => {
    const user = userEvent.setup(); render(<App />)
    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    fireEvent.change(editor, { target: { value: '# unsaved' } })
    await user.click(screen.getByRole('button', { name: '接入项目' }))
    await user.type(screen.getByRole('textbox', { name: '项目目录路径' }), '/c')
    await user.click(screen.getByRole('button', { name: '添加并打开' }))
    const gate = await screen.findByRole('dialog', { name: '会话级保存闸门' })
    await user.click(within(gate).getByRole('button', { name: '取消' }))
    expect(api.active).not.toHaveBeenCalled()
    expect(snapshots.default.projects).toHaveLength(3)
    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# unsaved')
  })
  it('prepares added project immediately with the saved target and new revision', async () => {
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    await user.click(screen.getByRole('button', { name: '接入项目' }))
    await user.type(screen.getByRole('textbox', { name: '项目目录路径' }), '/c')
    await user.click(screen.getByRole('button', { name: '添加并打开' }))
    await waitFor(() => expect(api.active).toHaveBeenCalledWith('default', 'c', 2))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('C'))
  })
  it('does not remove current if neighbor preparation fails', async () => {
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    api.tree.mockRejectedValueOnce(new Error('neighbor unavailable'))
    const panel = await manager(user)
    await user.click(within(panel).getByRole('button', { name: '移除 A' }))
    await user.click(within(panel).getByRole('button', { name: '确认移除' }))
    await waitFor(() => expect(within(panel).getByText('neighbor unavailable')).toBeInTheDocument())
    expect(api.remove).not.toHaveBeenCalled()
    expect(snapshots.default.projects).toHaveLength(2)
  })
  it('reconciles an ordinary active write whose response was lost', async () => {
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    api.active.mockImplementationOnce(async () => {
      snapshots.default.activeProjectId = 'b'; snapshots.default.revision++
      throw new RegistryRequestError('unknown', 'REGISTRY_OUTCOME_UNKNOWN', true)
    })
    await user.click(screen.getByRole('combobox', { name: '项目切换' }))
    await user.click(screen.getByRole('option', { name: 'B' }))
    await user.click(await screen.findByRole('button', { name: '重试确认项目列表' }))
    await waitFor(() => expect(api.reconcile).toHaveBeenCalledWith('default', 1))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('B'))
    expect(api.active).toHaveBeenCalledTimes(1)
  })
  it('retains dirty current project when save-all fails before removal', async () => {
    const user = userEvent.setup(); render(<App />)
    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    fireEvent.change(editor, { target: { value: '# keep this draft' } })
    api.save.mockRejectedValue(new Error('save unavailable'))
    const panel = await manager(user)
    await user.click(within(panel).getByRole('button', { name: '移除 A' }))
    await user.click(within(panel).getByRole('button', { name: '确认移除' }))
    const gate = await screen.findByRole('dialog', { name: '会话级保存闸门' })
    await user.click(within(gate).getByRole('button', { name: '保存全部' }))
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    expect(api.remove).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# keep this draft')
  })
  it('does not commit a prepared neighbor after registry conflict', async () => {
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    api.remove.mockRejectedValueOnce(new RegistryRequestError('项目列表已变化', 'REGISTRY_CONFLICT'))
    const panel = await manager(user)
    await user.click(within(panel).getByRole('button', { name: '移除 A' }))
    await user.click(within(panel).getByRole('button', { name: '确认移除' }))
    await waitFor(() => expect(within(panel).getByText('项目列表已变化')).toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('A')
    expect(snapshots.default.projects).toHaveLength(2)
  })
  it('clears pending project identity when an active request is rejected', async () => {
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    api.active.mockRejectedValueOnce(new RegistryRequestError('conflict', 'REGISTRY_CONFLICT'))
    await user.click(screen.getByRole('combobox', { name: '项目切换' }))
    await user.click(screen.getByRole('option', { name: 'B' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('A'))
    expect(screen.queryByText('正在准备文件树和文档状态')).not.toBeInTheDocument()
  })
  it('ignores a removed-project replacement document that finishes after another switch', async () => {
    snapshots.default.projects.push(project('c'))
    let resolveLate!: (payload: object) => void
    const late = new Promise(resolve => { resolveLate = resolve })
    api.document.mockImplementation(async (id: string) => id === 'b' ? late : ({ path: 'docs/guide.md', content: `# ${id}`, mtimeMs: 1, size: 3 }))
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    const panel = await manager(user)
    await user.click(within(panel).getByRole('button', { name: '移除 A' }))
    await user.click(within(panel).getByRole('button', { name: '确认移除' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('B'))
    await user.click(within(panel).getByRole('button', { name: '关闭' }))
    await user.click(screen.getByRole('combobox', { name: '项目切换' }))
    await user.click(screen.getByRole('option', { name: 'C' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# c'))
    await act(async () => { resolveLate({ path: 'docs/guide.md', content: '# late B', mtimeMs: 1, size: 8 }); await late })
    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# c')
  })
  it('makes input read-only while confirming and preparing an unknown active transition', async () => {
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    api.active.mockImplementationOnce(async () => {
      snapshots.default.activeProjectId = 'b'; snapshots.default.revision++
      throw new RegistryRequestError('unknown', 'REGISTRY_OUTCOME_UNKNOWN', true)
    })
    await user.click(screen.getByRole('combobox', { name: '项目切换' }))
    await user.click(screen.getByRole('option', { name: 'B' }))
    await screen.findByRole('button', { name: '重试确认项目列表' })
    let finish!: (value: object) => void
    api.tree.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await user.click(screen.getByRole('button', { name: '重试确认项目列表' }))
    await waitFor(() => expect(screen.getByLabelText('可视 Markdown 编辑器')).toHaveAttribute('readonly'))
    fireEvent.change(screen.getByLabelText('可视 Markdown 编辑器'), { target: { value: '# invalid input during commit' } })
    await act(async () => { finish({ entries: [{ path: 'docs/guide.md', createdAtMs: 1, modifiedAtMs: 1, recentAtMs: 1 }] }) })
    await waitFor(() => expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# b'))
    expect(api.save).not.toHaveBeenCalled()
  })
  it('keeps a pending current document load alive when removing a non-current project', async () => {
    snapshots.default.projects.push(project('c'))
    let finish!: (payload: object) => void
    const late = new Promise(resolve => { finish = resolve })
    api.document.mockImplementation(async (id: string) => id === 'b' ? late : ({ path: 'docs/guide.md', content: '# a', mtimeMs: 1, size: 3 }))
    const user = userEvent.setup(); render(<App />)
    await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    await user.click(screen.getByRole('combobox', { name: '项目切换' }))
    await user.click(screen.getByRole('option', { name: 'B' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('B'))
    const panel = await manager(user)
    await user.click(within(panel).getByRole('button', { name: '移除 C' }))
    await user.click(within(panel).getByRole('button', { name: '确认移除' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalled())
    await act(async () => { finish({ path: 'docs/guide.md', content: '# b', mtimeMs: 1, size: 3 }); await late })
    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# b')
  })
})

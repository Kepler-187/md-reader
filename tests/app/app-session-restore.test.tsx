vi.mock('../../src/editor/visual-markdown-editor-loader', () => ({ preloadVisualMarkdownEditor: vi.fn() }))
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const localState = {
  openDocumentPaths: ['docs/guide.md', 'docs/next.md'],
  activeDocumentPath: 'docs/next.md',
  activeMode: 'split' as const,
  regularViewState: 'editable' as const,
  tabOpenOrder: ['docs/guide.md', 'docs/next.md'],
  pinnedDocumentPaths: [] as string[],
  tabStateByDocument: {
    'docs/guide.md': { lastKnownScrollTop: 128 },
    'docs/next.md': { lastKnownScrollTop: 512 },
  },
  readingProgressByDocument: {
    'docs/guide.md': 128,
    'docs/next.md': 512,
  },
}

const documents = new Map([
  [
    'docs/guide.md',
    {
      path: 'docs/guide.md',
      content: '# Guide\n\nGuide body',
      mtimeMs: 100,
      size: 18,
    },
  ],
  [
    'docs/next.md',
    {
      path: 'docs/next.md',
      content: '# Next\n\nNext body',
      mtimeMs: 200,
      size: 16,
    },
  ],
])

const bridgeMocks = vi.hoisted(() => ({
  getFileTreePathsFromBridge: vi.fn(),
  refreshFileTreeFromBridge: vi.fn(),
  getDocumentContentFromBridge: vi.fn(),
  getProfileFromBridge: vi.fn(),
  listProjectsFromBridge: vi.fn(),
  listProjectProfilesFromBridge: vi.fn(),
  saveProfileToBridge: vi.fn(),
  saveState: vi.fn(),
  updateState: vi.fn(),
}))

vi.mock('../../src/shared/key-value-store', () => ({
  createBrowserKeyValueStore: () => ({
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  }),
}))

vi.mock('../../src/workspace/profile-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/workspace/profile-store')>(),
  createProfileStore: () => ({
    getProfile: vi.fn(async () => ({
      layout: {
        sidebarWidth: 280,
        outlineWidth: 320,
      },
    })),
    saveProfile: vi.fn(async () => undefined),
  }),
}))

vi.mock('../../src/workspace/local-state', () => ({
  createLocalStateStore: () => ({
    getState: vi.fn(async () => localState),
    saveState: bridgeMocks.saveState,
    updateState: bridgeMocks.updateState,
  }),
}))

vi.mock('../../src/workspace/local-bridge-access', () => ({
  getLinkIndexFromBridge: vi.fn().mockResolvedValue({ nodes: [], edges: [], backlinks: {}, broken: [], titles: {}, scannedAt: '', documentCount: 0 }),
  BridgeDocumentConflictError: class BridgeDocumentConflictError extends Error {},
  getLocalBridgeHealth: vi.fn(async () => ({
    ok: true,
    mode: 'local-service',
    projectsLoaded: 1,
    port: 8797,
  })),
  listProjectsFromBridge: bridgeMocks.listProjectsFromBridge,
  listProjectProfilesFromBridge: bridgeMocks.listProjectProfilesFromBridge,
  getProfileFromBridge: bridgeMocks.getProfileFromBridge,
  saveProfileToBridge: bridgeMocks.saveProfileToBridge,
  getFileTreePathsFromBridge: bridgeMocks.getFileTreePathsFromBridge,
  refreshFileTreeFromBridge: bridgeMocks.refreshFileTreeFromBridge,
  getProjectTreeSnapshotFromBridge: async (...args: Parameters<typeof bridgeMocks.getFileTreePathsFromBridge>) => ({
    entries: (await bridgeMocks.getFileTreePathsFromBridge(...args)).map((path: string) => ({ path, createdAtMs: 0, modifiedAtMs: 0, recentAtMs: 0 })),
  }),
  refreshProjectTreeSnapshotFromBridge: async (...args: Parameters<typeof bridgeMocks.refreshFileTreeFromBridge>) => ({
    entries: (await bridgeMocks.refreshFileTreeFromBridge(...args)).map((path: string) => ({ path, createdAtMs: 0, modifiedAtMs: 0, recentAtMs: 0 })),
  }),
  getDocumentContentFromBridge: bridgeMocks.getDocumentContentFromBridge,
  saveDocumentContentToBridge: vi.fn(),
  registerProjectWithBridge: vi.fn(),
  setActiveProjectWithBridge: vi.fn(async (profileId: string, projectId: string, revision: number) => ({ ...(await bridgeMocks.listProjectsFromBridge(profileId)), activeProjectId: projectId, revision: revision + 1 })),
  restartLocalBridgeService: vi.fn(),
  stopLocalBridgeService: vi.fn(),
}))

vi.mock('../../src/editor/visual-markdown-editor', () => ({
  preloadVisualMarkdownEditor: vi.fn(),
  VisualMarkdownEditor: ({
    value,
    readonly,
    onChange,
  }: {
    value: string
    readonly?: boolean
    onChange: (nextValue: string) => void
  }) => (
    <textarea
      aria-label="可视 Markdown 编辑器"
      readOnly={readonly}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

import App from '../../src/App'

describe('App session restore', () => {
  it.each(['docs/guide.md', 'docs/new.md'])('opens %s from the file tree into locked reading while the graph is open', async path => {
    const user = userEvent.setup()
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    try {
      bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md', 'docs/new.md'])
      const original = bridgeMocks.getDocumentContentFromBridge.getMockImplementation()!
      bridgeMocks.getDocumentContentFromBridge.mockImplementation(async (project, profile, target) => target === 'docs/new.md'
        ? { path: target, content: '# New\n\nNew body', mtimeMs: 300, size: 15 }
        : original(project, profile, target))
      const { container } = render(<App />)
      await screen.findByRole('tab', { name: 'next' })
      await user.click(screen.getByRole('button', { name: '关系图谱' }))
      expect(container.querySelector('.graph-view')).toBeInTheDocument()
      await user.click(await screen.findByRole('button', { name: path.split('/').at(-1)! }))
      await waitFor(() => expect(container.querySelector('.graph-view')).not.toBeInTheDocument())
      expect(await screen.findByRole('button', { name: '解锁' })).toBeInTheDocument()
      expect(await screen.findByText(path === 'docs/new.md' ? 'New body' : 'Guide body')).toBeInTheDocument()
      await waitFor(() => expect(bridgeMocks.saveState).toHaveBeenCalledWith('notes', 'default', expect.objectContaining({
        activeDocumentPath: path, activeMode: 'regular', regularViewState: 'locked',
      })))
    } finally {
      context.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost:3000/')
    localState.openDocumentPaths = ['docs/guide.md', 'docs/next.md']
    localState.activeDocumentPath = 'docs/next.md'
    localState.activeMode = 'split'
    localState.regularViewState = 'editable'
    localState.tabOpenOrder = ['docs/guide.md', 'docs/next.md']
    localState.pinnedDocumentPaths = []
    localState.tabStateByDocument = {
      'docs/guide.md': { lastKnownScrollTop: 128 },
      'docs/next.md': { lastKnownScrollTop: 512 },
    }
    localState.readingProgressByDocument = {
      'docs/guide.md': 128,
      'docs/next.md': 512,
    }

    bridgeMocks.getDocumentContentFromBridge.mockReset()
    bridgeMocks.getFileTreePathsFromBridge.mockReset()
    bridgeMocks.refreshFileTreeFromBridge.mockReset()
    bridgeMocks.getProfileFromBridge.mockReset()
    bridgeMocks.listProjectsFromBridge.mockReset()
    bridgeMocks.listProjectProfilesFromBridge.mockReset()
    bridgeMocks.saveProfileToBridge.mockReset()
    bridgeMocks.saveState.mockReset()
    bridgeMocks.updateState.mockReset()
    bridgeMocks.updateState.mockImplementation(async (projectId: string, profileId: string, update: (state: typeof localState) => typeof localState) => bridgeMocks.saveState(projectId, profileId, update(localState)))

    bridgeMocks.listProjectProfilesFromBridge.mockResolvedValue({
      profileIds: ['default', 'Lans'],
    })
    bridgeMocks.listProjectsFromBridge.mockResolvedValue({
      initialized: true, revision: 1,
      activeProjectId: 'notes',
      projects: [
        {
          id: 'notes',
          name: 'Notes',
          rootHandleKey: 'handle:notes',
          contentRoots: ['docs'],
          permissionState: 'granted',
        },
      ],
    })
    bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md'])
    bridgeMocks.refreshFileTreeFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md'])
    bridgeMocks.getProfileFromBridge.mockResolvedValue({
      id: 'default',
      appearance: {
        theme: 'system',
        fontSize: 16,
        pageWidth: 'narrow',
      },
      layout: {
        sidebarWidth: 280,
        outlineWidth: 320,
        sidebarCollapsed: false,
        outlineCollapsed: false,
      },
      navigation: {
        expandedFileNodes: [],
        expandedHeadingNodes: {},
        hiddenPaths: [],
        favoritePaths: [],
        manualNodeOrderByParent: {},
      },
    })
    bridgeMocks.saveProfileToBridge.mockImplementation(async (_projectId, profile) => profile)

    bridgeMocks.getDocumentContentFromBridge.mockImplementation(
      async (_projectId: string, _profileId: string, documentPath: string) => {
        const document = documents.get(documentPath)

        if (!document) {
          throw new Error(`missing document: ${documentPath}`)
        }

        return document
      },
    )
  })

  it('restores a pin and evicts the oldest eligible unpinned tab when opening a new document', async () => {
    const user = userEvent.setup()
    const profile = await bridgeMocks.getProfileFromBridge()
    bridgeMocks.getProfileFromBridge.mockResolvedValue({ ...profile, appearance: { ...profile.appearance, maxUnpinnedTabs: 1 } })
    bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md', 'docs/new.md'])
    documents.set('docs/new.md', { path: 'docs/new.md', content: '# New', mtimeMs: 300, size: 5 })
    render(<App />)
    await screen.findByRole('tab', { name: 'next' })
    await user.click(screen.getByRole('button', { name: '固定标签：guide' }))
    await user.click(screen.getByRole('button', { name: 'new.md' }))
    await screen.findByRole('tab', { name: 'new' })
    expect(screen.getByRole('tab', { name: 'guide' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'next' })).not.toBeInTheDocument()
    expect(bridgeMocks.saveState).toHaveBeenLastCalledWith('notes', 'default', expect.objectContaining({
      pinnedDocumentPaths: ['docs/guide.md'], tabOpenOrder: ['docs/guide.md', 'docs/new.md'],
    }))
    documents.delete('docs/new.md')
  })

  it('restores a pinned tab and clears its pin after a manual close and reopen', async () => {
    const user = userEvent.setup()
    localState.pinnedDocumentPaths = ['docs/guide.md']
    render(<App />)
    expect(await screen.findByRole('button', { name: '取消固定标签：guide' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '关闭标签：guide' }))
    await user.click(await screen.findByRole('button', { name: 'guide.md' }))
    expect(await screen.findByRole('button', { name: '固定标签：guide' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps existing tabs when a new document cannot be read', async () => {
    const user = userEvent.setup()
    const profile = await bridgeMocks.getProfileFromBridge()
    bridgeMocks.getProfileFromBridge.mockResolvedValue({ ...profile, appearance: { ...profile.appearance, maxUnpinnedTabs: 1 } })
    bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md', 'docs/broken.md'])
    render(<App />)
    await screen.findByRole('tab', { name: 'next' })
    await user.click(await screen.findByRole('button', { name: 'broken.md' }))
    expect((await screen.findAllByText(/读取文档失败/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: 'guide' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'next' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the open tab and reports a session persistence failure', async () => {
    const user = userEvent.setup()
    bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md', 'docs/new.md'])
    documents.set('docs/new.md', { path: 'docs/new.md', content: '# New', mtimeMs: 300, size: 5 })
    render(<App />)
    await screen.findByRole('tab', { name: 'next' })
    const newFile = await screen.findByRole('button', { name: 'new.md' })
    bridgeMocks.saveState.mockRejectedValueOnce(new Error('storage full'))
    await user.click(newFile)
    expect(await screen.findByRole('tab', { name: 'new' })).toBeInTheDocument()
    expect((await screen.findAllByText(/会话保存失败/)).length).toBeGreaterThan(0)
    documents.delete('docs/new.md')
  })

  it('refuses an open when every unpinned candidate has an unsaved draft', async () => {
    const user = userEvent.setup()
    const profile = await bridgeMocks.getProfileFromBridge()
    bridgeMocks.getProfileFromBridge.mockResolvedValue({ ...profile, appearance: { ...profile.appearance, maxUnpinnedTabs: 1 } })
    bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md', 'docs/new.md'])
    documents.set('docs/new.md', { path: 'docs/new.md', content: '# New', mtimeMs: 300, size: 5 })
    render(<App />)
    await screen.findByRole('tab', { name: 'next' })
    const editor = await screen.findByRole('textbox', { name: 'Markdown 编辑器' })
    await waitFor(() => expect(editor).toHaveValue('# Next\n\nNext body'))
    await user.click(screen.getByRole('button', { name: '固定标签：guide' }))
    fireEvent.change(editor, { target: { value: '# Unsaved' } })
    await user.click(await screen.findByRole('button', { name: 'new.md' }))
    expect((await screen.findAllByText(/标签页数量已达上限/)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('tab', { name: 'new' })).not.toBeInTheDocument()
    expect(editor).toHaveValue('# Unsaved')
    documents.delete('docs/new.md')
  })

  it('defers trimming after lowering the limit until a new tab is opened', async () => {
    const user = userEvent.setup()
    bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md', 'docs/new.md'])
    documents.set('docs/new.md', { path: 'docs/new.md', content: '# New', mtimeMs: 300, size: 5 })
    render(<App />)
    await screen.findByRole('tab', { name: 'next' })
    await user.click(screen.getByRole('button', { name: '阅读选项' }))
    fireEvent.change(screen.getByRole('slider', { name: /未固定标签上限/ }), { target: { value: '1' } })
    expect(screen.getByRole('tab', { name: 'guide' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'next' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'new.md' }))
    await screen.findByRole('tab', { name: 'new' })
    expect(screen.queryByRole('tab', { name: 'guide' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'next' })).not.toBeInTheDocument()
    documents.delete('docs/new.md')
  })

  it('does not let an older pending open override a later tab selection', async () => {
    const user = userEvent.setup()
    bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md', 'docs/slow.md'])
    let finish!: (value: { path: string; content: string; mtimeMs: number; size: number }) => void
    const slow = new Promise<{ path: string; content: string; mtimeMs: number; size: number }>((resolve) => { finish = resolve })
    bridgeMocks.getDocumentContentFromBridge.mockImplementation(async (_project: string, _profile: string, path: string) => {
      if (path === 'docs/slow.md') return slow
      return documents.get(path)
    })
    render(<App />)
    await screen.findByRole('tab', { name: 'next' })
    await user.click(await screen.findByRole('button', { name: 'slow.md' }))
    await user.click(screen.getByRole('tab', { name: 'guide' }))
    await act(async () => { finish({ path: 'docs/slow.md', content: '# Slow', mtimeMs: 1, size: 6 }); await slow })
    expect(screen.queryByRole('tab', { name: 'slow' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'guide' })).toHaveAttribute('aria-selected', 'true')
  })

  it('does not recreate a restored tab closed while its document is still loading', async () => {
    const user = userEvent.setup()
    let finish!: (value: { path: string; content: string; mtimeMs: number; size: number }) => void
    const delayed = new Promise<{ path: string; content: string; mtimeMs: number; size: number }>((resolve) => { finish = resolve })
    bridgeMocks.getDocumentContentFromBridge.mockImplementation(async (_project: string, _profile: string, path: string) => {
      if (path === 'docs/next.md') return delayed
      return documents.get(path)
    })
    render(<App />)
    await screen.findByRole('tab', { name: 'next' })
    await user.click(screen.getByRole('button', { name: '关闭标签：next' }))
    await screen.findByRole('tab', { name: 'guide' })
    await act(async () => { finish(documents.get('docs/next.md')!); await delayed })
    expect(screen.queryByRole('tab', { name: 'next' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'guide' })).toHaveAttribute('aria-selected', 'true')
  })

  it('does not clear a new session when a deep-link restore finishes late', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', 'http://localhost:3000/?project=notes&profile=default&path=docs%2Fnext.md')
    let finish!: (value: { path: string; content: string; mtimeMs: number; size: number }) => void
    const delayed = new Promise<{ path: string; content: string; mtimeMs: number; size: number }>((resolve) => { finish = resolve })
    bridgeMocks.getDocumentContentFromBridge.mockImplementation(async (_project: string, _profile: string, path: string) => {
      if (path === 'docs/next.md') return delayed
      return documents.get(path)
    })
    render(<App />)
    await screen.findByRole('tab', { name: 'next' })
    await user.click(screen.getByRole('button', { name: '关闭标签：next' }))
    await user.click(await screen.findByRole('button', { name: 'guide.md' }))
    await screen.findByRole('tab', { name: 'guide' })
    await act(async () => { finish(documents.get('docs/next.md')!); await delayed })
    expect(screen.getByRole('tab', { name: 'guide' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/分享链接中的文档不存在/)).not.toBeInTheDocument()
  })

  it('does not apply stale missing-document cleanup after switching profile', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', 'http://localhost:3000/?project=notes&profile=default&path=docs%2Fnext.md')
    let release!: () => void
    const delayed = new Promise<void>((resolve) => { release = resolve })
    bridgeMocks.getDocumentContentFromBridge.mockImplementation(async (_project: string, profile: string, path: string) => {
      if (profile === 'default' && path === 'docs/next.md') throw new Error('missing document: docs/next.md')
      return documents.get(path)
    })
    bridgeMocks.updateState.mockImplementationOnce(async (projectId: string, profileId: string, update: (state: typeof localState) => typeof localState) => {
      await delayed
      return bridgeMocks.saveState(projectId, profileId, update(localState))
    })
    render(<App />)
    await waitFor(() => expect(bridgeMocks.updateState).toHaveBeenCalled())
    await user.click(screen.getByRole('combobox', { name: 'Profile 切换' }))
    await user.click(await screen.findByRole('option', { name: 'Lans' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Profile 切换' })).toHaveTextContent('Lans'))
    await screen.findByRole('tab', { name: 'next' })
    await act(async () => { release(); await delayed })
    expect(screen.getByRole('tab', { name: 'next' })).toBeInTheDocument()
    expect(screen.queryByText(/分享链接中的文档不存在/)).not.toBeInTheDocument()
    expect(screen.queryByText(/已移除失效文档/)).not.toBeInTheDocument()
  })

  it('preserves an existing tab draft when a document link selects it', async () => {
    const user = userEvent.setup()
    const original = documents.get('docs/next.md')!
    documents.set('docs/next.md', { ...original, content: '# Next\n\n[返回 Guide](guide.md)' })
    render(<App />)
    await screen.findByRole('tab', { name: 'next' })
    await user.click(screen.getByRole('tab', { name: 'guide' }))
    const editor = await screen.findByRole('textbox', { name: 'Markdown 编辑器' })
    await waitFor(() => expect(editor).toHaveValue('# Guide\n\nGuide body'))
    fireEvent.change(editor, { target: { value: '# 未保存草稿' } })
    await user.click(screen.getByRole('tab', { name: 'next' }))
    await user.click(await screen.findByRole('link', { name: '返回 Guide' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'guide' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('textbox', { name: 'Markdown 编辑器' })).toHaveValue('# 未保存草稿')
    documents.set('docs/next.md', original)
  })

  it('restores the previous tab set and returns to the last active tab', async () => {
    const user = userEvent.setup()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'guide' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'next' })).toBeInTheDocument()
    })

    expect(screen.getByRole('tab', { name: 'next' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '分栏' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'Markdown 编辑器' })).toHaveValue(
      '# Next\n\nNext body',
    )

    await user.click(screen.getByRole('tab', { name: 'guide' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'guide' })).toHaveAttribute('aria-selected', 'true')
    })

    expect(bridgeMocks.saveState).toHaveBeenCalledWith(
      'notes',
      'default',
      expect.objectContaining({
        openDocumentPaths: ['docs/guide.md', 'docs/next.md'],
        activeDocumentPath: 'docs/guide.md',
        activeMode: 'split',
        regularViewState: 'editable',
      }),
    )
  })

  it('restores the project selected by a pathless workspace locator instead of the shared registry default', async () => {
    window.history.replaceState(null, '', 'http://localhost:3000/?project=manual&profile=default')
    bridgeMocks.listProjectsFromBridge.mockResolvedValue({
      initialized: true, revision: 1,
      activeProjectId: 'notes',
      projects: [
        { id: 'notes', name: 'Notes', rootHandleKey: 'handle:notes', contentRoots: ['docs'], permissionState: 'granted' },
        { id: 'manual', name: 'Manual', rootHandleKey: 'handle:manual', contentRoots: ['docs'], permissionState: 'granted' },
      ],
    })
    bridgeMocks.getFileTreePathsFromBridge.mockImplementation(async (projectId: string) =>
      projectId === 'manual' ? ['docs/manual.md'] : ['docs/guide.md', 'docs/next.md'],
    )

    render(<App />)

    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('Manual'))
    expect(bridgeMocks.getFileTreePathsFromBridge).toHaveBeenCalledWith('manual', 'default', undefined)
    expect(window.location.search).toBe('?project=manual&profile=default')
  })

  it('refreshes the current project tree from an external scan', async () => {
    const user = userEvent.setup()
    bridgeMocks.refreshFileTreeFromBridge.mockResolvedValue(['docs/guide.md', 'docs/next.md', 'docs/external.md'])

    render(<App />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'guide.md' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '刷新文件树' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'external.md' })).toBeInTheDocument())
    expect(bridgeMocks.refreshFileTreeFromBridge).toHaveBeenCalledWith(
      'notes',
      'default',
      expect.objectContaining({ onIndexing: expect.any(Function) }),
    )
  })

  it('commits the target project while its cold file tree continues indexing in the background', async () => {
    const user = userEvent.setup()
    let finishManualTree: ((paths: string[]) => void) | null = null
    const manualTree = new Promise<string[]>((resolve) => {
      finishManualTree = resolve
    })

    bridgeMocks.listProjectsFromBridge.mockResolvedValue({
      initialized: true, revision: 1,
      activeProjectId: 'notes',
      projects: [
        {
          id: 'notes',
          name: 'Notes',
          rootHandleKey: 'handle:notes',
          contentRoots: ['docs'],
          permissionState: 'granted',
        },
        {
          id: 'manual',
          name: 'Manual',
          rootHandleKey: 'handle:manual',
          contentRoots: ['docs'],
          permissionState: 'granted',
        },
      ],
    })
    bridgeMocks.getFileTreePathsFromBridge.mockImplementation(
      async (projectId: string, _profileId: string, options?: { onIndexing?: () => Promise<void> }) => {
        if (projectId !== 'manual') return ['docs/guide.md', 'docs/next.md']
        await options?.onIndexing?.()
        return manualTree
      },
    )

    render(<App />)

    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('Notes'))

    await user.click(screen.getByRole('combobox', { name: '项目切换' }))
    await user.click(screen.getByRole('option', { name: 'Manual' }))

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('Manual')
      expect(screen.getAllByText('正在索引项目文件树…').length).toBeGreaterThan(0)
    })

    finishManualTree?.(['docs/manual.md'])

    await waitFor(() => expect(screen.getByRole('button', { name: 'manual.md' })).toBeInTheDocument())
  })

  it('shows the target project identity before a warm tree request finishes', async () => {
    const user = userEvent.setup()
    let finishManualTree: ((paths: string[]) => void) | null = null
    const manualTree = new Promise<string[]>((resolve) => {
      finishManualTree = resolve
    })

    bridgeMocks.listProjectsFromBridge.mockResolvedValue({
      initialized: true, revision: 1,
      activeProjectId: 'notes',
      projects: [
        {
          id: 'notes',
          name: 'Notes',
          rootHandleKey: 'handle:notes',
          contentRoots: ['docs'],
          permissionState: 'granted',
        },
        {
          id: 'manual',
          name: 'Manual',
          rootHandleKey: 'handle:manual',
          contentRoots: ['docs'],
          permissionState: 'granted',
        },
      ],
    })
    bridgeMocks.getFileTreePathsFromBridge.mockImplementation(async (projectId: string) =>
      projectId === 'manual' ? manualTree : ['docs/guide.md', 'docs/next.md'],
    )

    render(<App />)

    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('Notes'))

    await user.click(screen.getByRole('combobox', { name: '项目切换' }))
    await user.click(screen.getByRole('option', { name: 'Manual' }))

    expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('Manual')
    expect(screen.getAllByText('正在切换项目…').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'guide.md' })).not.toBeInTheDocument()

    finishManualTree?.(['docs/manual.md'])

    await waitFor(() => expect(screen.getByRole('button', { name: 'manual.md' })).toBeInTheDocument())
  })

  it('defers profile changes while a project operation is pending', async () => {
    const user = userEvent.setup()
    let resolveManualTree: ((paths: string[]) => void) | null = null
    const manualTree = new Promise<string[]>((resolve) => {
      resolveManualTree = resolve
    })

    bridgeMocks.listProjectsFromBridge.mockResolvedValue({
      initialized: true, revision: 1,
      activeProjectId: 'notes',
      projects: [
        {
          id: 'notes',
          name: 'Notes',
          rootHandleKey: 'handle:notes',
          contentRoots: ['docs'],
          permissionState: 'granted',
        },
        {
          id: 'manual',
          name: 'Manual',
          rootHandleKey: 'handle:manual',
          contentRoots: ['docs'],
          permissionState: 'granted',
        },
      ],
    })
    bridgeMocks.getFileTreePathsFromBridge.mockImplementation(async (projectId: string) =>
      projectId === 'manual' ? manualTree : ['docs/guide.md', 'docs/next.md'],
    )

    render(<App />)

    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('Notes'))
    await user.click(screen.getByRole('combobox', { name: '项目切换' }))
    await user.click(screen.getByRole('option', { name: 'Manual' }))
    await waitFor(() => expect(screen.getByText('正在准备文件树和文档状态')).toBeInTheDocument())

    await user.click(screen.getByRole('combobox', { name: 'Profile 切换' }))
    await user.click(screen.getByRole('option', { name: 'Lans' }))

    expect(screen.getByRole('combobox', { name: 'Profile 切换' })).toHaveTextContent('default')
    resolveManualTree?.(['docs/manual.md'])
    await waitFor(() => expect(screen.queryByText('正在准备文件树和文档状态')).not.toBeInTheDocument())
    await user.click(screen.getByRole('combobox', { name: 'Profile 切换' }))
    await user.click(screen.getByRole('option', { name: 'Lans' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Profile 切换' })).toHaveTextContent('Lans'))
  })

  it('reuses loaded tab content when selecting documents from the file tree', async () => {
    const user = userEvent.setup()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'guide.md' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'next.md' })).toBeInTheDocument()
      expect(bridgeMocks.getDocumentContentFromBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/next.md',
      )
    })

    await user.click(screen.getByRole('button', { name: 'guide.md' }))

    await waitFor(() => {
      expect(bridgeMocks.getDocumentContentFromBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/guide.md',
      )
    })

    const readsAfterBothDocumentsLoaded = bridgeMocks.getDocumentContentFromBridge.mock.calls.length

    await user.click(screen.getByRole('button', { name: 'next.md' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'next' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(bridgeMocks.getDocumentContentFromBridge).toHaveBeenCalledTimes(
      readsAfterBothDocumentsLoaded,
    )
    expect(screen.queryByText('正在读取 Markdown 内容…')).not.toBeInTheDocument()
  })

  it('restores a previously collapsed root directory from the saved profile navigation state', async () => {
    bridgeMocks.getProfileFromBridge.mockResolvedValue({
      id: 'default',
      appearance: {
        theme: 'system',
        fontSize: 16,
        pageWidth: 'narrow',
      },
      layout: {
        sidebarWidth: 280,
        outlineWidth: 320,
        sidebarCollapsed: false,
        outlineCollapsed: false,
      },
      navigation: {
        expandedFileNodes: [],
        expandedFileNodesInitialized: true,
        expandedHeadingNodes: {},
        hiddenPaths: [],
        favoritePaths: [],
        manualNodeOrderByParent: {},
      },
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'docs' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: 'guide.md' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'next.md' })).not.toBeInTheDocument()
    })
  })

  it('applies the saved manual root order when rebuilding the file tree', async () => {
    localState.openDocumentPaths = ['docs/guide.md']
    localState.activeDocumentPath = 'docs/guide.md'
    localState.tabStateByDocument = {
      'docs/guide.md': { lastKnownScrollTop: 128 },
    }
    localState.readingProgressByDocument = {
      'docs/guide.md': 128,
    }
    bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/guide.md', 'notes/todo.md'])
    bridgeMocks.getProfileFromBridge.mockResolvedValueOnce({
      id: 'default',
      appearance: {
        theme: 'system',
        fontSize: 16,
        pageWidth: 'narrow',
      },
      layout: {
        sidebarWidth: 280,
        outlineWidth: 320,
        sidebarCollapsed: false,
        outlineCollapsed: false,
      },
      navigation: {
        expandedFileNodes: ['notes', 'docs'],
        expandedFileNodesInitialized: true,
        expandedHeadingNodes: {},
        hiddenPaths: [],
        favoritePaths: [],
        manualNodeOrderByParent: {
          __root__: ['notes', 'docs'],
        },
      },
    })

    const { container } = render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'notes' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'docs' })).toBeInTheDocument()
    })

    const rootDirectoryNames = Array.from(container.querySelectorAll('.file-tree__directory-name'))
      .map((node) => node.textContent)
      .slice(0, 2)

    expect(rootDirectoryNames).toEqual(['notes', 'docs'])
  })

  it('prunes missing restored documents before attempting to reload them', async () => {
    localState.openDocumentPaths = ['docs/missing.md', 'docs/guide.md']
    localState.activeDocumentPath = 'docs/missing.md'
    localState.tabStateByDocument = {
      'docs/missing.md': { lastKnownScrollTop: 32 },
      'docs/guide.md': { lastKnownScrollTop: 128 },
    }
    localState.readingProgressByDocument = {
      'docs/missing.md': 32,
      'docs/guide.md': 128,
    }

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'guide' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('tab', { name: 'missing' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'guide' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/读取文档失败/)).not.toBeInTheDocument()

    expect(bridgeMocks.getDocumentContentFromBridge).toHaveBeenCalledWith('notes', 'default', 'docs/guide.md')
    expect(bridgeMocks.getDocumentContentFromBridge).not.toHaveBeenCalledWith(
      'notes',
      'default',
      'docs/missing.md',
    )
    expect(bridgeMocks.saveState).toHaveBeenCalledWith(
      'notes',
      'default',
      expect.objectContaining({
        openDocumentPaths: ['docs/guide.md'],
        activeDocumentPath: 'docs/guide.md',
      }),
    )
  })

  it('self-heals a stale active tab when document loading reports the file is missing', async () => {
    localState.openDocumentPaths = ['docs/missing.md', 'docs/guide.md']
    localState.activeDocumentPath = 'docs/missing.md'
    localState.tabStateByDocument = {
      'docs/missing.md': { lastKnownScrollTop: 32 },
      'docs/guide.md': { lastKnownScrollTop: 128 },
    }
    localState.readingProgressByDocument = {
      'docs/missing.md': 32,
      'docs/guide.md': 128,
    }
    bridgeMocks.getFileTreePathsFromBridge.mockResolvedValue(['docs/missing.md', 'docs/guide.md'])

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'guide' })).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'missing' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: 'guide' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('已移除失效文档：docs/missing.md')).toBeInTheDocument()

    expect(bridgeMocks.getDocumentContentFromBridge).toHaveBeenCalledWith(
      'notes',
      'default',
      'docs/missing.md',
    )
    expect(bridgeMocks.getDocumentContentFromBridge).toHaveBeenCalledWith(
      'notes',
      'default',
      'docs/guide.md',
    )
    expect(bridgeMocks.saveState).toHaveBeenCalledWith(
      'notes',
      'default',
      expect.objectContaining({
        openDocumentPaths: ['docs/guide.md'],
        activeDocumentPath: 'docs/guide.md',
      }),
    )
  })
})
